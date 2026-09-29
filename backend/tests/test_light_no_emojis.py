# -*- coding: utf-8 -*-
"""No emoji reaches a lighting store (Google Merchant Center disapproves them).

venek, 2026-09-29: 22 of 112 .com descriptions carried ✔/✅/☀ emojis. The
Home Decor portal's copy goes through _md_strip on generate AND publish."""
import server


def test_emoji_bullets_become_dash_bullets_and_other_emojis_go():
    txt = ('Licht dat meegaat ✨\n\n✅ Oplaadbaar: 8 uur licht\n✔️ IP54: tegen regen\n'
           '  🌞 Zonne-energie: laadt overdag\nBeoordeeld 4.4 ★ door klanten')
    out = server._md_strip(txt)
    assert out == ('Licht dat meegaat\n\n- Oplaadbaar: 8 uur licht\n- IP54: tegen regen\n'
                   '- Zonne-energie: laadt overdag\nBeoordeeld 4.4 door klanten')
    assert not server._COPY_EMOJI_RE.search(out)


def test_normal_copy_is_untouched():
    txt = 'De PLUGIFY Aora™ — warm licht.\n\n- Dimbaar: 0–100%\n- 2 watt'
    assert server._md_strip(txt) == txt


def test_publish_strips_emojis_from_every_field(monkeypatch):
    import json
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', None)
    monkeypatch.setenv('DEV_LOCAL', '1')
    monkeypatch.setattr(server, 'ANTHROPIC_KEY', '')
    monkeypatch.setattr(server, 'LIGHT_TOKENS', {'com': {'shop': 'com-x.myshopify.com', 'token': 't'}})
    monkeypatch.setattr(server, '_find_product_by_handle', lambda store, handle, hdrs: None)
    monkeypatch.setattr(server, '_publish_to_all_channels', lambda store, pid, hdrs: ([], []))
    monkeypatch.setattr(server, '_append_history', lambda entry, portal=None: None)
    sent = {}

    class R:
        def __init__(self, status, body):
            self.status_code, self._b, self.text = status, body, json.dumps(body)

        def json(self):
            return self._b

    def post(url, headers=None, json=None, timeout=None):
        if url.endswith('/products.json'):
            sent['product'] = json['product']
            return R(201, {'product': {'id': 1, 'variants': [{'id': 2}]}})
        sent.setdefault('metafields', []).append(json['metafield'])
        return R(201, {})
    monkeypatch.setattr(server.req, 'post', post)
    monkeypatch.setattr(server.req, 'put', lambda *a, **k: R(200, {}))
    with server.app.test_client() as c:
        c.post('/api/lighting/publish', json={
            'stores': ['com'], 'product_name': 'PLUGIFY One', 'price': '39',
            'content': {'com': {'description': '✅ Plug it in\n✔ Warm light ☀️',
                                'meta_description': 'Warm light 🌙 at night', 'm_title_specs': '✨ Plug-in light'}}})
    assert not server._COPY_EMOJI_RE.search(sent['product']['body_html'])
    assert all(not server._COPY_EMOJI_RE.search(str(m['value'])) for m in sent['metafields'])
    assert any(m['value'] == 'Warm light at night' for m in sent['metafields'])
