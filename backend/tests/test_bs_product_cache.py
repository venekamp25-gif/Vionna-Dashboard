"""Regression test for plan #3 step 4 (bug #35): the bestseller scan re-fetched
every product on every scan.

meshki.co.uk rate-limited the droplet's IP and refused 18 of 19 per-product
`/products/<handle>.json` fetches, which _bs_scan turns into null title/image/
price. The IP block itself is fixed by the residential proxy (SCRAPER_PROXY_URL,
droplet-side config), NOT by this code. What this code does is lower our own
request volume — one store cost ~21 requests per scan and paid that bill again
on every re-scan — so we reach a shop's limit later, and keep showing real data
when a fetch is refused anyway.
"""
import pytest

import server


BEST_SELLER_HTML = '''
<a href="/products/abel-denim-shorts-dark-blue">Abel</a>
<a href="/products/cara-linen-dress">Cara</a>
'''

PRODUCT_JSON = {
    'product': {
        'title': 'Abel Denim Shorts',
        'handle': 'abel-denim-shorts-dark-blue',
        'product_type': 'Shorts',
        'published_at': '2026-05-01T10:00:00+02:00',
        'images': [{'src': 'https://cdn.example/abel.jpg'}, {'src': 'https://cdn.example/abel-2.jpg'}],
        'variants': [{'price': '89.00'}, {'price': '89.00'}],
        'body_html': '<p>' + ('x' * 5000) + '</p>',
    }
}


class _FakeResponse:
    def __init__(self, status_code=200, text='', payload=None, headers=None):
        self.status_code = status_code
        self.text = text
        self.headers = headers or {}
        self.content = text.encode()
        self._payload = payload

    def json(self):
        if self._payload is None:
            raise ValueError('no json')
        return self._payload


def _install_fake_scrape(monkeypatch, product_status=200):
    """Replace _scrape_get: the bestseller page always answers, per-product
    .json answers according to `product_status`. Returns the recorded URLs."""
    calls = []

    def fake_scrape_get(url, timeout=None, **kwargs):
        calls.append(url)
        if url.endswith('.json'):
            if product_status != 200:
                raise RuntimeError(f'HTTP {product_status} — rate limited')
            return _FakeResponse(200, '{}', payload=PRODUCT_JSON)
        return _FakeResponse(200, BEST_SELLER_HTML)

    monkeypatch.setattr(server, '_scrape_get', fake_scrape_get)
    return calls


def _product_urls(calls):
    return [u for u in calls if u.endswith('.json')]


def test_second_scan_reuses_the_product_cache(monkeypatch):
    """The point of the change: re-scanning a store must not re-fetch products
    we already have. Before the cache this asked the shop for all 2 products
    twice."""
    calls = _install_fake_scrape(monkeypatch)

    first, blocked = server._bs_scan('shop.example')
    assert blocked is None
    assert len(_product_urls(calls)) == 2

    second, blocked = server._bs_scan('shop.example')
    assert blocked is None
    # No further per-product fetches — only the bestseller page was re-read.
    assert len(_product_urls(calls)) == 2
    assert [p['title'] for p in second['products']] == [p['title'] for p in first['products']]
    assert [p['price'] for p in second['products']] == [p['price'] for p in first['products']]


def test_cached_products_keep_price_and_image_when_the_shop_refuses(monkeypatch):
    """The meshki symptom: a refused fetch rendered image:null / price:null.
    With a cache entry in hand we serve that instead of the empty shape."""
    _install_fake_scrape(monkeypatch)
    server._bs_scan('shop.example')          # warm the cache

    # Now the shop blocks us, exactly as meshki did to the droplet IP.
    _install_fake_scrape(monkeypatch, product_status=429)
    # Expire the entries so the scan actually retries the network.
    for entry in server._BS_PROD_CACHE.values():
        entry['ts'] -= server._BS_PROD_TTL + 1

    payload, blocked = server._bs_scan('shop.example')
    assert blocked is None
    for p in payload['products']:
        assert p['price'] == '89.00'
        assert p['image'] == 'https://cdn.example/abel.jpg'


def test_a_refused_fetch_is_never_cached(monkeypatch):
    """Caching the empty failure shape would turn one 429 into days of nulls."""
    _install_fake_scrape(monkeypatch, product_status=429)

    payload, blocked = server._bs_scan('shop.example')
    assert blocked is None
    assert payload['products'], 'scan should still return the handles it found'
    assert server._BS_PROD_CACHE == {}


def test_cached_entries_stay_small(monkeypatch):
    """The cache is written to disk, so it must not carry body_html and every
    variant/image of every product."""
    _install_fake_scrape(monkeypatch)
    server._bs_scan('shop.example')

    entry = next(iter(server._BS_PROD_CACHE.values()))['p']
    assert 'body_html' not in entry
    assert len(entry['images']) == 1
    assert len(entry['variants']) == 1
    assert entry['images'][0]['src'] == 'https://cdn.example/abel.jpg'
    assert entry['variants'][0]['price'] == '89.00'


def test_scan_knocks_more_gently_than_before(monkeypatch):
    """Plan #3 step 4 also halves burst concurrency per store (was 6)."""
    assert server._BS_WORKERS <= 3


def test_expired_entries_are_pruned_on_save(monkeypatch):
    server._BS_PROD_CACHE['shop.example/old'] = {'ts': 0, 'p': {'title': 'ancient'}}
    server._BS_PROD_CACHE['shop.example/new'] = {'ts': server.time.time(), 'p': {'title': 'fresh'}}

    server._bs_prod_cache_save()

    assert 'shop.example/old' not in server._BS_PROD_CACHE
    assert 'shop.example/new' in server._BS_PROD_CACHE
