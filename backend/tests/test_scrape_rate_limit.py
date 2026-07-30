"""Regression test for bug #28: a competitor product URL that 429s (real or
via the cooldown _scrape_get returns for a host that recently 429'd, bug #16)
fell through to r.raise_for_status(), which raised a raw "429 Client Error:
Too Many Requests for url: ..." — read by a non-technical reporter as "the
dashboard can't read this store" with no hint that it's temporary or
retryable. /api/scrape now gives 429 the same friendly, actionable treatment
401/403 and connection failures already get.
"""
import server


class _FakeResponse:
    def __init__(self, status_code=200, text='', headers=None):
        self.status_code = status_code
        self.text = text
        self.headers = headers or {}

    def json(self):
        import json
        return json.loads(self.text)

    def raise_for_status(self):
        if 400 <= self.status_code:
            raise server.req.exceptions.HTTPError(f'{self.status_code} Client Error')


def _client(monkeypatch):
    monkeypatch.setenv('DEV_LOCAL', '1')
    return server.app.test_client()


def test_scrape_returns_friendly_message_on_429(monkeypatch):
    def fake_scrape_get(url, timeout=10, **kwargs):
        return _FakeResponse(429, '{"error": "rate limited"}', headers={'Retry-After': '45'})

    monkeypatch.setattr(server, '_scrape_get', fake_scrape_get)
    client = _client(monkeypatch)

    res = client.post('/api/scrape', json={'url': 'https://www.cettesaison.fr/products/robe-ample'})

    assert res.status_code == 429
    body = res.get_json()
    assert 'rate-limiting' in body['error']
    assert '45s' in body['error']
    # Not a raw urllib3/requests exception string leaking to the user.
    assert 'Client Error' not in body['error']


def test_scrape_429_without_retry_after_still_friendly(monkeypatch):
    def fake_scrape_get(url, timeout=10, **kwargs):
        return _FakeResponse(429, '{"error": "cooling down"}', headers={})

    monkeypatch.setattr(server, '_scrape_get', fake_scrape_get)
    client = _client(monkeypatch)

    res = client.post('/api/scrape', json={'url': 'https://www.cettesaison.fr/products/robe-ample'})

    assert res.status_code == 429
    body = res.get_json()
    assert 'rate-limiting' in body['error']
    assert 'few minutes' in body['error']


# ── bug #32: the cooldown outlived the block it protects against ─────────────
# Listing product after product from one store trips a single transient 429
# somewhere in the 5-30 requests an import fires. That armed a host-wide 30-300s
# cooldown which was never cleared — not even by the very next 200 from that
# same host — so the dashboard refused the whole store ("can't read the
# competitor store") while the store was answering us perfectly.

HOST = 'www.cettesaison.fr'
URL_A = f'https://{HOST}/products/robe-ample.json'
URL_B = f'https://{HOST}/products/robe-longue.json'


class _FakeReq:
    """Stand-in for requests.get that replays a scripted status sequence."""

    def __init__(self, statuses):
        self.statuses = list(statuses)
        self.urls = []

    def __call__(self, url, timeout=None, headers=None):
        self.urls.append(url)
        code = self.statuses.pop(0) if self.statuses else 200
        # Retry-After 0 keeps the backoff sleeps instant; the cooldown floor
        # (_SCRAPE_429_COOLDOWN_MIN) applies regardless of this value.
        return _FakeResponse(code, '{"product": {}}',
                             headers={'Retry-After': '0'} if code == 429 else {})


def _install(monkeypatch, statuses):
    monkeypatch.setattr(server, '_scrape_429_until', {})
    monkeypatch.setattr(server, '_scrape_429_probe_at', {})
    fake = _FakeReq(statuses)
    monkeypatch.setattr(server.req, 'get', fake)
    return fake


def test_transient_429_that_recovers_does_not_block_the_host(monkeypatch):
    # 429 on the first hit, 200 on the retry — the host is fine again.
    fake = _install(monkeypatch, [429, 200])

    assert server._scrape_get(URL_A).status_code == 200
    assert len(fake.urls) == 2

    # The next request to that host (size chart, sibling colour, or simply the
    # employee's next product) must actually be made, not answered with a
    # synthetic 429 from a stale flag.
    r = server._scrape_get(URL_B)
    assert r.status_code == 200
    assert fake.urls[-1] == URL_B
    assert server._scrape_429_until == {}


def test_persistent_429_still_cools_the_host_down(monkeypatch):
    # bug #16 protection must survive: a host that keeps 429ing gets left alone.
    fake = _install(monkeypatch, [429, 429, 429])

    assert server._scrape_get(URL_A).status_code == 429
    hits = len(fake.urls)

    r = server._scrape_get(URL_B)
    assert r.status_code == 429
    assert len(fake.urls) == hits          # failed fast, no extra network hit
    assert int(r.headers['Retry-After']) > 0


def test_cooldown_probes_once_and_reopens_when_the_host_recovers(monkeypatch):
    fake = _install(monkeypatch, [429, 429, 429])
    assert server._scrape_get(URL_A).status_code == 429
    hits = len(fake.urls)

    # Pretend _SCRAPE_429_PROBE_EVERY seconds have passed inside the cooldown.
    server._scrape_429_probe_at[HOST] = 0
    fake.statuses = [200]

    r = server._scrape_get(URL_B)
    assert r.status_code == 200
    assert len(fake.urls) == hits + 1      # exactly one probe request
    assert server._scrape_429_until == {}  # host reopened for normal traffic


def test_probe_that_gets_429_again_does_not_retry(monkeypatch):
    fake = _install(monkeypatch, [429, 429, 429])
    assert server._scrape_get(URL_A).status_code == 429
    hits = len(fake.urls)

    server._scrape_429_probe_at[HOST] = 0
    fake.statuses = [429, 200, 200]        # a retry would turn this into a 200

    r = server._scrape_get(URL_B)
    assert r.status_code == 429
    assert len(fake.urls) == hits + 1      # one probe, no backoff retries
    assert server._scrape_429_until.get(HOST)          # cooldown re-armed
    assert server._scrape_429_probe_at[HOST] > 0       # next probe deferred
