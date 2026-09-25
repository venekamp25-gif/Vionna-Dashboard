# -*- coding: utf-8 -*-
"""v1.310: a shop that refuses the droplet's IP (429 / anti-bot wall) answers
the operator's own browser, and Shopify's product .json allows cross-origin
reads. /api/scrape says WHY it failed (`code`) and WHICH url to read
(`json_url`); /api/scrape_manual accepts the browser-fetched JSON and records
the source. The Home Decor page never had the paste fallback its 429 message
promised (venek, 2026-09-24, aorabrand.co) — it has both routes now.
"""
import json
import pathlib

import server

ROOT = pathlib.Path(__file__).resolve().parents[2]


class _FakeResponse:
    def __init__(self, status_code=200, text='', headers=None):
        self.status_code = status_code
        self.text = text
        self.headers = headers or {}

    def raise_for_status(self):
        if 400 <= self.status_code:
            raise server.req.exceptions.HTTPError(f'{self.status_code} Client Error')


def _scrape(monkeypatch, resp):
    monkeypatch.setattr(server, '_scrape_get', lambda url, timeout=10, **kw: resp)
    monkeypatch.setenv('DEV_LOCAL', '1')
    return server.app.test_client().post('/api/scrape', json={'url': 'https://aorabrand.co/products/glow?variant=1'})


def test_429_carries_a_code_and_the_json_url_for_the_browser(monkeypatch):
    res = _scrape(monkeypatch, _FakeResponse(429, '{"error": "rate limited"}', {}))
    assert res.status_code == 429
    body = res.get_json()
    assert body['code'] == 'rate_limited'
    assert body['json_url'] == 'https://aorabrand.co/products/glow.json'
    assert 'rate-limiting' in body['error'] and 'your own browser' in body['error']
    assert 'workaround below' not in body['error']          # promised a UI that Home Decor never had


def test_cdn_block_carries_the_blocked_code(monkeypatch):
    monkeypatch.setattr(server, '_detect_private_shop', lambda body: False)
    monkeypatch.setattr(server, '_detect_cdn_bot_block', lambda body, headers: True)
    res = _scrape(monkeypatch, _FakeResponse(403, 'Just a moment...', {'server': 'cloudflare'}))
    assert res.status_code == 400
    body = res.get_json()
    assert body['code'] == 'blocked' and body['json_url'].endswith('/products/glow.json')


PRODUCT = {'product': {'title': 'Glow', 'handle': 'glow',
                       'options': [{'name': 'Color', 'values': ['Black']}],
                       'variants': [{'id': 1, 'option1': 'Black', 'price': '49.00'}],
                       'images': [{'id': 1, 'src': 'https://cdn.shopify.com/x.jpg'}]}}


def _manual(monkeypatch, payload):
    monkeypatch.setenv('DEV_LOCAL', '1')
    return server.app.test_client().post('/api/scrape_manual', json=payload).get_json()


def test_browser_fetched_json_is_validated_like_a_paste_and_marked(monkeypatch):
    body = _manual(monkeypatch, {'json': json.dumps(PRODUCT), 'source': 'browser'})
    assert body['product']['title'] == 'Glow' and body['source'] == 'browser-fetch'
    body = _manual(monkeypatch, {'json': json.dumps(PRODUCT)})
    assert body['source'] == 'manual-paste'
    body = _manual(monkeypatch, {'json': json.dumps(PRODUCT), 'source': 'anything-else'})
    assert body['source'] == 'manual-paste'


def test_a_bot_check_page_from_the_browser_is_rejected(monkeypatch):
    body = _manual(monkeypatch, {'json': '<html>Just a moment…</html>', 'source': 'browser'})
    assert 'error' in body and 'product' not in body


def test_home_decor_workbench_has_both_fallback_routes():
    """The 429 message pointed at a paste workaround the Home Decor page did
    not have. Both routes must stay wired in."""
    src = (ROOT / 'frontend' / 'components' / 'lighting' / 'HomeDecorWorkbench.tsx').read_text(encoding='utf-8')
    assert 'api.scrapeFromBrowser(' in src, 'Home Decor import no longer reads a refused shop from the browser'
    assert '<ManualPasteModal' in src, 'Home Decor import lost the manual-paste fallback'
    assert 'classifyScrapeError(' in src


def test_fashion_generate_step_tries_the_browser_before_the_paste():
    src = (ROOT / 'frontend' / 'components' / 'steps' / 'GenerateStep.tsx').read_text(encoding='utf-8')
    assert 'api.scrapeFromBrowser(' in src
