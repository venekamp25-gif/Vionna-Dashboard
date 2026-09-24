# -*- coding: utf-8 -*-
"""Home Decor copy: no markdown in the editor, and keywords/copy anchored on the
lamp TYPE the operator typed.

venek, 2026-09-24: a "Stekkerlamp" was researched and written up as a
"hanglamp" (the copy prompt never saw the type), and the description showed
literal '**Glazen kap**:' bullets (the prompt asked for them).
"""
import json

import pytest

import server


# ── markdown out of the editor, emphasis kept on the storefront ────────────
def test_md_strip_removes_bold_italic_and_headings():
    s = "Licht dat meebeweegt\n\n- **Oplaadbaar**: urenlang licht\n- __Draagbaar__: compact\n## Kop\n*zacht* licht"
    out = server._md_strip(s)
    assert '**' not in out and '__' not in out and '#' not in out
    assert '- Oplaadbaar: urenlang licht' in out and '- Draagbaar: compact' in out
    assert 'zacht licht' in out
    assert server._md_strip('2 x 3 * 4') == '2 x 3 * 4'          # a lone asterisk is not markdown


def test_lighting_html_bolds_the_leadin_without_markdown():
    text = "Intro.\n\n- Glazen kap: licht valt precies waar je zit\n- Compacte vorm: past overal\n\nSlot."
    html = server._publish_to_html(text, bold_leadin=True)
    assert '<li><strong>Glazen kap</strong>: licht valt precies waar je zit</li>' in html
    assert '<li><strong>Compacte vorm</strong>: past overal</li>' in html
    assert '**' not in html
    # the fashion path is untouched: no lead-in bolding unless asked
    assert '<strong>' not in server._publish_to_html(text)
    # legacy **bold** still renders as <strong>, and never double-wraps
    html2 = server._publish_to_html("- **Kap**: x", bold_leadin=True)
    assert html2.count('<strong>') == 1 and '<strong>Kap</strong>: x' in html2


# ── lamp-type families ─────────────────────────────────────────────────────
@pytest.mark.parametrize('kw,ptype,conflict', [
    ('hanglamp', 'Stekkerlamp', True),
    ('glazen hanglamp voor eettafel', 'stekkerlamp', True),
    ('pendelleuchte esstisch', 'Steckdosenlampe', True),
    ('plug in night light', 'Plug-in lamp', False),
    ('nachtlampje stopcontact', 'Stekkerlamp', False),
    ('warm licht eettafel', 'Stekkerlamp', False),          # no type word → never a conflict
    ('zwarte hanglamp', 'Hanglamp', False),
    ('vloerlamp woonkamer', 'Hanglamp', True),
    ('hanglamp', 'Lamp', False),                             # type not placeable → never blocks
    ('led strip keuken', 'LED strip', False),
    ('tuinlamp solar', 'Buitenlamp', False),
])
def test_type_conflict(kw, ptype, conflict):
    assert server._light_type_conflict(kw, ptype) is conflict


def test_research_drops_other_lamp_types_for_light_markets(monkeypatch):
    monkeypatch.setattr(server, '_dfs_configured', lambda: True)
    monkeypatch.setattr(server, '_derive_seeds_llm', lambda *a, **k: {'nl': ['stekkerlamp']})
    monkeypatch.setattr(server, '_dfs_keyword_suggestions', lambda seed, st, min_volume=0, limit=20: [
        {'keyword': 'hanglamp', 'volume': 33100}, {'keyword': 'stekkerlamp', 'volume': 1200},
        {'keyword': 'nachtlampje stopcontact', 'volume': 900}, {'keyword': 'lamp stopcontact', 'volume': 600}])
    monkeypatch.setattr(server, '_dfs_clean_keywords_llm', lambda kws, st, **k: kws)
    monkeypatch.setattr(server, '_recommend_keywords', lambda kws, st, top_n=6: kws)
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', None)
    monkeypatch.setenv('DEV_LOCAL', '1')
    server.app.config['TESTING'] = True
    with server.app.test_client() as c:
        body = c.post('/api/research_keywords', json={
            'stores': ['nl'], 'product_name': 'PLUGIFY AORA', 'competitor_title': 'Glow',
            'category': 'Stekkerlamp', 'description': 'plug-in lamp', 'min_volume': 100}).get_json()
    res = body['results']['nl']
    assert [k['keyword'] for k in res['keywords']] == ['stekkerlamp', 'nachtlampje stopcontact', 'lamp stopcontact']
    assert res['type_dropped'] == 1 and res['product_type'] == 'Stekkerlamp'


def test_copy_prompt_carries_the_type_and_output_has_no_asterisks(monkeypatch):
    captured = {}

    class _Msg:
        content = [type('T', (), {'text': json.dumps({
            'description': 'Licht.\n\n- **Oplaadbaar**: urenlang\n- **Compact**: klein',
            'meta_description': '**PLUGIFY** stekkerlamp', 'm_title_specs': 'Stekkerlamp *warm*'})})()]

    class _Client:
        def __init__(self, api_key=None):
            self.messages = self

        def create(self, **kw):
            captured['prompt'] = kw['messages'][0]['content']
            return _Msg()
    import anthropic
    monkeypatch.setattr(anthropic, 'Anthropic', _Client)
    monkeypatch.setattr(server, 'ANTHROPIC_KEY', 'test-key')
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', None)
    monkeypatch.setenv('DEV_LOCAL', '1')
    server.app.config['TESTING'] = True
    with server.app.test_client() as c:
        body = c.post('/api/lighting/generate', json={
            'store': 'nl', 'product_name': 'PLUGIFY AORA', 'product_title': 'Glow', 'product_type': 'Stekkerlamp',
            'source_text': 'Een lamp voor in het stopcontact.',
            'keywords': ['hanglamp', 'glazen hanglamp', 'stekkerlamp', 'nachtlampje stopcontact']}).get_json()
    assert 'Het producttype is: Stekkerlamp' in captured['prompt']
    assert 'hanglamp' not in captured['prompt'].split('Keywords')[1].split('\n')[0]
    assert 'GEEN markdown' in captured['prompt'] and '**eigenschap**' not in captured['prompt']
    assert body['type_dropped'] == ['hanglamp', 'glazen hanglamp']
    for k in ('description', 'meta_description', 'm_title_specs'):
        assert '*' not in body[k], (k, body[k])
    assert '- Oplaadbaar: urenlang' in body['description']
