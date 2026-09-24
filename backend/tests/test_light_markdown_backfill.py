# -*- coding: utf-8 -*-
"""The one-shot repair of live lighting descriptions with literal '**'."""
import json

import server


class _R:
    def __init__(self, status, body, link=''):
        self.status_code, self._body, self.headers = status, body, {'Link': link}

    def json(self):
        return self._body


def test_only_products_with_literal_asterisks_are_rewritten(monkeypatch, tmp_path):
    monkeypatch.setattr(server, 'LIGHT_MD_FIX_STATE', str(tmp_path / 'state.json'))
    monkeypatch.setattr(server, 'LIGHT_TOKENS', {'nl': {'shop': 'x.myshopify.com', 'token': 't'}})
    monkeypatch.setattr(server, 'shopify_url', lambda k, path: f'https://x/{path}')
    monkeypatch.setattr(server, 'shopify_headers', lambda k: {})
    prods = [{'id': 1, 'title': 'Aora', 'body_html': '<ul><li>**Glazen kap**: licht</li></ul>'},
             {'id': 2, 'title': 'Clean', 'body_html': '<p>fine</p>'},
             {'id': 3, 'title': 'Bold', 'body_html': '<li><strong>ok</strong>: x</li>'}]
    puts = []

    def call(method, url, hdrs, timeout=30, **kw):
        if method == 'get':
            return _R(200, {'products': prods})
        puts.append((url, kw.get('json')))
        return _R(200, {})
    monkeypatch.setattr(server, '_shopify_call', call)
    summary = server._light_markdown_fix_once()
    assert summary['nl']['scanned'] == 3 and summary['nl']['fixed'] == 1 and summary['nl']['failed'] == 0
    assert puts == [('https://x/products/1.json',
                     {'product': {'id': 1, 'body_html': '<ul><li><strong>Glazen kap</strong>: licht</li></ul>'}})]
    state = json.load(open(tmp_path / 'state.json', encoding='utf-8'))
    assert state['done'] is True and state['summary']['nl']['titles'] == ['Aora']


def test_dry_run_writes_nothing_and_a_failed_store_is_reported(monkeypatch, tmp_path):
    monkeypatch.setattr(server, 'LIGHT_MD_FIX_STATE', str(tmp_path / 'state.json'))
    monkeypatch.setattr(server, 'LIGHT_TOKENS', {'nl': {}, 'de': {}})
    monkeypatch.setattr(server, 'shopify_url', lambda k, path: f'https://{k}/{path}')
    monkeypatch.setattr(server, 'shopify_headers', lambda k: {})
    puts = []

    def call(method, url, hdrs, timeout=30, **kw):
        if 'de/' in url:
            return _R(503, {})
        if method == 'get':
            return _R(200, {'products': [{'id': 9, 'title': 'X', 'body_html': '**a**'}]})
        puts.append(url)
        return _R(200, {})
    monkeypatch.setattr(server, '_shopify_call', call)
    summary = server._light_markdown_fix_once(dry_run=True)
    assert puts == []
    assert summary['nl']['fixed'] == 1 and 'HTTP 503' in summary['de']['error']
    assert json.load(open(tmp_path / 'state.json', encoding='utf-8'))['done'] is False


def test_boot_guard_is_pytest_and_dev_local_safe():
    import inspect
    src = inspect.getsource(server)
    i = src.index("target=_light_markdown_fix_boot")
    cond = src[src.rfind('\nif ', 0, i):i]
    assert "'pytest' not in sys.modules" in cond and "os.getenv('DEV_LOCAL') != '1'" in cond
    assert "LIGHT_MD_FIX" in cond
