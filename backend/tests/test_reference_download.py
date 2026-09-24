# -*- coding: utf-8 -*-
"""A reference photo that cannot be loaded must not be skipped silently.

2026-09-24: the four background references (rosamae.com CDN) had been 404 for
weeks. /api/higgsfield swallowed the download error, ran step 1 with only the
competitor photo, and every product came out with a different background —
nobody could see why. Now: the FIRST reference (background / our model) failing
fails the call; later ones are skipped but reported.
"""
import subprocess

import pytest

import server

PNG = b'\x89PNG\r\n\x1a\n' + b'\x00' * 64
OUT_URL = 'https://cdn.higgsfield.ai/out/a.png'


@pytest.fixture()
def client():
    server.app.config['TESTING'] = True
    with server.app.test_client() as c:
        yield c


@pytest.fixture(autouse=True)
def _open_gate(monkeypatch):
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', None)
    monkeypatch.setenv('DEV_LOCAL', '1')
    monkeypatch.setenv('PUBLIC_BASE_URL', 'https://droplet.example')


def _stub_cli(monkeypatch):
    stdout = '{"jobs":[{"output_url":"%s"}]}' % OUT_URL
    monkeypatch.setattr(server.subprocess, 'run',
                        lambda cmd, **kw: subprocess.CompletedProcess(cmd, 0, stdout, ''))
    monkeypatch.setattr(server, 'HIGGSFIELD_EXE', __file__)
    monkeypatch.setattr(server, '_hf_fetch_bytes', lambda url, timeout=30: PNG)


class _Resp:
    def __init__(self, status, content=b'', ctype='image/jpeg'):
        self.status_code, self.content, self.headers = status, content, {'Content-Type': ctype}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f'HTTP {self.status_code}')


def _fake_get(table):
    def get(url, timeout=15, **kw):
        return table[url]
    return get


def test_dead_background_reference_fails_the_step_loudly(client, monkeypatch):
    _stub_cli(monkeypatch)
    monkeypatch.setattr(server, '_scrape_get', _fake_get({
        'https://cdn.example/bg.jpg': _Resp(404, b'<html>not found</html>', 'text/html'),
        'https://cdn.example/competitor.jpg': _Resp(200, PNG),
    }))
    r = client.post('/api/higgsfield', json={'prompt_type': 1, 'product_type': 'dress', 'count': 1,
                                             'image_urls': ['https://cdn.example/bg.jpg',
                                                            'https://cdn.example/competitor.jpg']})
    assert r.status_code == 502
    body = r.get_json()
    assert 'reference photo' in body['error'] and 'background reference' in body['error']
    assert body['missing_refs'] == ['https://cdn.example/bg.jpg']


def test_html_body_with_200_is_not_an_image(client, monkeypatch):
    # A password page / bot challenge answers 200 with HTML — that is not a photo.
    _stub_cli(monkeypatch)
    monkeypatch.setattr(server, '_scrape_get', _fake_get({
        'https://cdn.example/bg.jpg': _Resp(200, b'<html>Just a moment</html>', 'text/html; charset=utf-8'),
    }))
    r = client.post('/api/higgsfield', json={'prompt_type': 1, 'product_type': 'dress', 'count': 1,
                                             'image_urls': ['https://cdn.example/bg.jpg']})
    assert r.status_code == 502


def test_a_missing_colour_sample_is_skipped_but_reported(client, monkeypatch):
    _stub_cli(monkeypatch)
    monkeypatch.setattr(server, '_scrape_get', _fake_get({
        'https://cdn.example/model.jpg': _Resp(200, PNG),
        'https://cdn.example/colour-a.jpg': _Resp(200, PNG),
        'https://cdn.example/colour-b.jpg': _Resp(403, b'', 'text/html'),
    }))
    r = client.post('/api/higgsfield', json={'prompt_type': 11, 'product_type': 'dress', 'color': 'red',
                                             'count': 1,
                                             'image_urls': ['https://cdn.example/model.jpg',
                                                            'https://cdn.example/colour-a.jpg',
                                                            'https://cdn.example/colour-b.jpg']})
    body = r.get_json()
    assert r.status_code == 200 and body.get('urls')
    assert body['missing_refs'] == ['https://cdn.example/colour-b.jpg']


def test_all_references_fine_means_no_missing_refs(client, monkeypatch):
    _stub_cli(monkeypatch)
    monkeypatch.setattr(server, '_scrape_get', _fake_get({'https://cdn.example/model.jpg': _Resp(200, PNG)}))
    r = client.post('/api/higgsfield', json={'prompt_type': 2, 'product_type': 'dress', 'count': 1,
                                             'image_urls': ['https://cdn.example/model.jpg']})
    body = r.get_json()
    assert r.status_code == 200 and body.get('urls') and not body.get('missing_refs')
