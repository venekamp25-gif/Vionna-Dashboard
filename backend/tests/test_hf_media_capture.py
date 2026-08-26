"""Generated photos must be OURS by the time the draft holds them (plan #9, bug #46).

On 26 Aug 2026 nine products were created with zero images across three stores.
Nothing in the dashboard was broken: the employee had selected twelve photos and
the publish call sent four URLs per product. The URLs were dead. Every object
Higgsfield produced that morning answered 403 from the first second — older
objects in the same bucket, under the same user prefix, still answer 200 — so by
the time publish ran hours later, `_build_image_payload` could not download a
single one, fell back to `{'src': url}`, and Shopify accepted that with a 201
before failing the identical fetch itself.

The fix is not a better error message; it is not holding a foreign URL at all.
These tests pin that:

  1. /api/higgsfield captures the bytes at generation and hands back our URL;
  2. a result it cannot download never becomes a selectable tile;
  3. /api/hf_media serves what was captured, and nothing else on the droplet;
  4. "Retry fix" can genuinely re-attach photos to a photoless product;
  5. /api/selftest?what=higgsfield downloads the test image instead of trusting
     that a URL came back — the check that waved this whole outage through.
"""
import subprocess

import pytest

import server


PNG = b'\x89PNG\r\n\x1a\n' + b'pixels' * 32
JPG = b'\xff\xd8\xff\xe0' + b'pixels' * 32
OUT_URL = f'https://{server.HIGGSFIELD_OUTPUT_CDN}/user_x/hf_20260826_103904_min.webp'
OUT_URL_2 = f'https://{server.HIGGSFIELD_OUTPUT_CDN}/user_x/hf_20260826_103905_min.webp'


class _Resp:
    """Minimal stand-in for a requests Response."""

    def __init__(self, status_code=200, content=b'', payload=None):
        self.status_code = status_code
        self.content = content
        self.text = ''
        self._payload = payload if payload is not None else {}

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            err = server.req.exceptions.HTTPError(f'{self.status_code} error')
            err.response = self
            raise err


@pytest.fixture()
def client():
    server.app.config['TESTING'] = True
    with server.app.test_client() as c:
        yield c


@pytest.fixture(autouse=True)
def _open_gate(monkeypatch):
    """The gated routes here are exercised through the local-dev no-op."""
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', None)
    monkeypatch.setenv('DEV_LOCAL', '1')
    monkeypatch.setenv('PUBLIC_BASE_URL', 'https://droplet.example')


def _stub_cli(monkeypatch, *urls):
    """Make the Higgsfield CLI 'return' these output URLs, one per job."""
    stdout = '{"jobs":[%s]}' % ','.join('{"output_url":"%s"}' % u for u in urls)

    def _run(cmd, **kw):
        return subprocess.CompletedProcess(cmd, 0, stdout, '')

    monkeypatch.setattr(server.subprocess, 'run', _run)
    monkeypatch.setattr(server, 'HIGGSFIELD_EXE', __file__)   # any real file


def _generate(client, count=1):
    return client.post('/api/higgsfield', json={'prompt_type': 0, 'prompt': 'x',
                                                'product_type': 'dress',
                                                'image_urls': [], 'count': count})


# ── 1. The bytes are captured, and our URL is what comes back ───────────────

def test_a_generated_image_is_stored_and_served_from_our_own_url(client, monkeypatch):
    _stub_cli(monkeypatch, OUT_URL)
    monkeypatch.setattr(server, '_hf_fetch_bytes', lambda url, timeout=30: PNG)

    body = _generate(client).get_json()

    assert body.get('error') is None
    urls = body['urls']
    assert len(urls) == 1
    assert server.HIGGSFIELD_OUTPUT_CDN not in urls[0], (
        'the draft must not keep a Higgsfield URL — that is the whole bug')
    assert urls[0].startswith('https://droplet.example/api/hf_media/hf_')
    assert body['generated'] == 1 and body['unreachable'] == 0

    # And the bytes are really there, served by us.
    served = client.get(urls[0].split('https://droplet.example')[1])
    assert served.status_code == 200
    assert served.data == PNG


def test_b_the_same_image_twice_is_stored_once(client, monkeypatch):
    """Content-addressed names: a re-roll of an identical result costs no disk."""
    _stub_cli(monkeypatch, OUT_URL)
    monkeypatch.setattr(server, '_hf_fetch_bytes', lambda url, timeout=30: PNG)

    first = _generate(client).get_json()['urls'][0]
    second = _generate(client).get_json()['urls'][0]

    assert first == second
    assert len(server.os.listdir(server.HF_MEDIA_DIR)) == 1


# ── 2. A result we cannot download never enters the draft ───────────────────

def test_c_an_unreachable_result_is_dropped_not_handed_over(client, monkeypatch):
    """Bug #46 exactly: the CLI says success, the URL answers 403.

    Before this fix the URL went into the draft, was selected, was published,
    and produced a product with no photo and no error anywhere."""
    _stub_cli(monkeypatch, OUT_URL)

    def _dead(url, timeout=30):
        resp = _Resp(status_code=403)
        resp.raise_for_status()

    monkeypatch.setattr(server, '_hf_fetch_bytes', _dead)

    r = _generate(client)
    body = r.get_json()

    assert r.status_code == 502, 'a generation with nothing downloadable is not a success'
    assert body['urls'] == []
    assert body['generated'] == 1 and body['unreachable'] == 1
    assert 'HTTP 403' in body['error']
    assert server.os.listdir(server.HF_MEDIA_DIR) == []


def test_d_html_error_page_with_a_200_is_not_an_image(client, monkeypatch):
    """A CDN that answers 200 with an error page must not become a 'photo'."""
    _stub_cli(monkeypatch, OUT_URL)
    monkeypatch.setattr(server, '_hf_fetch_bytes',
                        lambda url, timeout=30: b'<!doctype html><title>AccessDenied</title>')

    r = _generate(client)

    assert r.status_code == 502
    assert 'not an image' in r.get_json()['error']


def test_e_the_reachable_half_of_a_batch_still_comes_through(client, monkeypatch):
    """One dead result must not throw away the ones that did work."""
    _stub_cli(monkeypatch, OUT_URL)
    calls = {'n': 0}

    def _half(url, timeout=30):
        calls['n'] += 1
        if calls['n'] == 1:
            return JPG
        _Resp(status_code=403).raise_for_status()

    monkeypatch.setattr(server, '_hf_fetch_bytes', _half)
    # Two jobs, two distinct output URLs so both are attempted.
    _stub_cli(monkeypatch, OUT_URL)
    monkeypatch.setattr(server, '_urls_from_stdout', lambda t: [OUT_URL, OUT_URL_2])

    body = _generate(client, count=2).get_json()

    assert len(body['urls']) == 1
    assert body['generated'] == 2 and body['unreachable'] == 1


# ── 3. The serve route hands out captured images and nothing else ──────────

@pytest.mark.parametrize('name', [
    '../../server.py',
    '..%2f..%2fserver.py',
    'tokens.json',
    'hf_notahash.png',
    'hf_' + 'a' * 40 + '.exe',
])
def test_f_the_media_route_refuses_anything_but_a_captured_image(client, name):
    assert client.get(f'/api/hf_media/{name}').status_code == 404


def test_f2_our_own_photos_are_never_fetched_through_the_paid_proxy(monkeypatch):
    """Publish now downloads generated photos from OUR public URL. Sending a few
    MB per photo out to a residential proxy and straight back to us would be
    billed per GB for nothing."""
    monkeypatch.setenv('SCRAPER_PROXY_URL', 'http://user:pass@gateway.example:8000')
    monkeypatch.delenv('SCRAPER_PROXY', raising=False)
    monkeypatch.setenv('PUBLIC_BASE_URL', 'https://droplet.example')

    assert server._scraper_proxies('https://droplet.example/api/hf_media/x.png') is None
    # A competitor shop still goes through it — that is what it is for.
    assert server._scraper_proxies('https://murci.co.uk/products/x.json') is not None


def test_g_pruning_drops_only_what_is_past_retention(monkeypatch):
    old = server.os.path.join(server.HF_MEDIA_DIR, 'hf_' + 'a' * 40 + '.png')
    fresh = server.os.path.join(server.HF_MEDIA_DIR, 'hf_' + 'b' * 40 + '.png')
    for p in (old, fresh):
        with open(p, 'wb') as f:
            f.write(PNG)
    ancient = server.time.time() - (server.HF_MEDIA_RETENTION_DAYS + 1) * 86400
    server.os.utime(old, (ancient, ancient))

    assert server._hf_media_prune() == 1
    assert not server.os.path.exists(old)
    assert server.os.path.exists(fresh)


# ── 4. "Retry fix" can actually re-attach photos ───────────────────────────

def test_h_retry_fix_reattaches_photos_to_a_product_that_has_none(client, monkeypatch):
    """The button the post-publish screen offers for "No images attached" used
    to touch sales channels only, so #43/#44/#45 reported the same thing after
    every retry. It must be able to repair what it is offered for."""
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', 'secret')
    monkeypatch.setitem(server.tokens, 'dk', 'shpat_test')
    monkeypatch.setattr(server, 'shopify_headers', lambda store: {})
    monkeypatch.setattr(server, '_publish_to_default_channels', lambda *a, **kw: [])
    monkeypatch.setattr(server.time, 'sleep', lambda *_: None)
    monkeypatch.setattr(server, '_scrape_get', lambda url, timeout=20: _Resp(content=PNG))
    monkeypatch.setattr(server, 'shopify_url', lambda store, path: f'https://x/{path}')
    # The product has no images yet.
    monkeypatch.setattr(server.req, 'get',
                        lambda url, **kw: _Resp(payload={'images': []}))
    posted = []

    def _post(url, **kw):
        posted.append(kw.get('json'))
        return _Resp(status_code=201, payload={'image': {'id': 1, 'src': 'https://cdn/x.png'}})

    monkeypatch.setattr(server.req, 'post', _post)

    r = client.post('/api/retry_fix',
                    json={'store': 'dk', 'product_ids': [111],
                          'images_by_product': {'111': ['https://droplet.example/api/hf_media/a.png']}},
                    headers={'X-Droplet-Token': server._mint_droplet_token()})
    body = r.get_json()

    assert body['success'] is True
    assert body['images_attached'] == 1, 'the photo must really be attached, not just tried'
    assert 'attachment' in posted[0]['image'], 'bytes, not a src Shopify may never fetch'


def test_i_retry_fix_does_not_duplicate_photos_a_product_already_has(client, monkeypatch):
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', 'secret')
    monkeypatch.setitem(server.tokens, 'dk', 'shpat_test')
    monkeypatch.setattr(server, 'shopify_headers', lambda store: {})
    monkeypatch.setattr(server, '_publish_to_default_channels', lambda *a, **kw: [])
    monkeypatch.setattr(server.time, 'sleep', lambda *_: None)
    monkeypatch.setattr(server, 'shopify_url', lambda store, path: f'https://x/{path}')
    monkeypatch.setattr(server.req, 'get',
                        lambda url, **kw: _Resp(payload={'images': [{'id': 5}]}))

    def _boom(*a, **kw):
        raise AssertionError('a product that already has photos must not be touched')

    monkeypatch.setattr(server.req, 'post', _boom)

    body = client.post('/api/retry_fix',
                       json={'store': 'dk', 'product_ids': [111],
                             'images_by_product': {'111': ['https://droplet.example/x.png']}},
                       headers={'X-Droplet-Token': server._mint_droplet_token()}).get_json()

    assert body['images_attached'] == 0


def test_j_retry_fix_without_image_urls_still_only_does_channels(client, monkeypatch):
    """Old callers keep the old behaviour."""
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', 'secret')
    monkeypatch.setitem(server.tokens, 'dk', 'shpat_test')
    monkeypatch.setattr(server, 'shopify_headers', lambda store: {})
    monkeypatch.setattr(server, '_publish_to_default_channels', lambda *a, **kw: [])
    monkeypatch.setattr(server.time, 'sleep', lambda *_: None)

    def _boom(*a, **kw):
        raise AssertionError('no image work without image URLs')

    monkeypatch.setattr(server.req, 'get', _boom)

    body = client.post('/api/retry_fix', json={'store': 'dk', 'product_ids': [111]},
                       headers={'X-Droplet-Token': server._mint_droplet_token()}).get_json()

    assert body['fixed'] == 1 and body['images_attached'] == 0
