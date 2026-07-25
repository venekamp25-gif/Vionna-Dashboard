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
