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
    environment can't decide the outcome of these tests.

    The routing memories are process-global and outlive a test: a host marked
    proxy-first by one test would make the next one's first request go out
    proxied, and a 429 cooldown armed here would make a later test skip the
    network entirely. Reset both."""
    monkeypatch.delenv('SCRAPER_PROXY_URL', raising=False)
    monkeypatch.delenv('SCRAPER_PROXY', raising=False)
    monkeypatch.setattr(server, '_proxy_hosts', {})
    monkeypatch.setattr(server, '_proxy_nohelp', {})
    monkeypatch.setattr(server, '_scrape_429_until', {})
    monkeypatch.setattr(server, '_scrape_429_probe_at', {})


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


PROXIES = {'http': PROXY, 'https': PROXY}


def test_a_shop_that_refuses_us_is_retried_through_the_proxy(monkeypatch):
    """Bug #34's fix, as it works since the proxy became a LAST resort: traffic
    goes out direct, and only a shop that refuses the droplet (429, or a 403 that
    survives the browser-UA retry) is repeated over the residential IP."""
    monkeypatch.setenv('SCRAPER_PROXY_URL', PROXY)
    calls = _record_gets(monkeypatch, [_FakeResponse(429, 'slow down'),
                                       _FakeResponse(200, '{"product": {}}')])

    res = server._scrape_get('https://shop-proxy-on.example/products/dress.json')

    assert res.status_code == 200
    assert [c['proxies'] for c in calls] == [None, PROXIES]


def test_a_shop_that_answers_us_never_costs_a_proxy_request(monkeypatch):
    """Residential traffic bills per GB. A store that serves us fine must stay on
    the free route even with the proxy configured."""
    monkeypatch.setenv('SCRAPER_PROXY_URL', PROXY)
    calls = _record_gets(monkeypatch, [_FakeResponse(200, '{"product": {}}')])

    server._scrape_get('https://shop-friendly.example/products/dress.json')

    assert [c['proxies'] for c in calls] == [None]


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

    calls = _record_gets(monkeypatch, [_FakeResponse(429, 'slow down'), _boom,
                                       _FakeResponse(200, '{"product": {}}')])

    res = server._scrape_get('https://shop-deadproxy.example/products/dress.json')

    assert res.status_code == 200
    assert [c['proxies'] for c in calls] == [None, PROXIES, None]


def test_health_reports_whether_the_proxy_is_on(monkeypatch):
    """So the setting can be verified from outside without exposing the
    credentials that sit in the proxy URL."""
    monkeypatch.setenv('DEV_LOCAL', '1')
    client = server.app.test_client()

    assert client.get('/api/health').get_json()['scraper_proxy'] is False

    monkeypatch.setenv('SCRAPER_PROXY_URL', PROXY)
    assert client.get('/api/health').get_json()['scraper_proxy'] is True


# ── A silent fallback must still be visible afterwards ──────────────────────
# The fallback is what keeps a broken proxy from taking the scraper down, but on
# 2026-08-06 it also meant a proxy rejected with HTTP 407 quietly routed
# competitor traffic over our own IP for hours. Nothing short of running a probe
# by hand could tell. _PROXY_HEALTH records every outcome so the dashboard can.

@pytest.fixture(autouse=True)
def _reset_proxy_health():
    server._PROXY_HEALTH.update(ok=0, failed=0, last_ok_ts=0.0, last_fail_ts=0.0,
                                last_reason=None)


def test_a_fallback_is_recorded_not_just_logged(monkeypatch):
    monkeypatch.setenv('SCRAPER_PROXY_URL', PROXY)
    calls = []

    def fake_get(url, timeout=None, headers=None, **kwargs):
        proxied = bool(kwargs.get('proxies'))
        calls.append(proxied)
        if proxied:
            raise server.req.exceptions.ProxyError('407 Proxy Authentication Required')
        # First (direct) attempt: the shop refuses us — that is what escalates
        # to the proxy at all. The fallback after the proxy dies then succeeds.
        return _FakeResponse(429 if len(calls) == 1 else 200, 'ok')

    monkeypatch.setattr(server.req, 'get', fake_get)

    server._scrape_get('https://shop.example/products/x.json')
    snap = server._proxy_health_snapshot()

    assert calls == [False, True, False], 'direct, escalate to the proxy, then fall back'
    assert snap['proxy_failing'] is True
    assert snap['proxy_failures'] == 1
    assert 'traffic left' in snap['proxy_last_reason']


def test_a_working_proxy_is_not_reported_as_failing(monkeypatch):
    monkeypatch.setenv('SCRAPER_PROXY_URL', PROXY)
    _record_gets(monkeypatch, [_FakeResponse(429, 'slow down'), _FakeResponse(200, 'ok')])

    server._scrape_get('https://shop.example/products/x.json')
    snap = server._proxy_health_snapshot()

    assert snap['proxy_failing'] is False
    assert snap['proxy_requests'] == 1
    # The host that needed it is remembered, so the dashboard can show which
    # shops are actually on the paid route.
    assert snap['proxy_hosts'] == ['shop.example']


def test_recovery_clears_the_failing_flag(monkeypatch):
    """A single old failure must not mark the proxy broken forever — the flag is
    the LAST attempt's verdict, not a sticky bit."""
    monkeypatch.setenv('SCRAPER_PROXY_URL', PROXY)
    server._PROXY_HEALTH.update(failed=1, last_fail_ts=1.0)
    _record_gets(monkeypatch, [_FakeResponse(429, 'slow down'), _FakeResponse(200, 'ok')])

    server._scrape_get('https://shop.example/products/x.json')

    assert server._proxy_health_snapshot()['proxy_failing'] is False


def test_the_recorded_reason_is_never_raw_exception_text(monkeypatch):
    """proxy_last_reason is surfaced on UNGATED endpoints, so it must pass the
    curated safe-list — a requests ProxyError can carry the proxy URL."""
    monkeypatch.setenv('SCRAPER_PROXY_URL', PROXY)

    def fake_get(url, timeout=None, headers=None, **kwargs):
        if kwargs.get('proxies'):
            raise server.req.exceptions.ProxyError(f'something odd {PROXY}')
        return _FakeResponse(200, 'ok')

    monkeypatch.setattr(server.req, 'get', fake_get)

    server._scrape_get('https://shop.example/products/x.json')

    assert server._proxy_health_snapshot()['proxy_last_reason'] is None
