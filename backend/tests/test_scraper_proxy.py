"""Regression test for bug #34: competitor shops rate-limit the droplet's
datacentre IP.

Reproduced live while the bug was open: murci.co.uk answered HTTP 429 to the
droplet and HTTP 200 to the very same requests from another IP, and identical
bestseller scans took ~123s on the droplet against ~5s elsewhere. The scraper
code was fine — the IP was the problem. Plan #2 optie 1 (CEO-approved): send
scraper traffic through a proxy with residential IPs, configured droplet-side
via SCRAPER_PROXY_URL, with SCRAPER_PROXY=0 as the kill switch.
"""
import pytest

import server


class _FakeResponse:
    def __init__(self, status_code=200, text='', headers=None):
        self.status_code = status_code
        self.text = text
        self.headers = headers or {}
        self.content = text.encode()


@pytest.fixture(autouse=True)
def _clean_proxy_env(monkeypatch):
    """Neither var is set on a dev laptop; make that explicit so a stray
    environment can't decide the outcome of these tests."""
    monkeypatch.delenv('SCRAPER_PROXY_URL', raising=False)
    monkeypatch.delenv('SCRAPER_PROXY', raising=False)


def _record_gets(monkeypatch, responses=None):
    """Replace requests.get with a recorder. `responses` may hold callables or
    responses to hand out in order; the default is a plain 200."""
    calls = []
    queue = list(responses or [])

    def fake_get(url, timeout=None, headers=None, **kwargs):
        calls.append({'url': url, 'proxies': kwargs.get('proxies')})
        nxt = queue.pop(0) if queue else _FakeResponse(200, '{}')
        if callable(nxt):
            return nxt()
        return nxt

    monkeypatch.setattr(server.req, 'get', fake_get)
    return calls


PROXY = 'http://user:pass@gateway.example.net:8080'


def test_scrape_goes_through_the_proxy_when_configured(monkeypatch):
    monkeypatch.setenv('SCRAPER_PROXY_URL', PROXY)
    calls = _record_gets(monkeypatch)

    server._scrape_get('https://shop-proxy-on.example/products/dress.json')

    assert len(calls) == 1
    assert calls[0]['proxies'] == {'http': PROXY, 'https': PROXY}


def test_scrape_goes_direct_when_no_proxy_configured(monkeypatch):
    calls = _record_gets(monkeypatch)

    server._scrape_get('https://shop-proxy-off.example/products/dress.json')

    assert len(calls) == 1
    assert calls[0]['proxies'] is None


def test_kill_switch_forces_direct_traffic(monkeypatch):
    monkeypatch.setenv('SCRAPER_PROXY_URL', PROXY)
    monkeypatch.setenv('SCRAPER_PROXY', '0')
    calls = _record_gets(monkeypatch)

    server._scrape_get('https://shop-killswitch.example/products/dress.json')

    assert calls[0]['proxies'] is None


def test_asset_cdns_bypass_the_proxy(monkeypatch):
    """Images are the bulk of the bytes, are not what gets rate-limited, and
    residential proxies bill per GB."""
    monkeypatch.setenv('SCRAPER_PROXY_URL', PROXY)
    calls = _record_gets(monkeypatch)

    server._scrape_get('https://cdn.shopify.com/s/files/1/0542/isola.jpg')

    assert calls[0]['proxies'] is None


def test_unreachable_proxy_falls_back_to_a_direct_request(monkeypatch):
    """A dead proxy must never take the scraper down with it — worst case we are
    back to the pre-proxy behaviour."""
    monkeypatch.setenv('SCRAPER_PROXY_URL', PROXY)

    def _boom():
        raise server.req.exceptions.ProxyError('Unable to connect to proxy')

    calls = _record_gets(monkeypatch, [_boom, _FakeResponse(200, '{"product": {}}')])

    res = server._scrape_get('https://shop-deadproxy.example/products/dress.json')

    assert res.status_code == 200
    assert [c['proxies'] for c in calls] == [{'http': PROXY, 'https': PROXY}, None]


def test_health_reports_whether_the_proxy_is_on(monkeypatch):
    """So the setting can be verified from outside without exposing the
    credentials that sit in the proxy URL."""
    monkeypatch.setenv('DEV_LOCAL', '1')
    client = server.app.test_client()

    assert client.get('/api/health').get_json()['scraper_proxy'] is False

    monkeypatch.setenv('SCRAPER_PROXY_URL', PROXY)
    assert client.get('/api/health').get_json()['scraper_proxy'] is True
