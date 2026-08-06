"""Tests for the ungated self-test endpoints.

The hands-off routine runs in a cloud session with no session token, so it could
fix a bug and then be unable to measure whether the fix worked. Bug #31 stayed
open for exactly that reason: the code was already correct and the DataForSEO
account healthy, but nothing reachable without a token could prove it.

These endpoints exist to answer that one question. Because they are ungated, the
tests below care as much about what they must NOT return as about the outcome.
"""
import pytest

import server


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setattr(server, '_SELFTEST_CACHE', {})
    monkeypatch.delenv('SCRAPER_PROXY_URL', raising=False)
    monkeypatch.delenv('SCRAPER_PROXY', raising=False)


@pytest.fixture()
def client():
    server.app.config['TESTING'] = True
    with server.app.test_client() as c:
        yield c


SUGGESTIONS = [
    {'keyword': 'kjole', 'volume': 27000, 'cpc': 0.4},
    {'keyword': 'sommerkjole', 'volume': 5400, 'cpc': 0.3},
    {'keyword': 'lang kjole', 'volume': 90, 'cpc': 0.2},      # below the dk threshold
]


def _mock_keywords(monkeypatch, suggestions=None, seeds=('kjole', 'sommerkjole')):
    monkeypatch.setattr(server, '_dfs_configured', lambda: True)
    monkeypatch.setattr(server, '_niche_seeds_for_type', lambda t, s: list(seeds))
    monkeypatch.setattr(server, '_dfs_keyword_suggestions',
                        lambda seed, store, min_volume=0, limit=25:
                        list(SUGGESTIONS if suggestions is None else suggestions))


def test_it_needs_no_session_token(client, monkeypatch):
    """The whole point: reachable from a cloud session. The gated endpoints must
    stay gated, which the settings tests cover separately."""
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', 'a-secret')
    monkeypatch.delenv('DEV_LOCAL', raising=False)
    _mock_keywords(monkeypatch)

    r = client.get('/api/selftest?what=keywords')

    assert r.status_code == 200
    assert r.get_json()['ok'] is True


def test_a_working_search_reports_how_many_cleared_the_threshold(client, monkeypatch):
    _mock_keywords(monkeypatch)

    body = client.get('/api/selftest?what=keywords').get_json()

    assert body['ok'] is True
    # 2 above dk's 1800 threshold, per seed, for 2 seeds.
    assert body['found'] == 4
    assert body['min_volume'] == server.DFS_MIN_VOLUME['dk']


def test_it_never_returns_the_keywords_themselves(client, monkeypatch):
    """An ungated endpoint hands out an outcome, not the paid research."""
    _mock_keywords(monkeypatch)

    text = client.get('/api/selftest?what=keywords').get_data(as_text=True)

    assert 'kjole' not in text
    assert 'sommerkjole' not in text


def test_an_api_error_is_not_reported_as_nothing_found(client, monkeypatch):
    """Bug #31 in one assertion: a dead upstream must never look like an empty
    result, or the next reader goes hunting for a broader search term."""
    _mock_keywords(monkeypatch, suggestions=[{'error': 'code 40200: no credits'}])

    body = client.get('/api/selftest?what=keywords').get_json()

    assert body['ok'] is False
    assert body['found'] == 0
    assert '40200' in body['error']


def test_a_genuinely_empty_market_is_ok_false_without_an_error(client, monkeypatch):
    """Distinguishable from the case above: nothing cleared the bar, but nothing
    broke either."""
    _mock_keywords(monkeypatch, suggestions=[{'keyword': 'x', 'volume': 10}])

    body = client.get('/api/selftest?what=keywords').get_json()

    assert body['ok'] is False
    assert body['found'] == 0
    assert not body.get('error')


def test_unconfigured_dataforseo_is_reported_plainly(client, monkeypatch):
    monkeypatch.setattr(server, '_dfs_configured', lambda: False)

    body = client.get('/api/selftest?what=keywords').get_json()

    assert body['ok'] is False
    assert 'not configured' in body['error']


def test_the_result_is_cached_so_a_retry_loop_cannot_burn_credits(client, monkeypatch):
    calls = []

    monkeypatch.setattr(server, '_dfs_configured', lambda: True)
    monkeypatch.setattr(server, '_niche_seeds_for_type', lambda t, s: ['kjole'])

    def counted(seed, store, min_volume=0, limit=25):
        calls.append(seed)
        return list(SUGGESTIONS)

    monkeypatch.setattr(server, '_dfs_keyword_suggestions', counted)

    first = client.get('/api/selftest?what=keywords').get_json()
    second = client.get('/api/selftest?what=keywords').get_json()

    assert len(calls) == 1, 'the second call must be served from cache'
    assert first['from_cache'] is False
    assert second['from_cache'] is True
    assert second['found'] == first['found']


def test_proxy_selftest_reports_the_outcome_without_leaking_the_url(client, monkeypatch):
    monkeypatch.setenv('SCRAPER_PROXY_URL', 'http://user:secret@gateway.example.net:8080')
    monkeypatch.setattr(server, '_egress_ip', lambda through_proxy, timeout=8:
                        ('5.5.5.5', None) if through_proxy else ('1.2.3.4', None))

    r = client.get('/api/selftest?what=scraper_proxy')
    text = r.get_data(as_text=True)

    assert r.get_json()['ok'] is True
    assert 'secret' not in text
    assert 'gateway.example.net' not in text


def test_proxy_selftest_does_not_hand_out_our_egress_ips(client, monkeypatch):
    """Checking the keys is not enough — the probe's own message embeds both IPs,
    so an earlier version of this test passed while the body still leaked them.
    Assert on the raw text."""
    monkeypatch.setenv('SCRAPER_PROXY_URL', 'http://user:secret@gateway.example.net:8080')
    monkeypatch.setattr(server, '_egress_ip', lambda through_proxy, timeout=8:
                        ('5.5.5.5', None) if through_proxy else ('1.2.3.4', None))

    r = client.get('/api/selftest?what=scraper_proxy')

    assert '5.5.5.5' not in r.get_data(as_text=True)
    assert '1.2.3.4' not in r.get_data(as_text=True)


def test_proxy_selftest_never_echoes_raw_exception_text(client, monkeypatch):
    """_proxy_failure_hint falls back to str(exception), and a requests
    ProxyError can carry the full proxy URL — credentials included. That must
    never reach an ungated endpoint."""
    monkeypatch.setenv('SCRAPER_PROXY_URL', 'http://user:secret@gateway.example.net:8080')
    monkeypatch.setattr(server, '_egress_ip', lambda through_proxy, timeout=8:
                        (None, 'ProxyError(http://user:secret@gateway.example.net:8080)')
                        if through_proxy else ('1.2.3.4', None))

    r = client.get('/api/selftest?what=scraper_proxy')

    assert r.get_json()['ok'] is False
    assert 'secret' not in r.get_data(as_text=True)


def test_an_unknown_check_is_rejected(client):
    r = client.get('/api/selftest?what=everything')

    assert r.status_code == 400


# ── A failed measurement is not a failed proxy ──────────────────────────────
# On its first real run this endpoint reported "the proxy is NOT carrying our
# traffic" while meshki scanned 19/19 through that very proxy: the ipify check
# timed out because residential proxies are slow, and the two failure modes had
# been collapsed into one verdict.

def test_an_unreachable_ip_check_is_inconclusive_not_a_dead_proxy(client, monkeypatch):
    monkeypatch.setenv('SCRAPER_PROXY_URL', 'http://user:secret@gateway.example.net:8080')
    monkeypatch.setattr(server, '_egress_ip', lambda through_proxy, timeout=None:
                        (None, 'the gateway did not answer in time')
                        if through_proxy else ('1.2.3.4', None))

    body = client.get('/api/selftest?what=scraper_proxy').get_json()

    assert body['ok'] is False
    assert body['inconclusive'] is True
    assert 'does NOT prove the proxy is down' in body['message']


def test_an_unchanged_ip_is_a_definite_failure(client, monkeypatch):
    """Distinct from the case above: we DID measure, and the answer is bad."""
    monkeypatch.setenv('SCRAPER_PROXY_URL', 'http://user:secret@gateway.example.net:8080')
    monkeypatch.setattr(server, '_egress_ip',
                        lambda through_proxy, timeout=None: ('1.2.3.4', None))

    body = client.get('/api/selftest?what=scraper_proxy').get_json()

    assert body['ok'] is False
    assert body['inconclusive'] is False
    assert 'unchanged' in body['message']


def test_a_working_proxy_is_neither_failed_nor_inconclusive(client, monkeypatch):
    monkeypatch.setenv('SCRAPER_PROXY_URL', 'http://user:secret@gateway.example.net:8080')
    monkeypatch.setattr(server, '_egress_ip', lambda through_proxy, timeout=None:
                        ('5.5.5.5', None) if through_proxy else ('1.2.3.4', None))

    body = client.get('/api/selftest?what=scraper_proxy').get_json()

    assert body['ok'] is True
    assert body['inconclusive'] is False


def test_the_proxied_ip_check_gets_a_longer_timeout(monkeypatch):
    """8s was too short for a residential proxy — that is what caused the false
    alarm. Assert the asymmetry directly."""
    seen = {}

    def fake_get(url, timeout=None, **kw):
        seen[bool(kw.get('proxies'))] = timeout
        raise Exception('stop here')

    monkeypatch.setenv('SCRAPER_PROXY_URL', 'http://user:p@gateway.example.net:8080')
    monkeypatch.setattr(server.req, 'get', fake_get)

    server._egress_ip(True)
    server._egress_ip(False)

    assert seen[True] > seen[False]
    assert seen[True] >= 20


# ── The IP check must not depend on one echo host ───────────────────────────
# api.ipify.org never answered through IPRoyal's residential network, even at
# 25s, while the same proxy was carrying scraper traffic fine. One provider
# blocking one host must not make verification impossible.

class _Resp:
    def __init__(self, status_code=200, text=''):
        self.status_code = status_code
        self.text = text

    def json(self):
        import json as _j
        return _j.loads(self.text)


def test_it_falls_through_to_the_next_echo_host(monkeypatch):
    tried = []

    def fake_get(url, timeout=None, **kw):
        tried.append(url)
        if 'icanhazip' in url:
            raise Exception('Read timed out.')
        return _Resp(200, '{"ip": "5.5.5.5"}')

    monkeypatch.setattr(server.req, 'get', fake_get)

    ip, err = server._egress_ip(False)

    assert ip == '5.5.5.5'
    assert err is None
    assert len(tried) == 2, 'should have moved on after the first host failed'


def test_a_bare_text_ip_is_understood(monkeypatch):
    """icanhazip answers with the address and nothing else — no JSON."""
    monkeypatch.setattr(server.req, 'get',
                        lambda url, timeout=None, **kw: _Resp(200, '203.0.113.9\n'))

    ip, err = server._egress_ip(False)

    assert ip == '203.0.113.9'
    assert err is None


def test_html_or_junk_is_not_mistaken_for_an_ip(monkeypatch):
    """A captive portal or error page must not be parsed as our egress IP —
    that would make two different failures compare 'equal' and read as a
    working proxy."""
    monkeypatch.setattr(server.req, 'get',
                        lambda url, timeout=None, **kw: _Resp(200, '<html>blocked</html>'))

    ip, err = server._egress_ip(False)

    assert ip is None
    assert err


def test_all_hosts_failing_reports_the_last_reason(monkeypatch):
    monkeypatch.setattr(server.req, 'get', lambda url, timeout=None, **kw:
                        (_ for _ in ()).throw(Exception('407 Proxy Authentication Required')))

    ip, err = server._egress_ip(False)

    assert ip is None
    assert 'traffic left' in err
