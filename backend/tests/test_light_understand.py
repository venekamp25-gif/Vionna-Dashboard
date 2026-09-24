# -*- coding: utf-8 -*-
"""Home Decor: understand the product at import, seed research from it, write
in the store's language and never as another lamp type.

venek, 2026-09-24: the DE card came out in Dutch and called a plug-in lamp a
"tafellamp" — the style example in the prompt IS about a table lamp, in Dutch.
"""
import json

import pytest

import server


# ── language guess ─────────────────────────────────────────────────────────
def test_language_guess():
    nl = ('De PLUGIFY Aora is een oplaadbare lamp die je meeneemt van werkplek naar vensterbank, '
          'van eettafel naar nachtkastje. Warm licht in een compact, draadloos ontwerp dat overal past.')
    de = ('Die PLUGIFY Aora ist eine aufladbare Lampe, die du mitnimmst: vom Schreibtisch auf die '
          'Fensterbank, vom Esstisch auf den Nachttisch. Warmes Licht ohne Kabel, das überall passt.')
    en = ('The PLUGIFY Aora is a rechargeable lamp you carry from the desk to the windowsill and from '
          'the dining table to the bedside. Warm light in a compact, cordless design that fits anywhere.')
    assert server._light_lang_guess(nl)[0] == 'nl'
    assert server._light_lang_guess(de)[0] == 'de'
    assert server._light_lang_guess(en)[0] == 'com'
    assert server._light_lang_guess('Aora')[0] is None            # too short to judge


# ── brief guard: operator > model, off-type terms dropped ──────────────────
def test_brief_guard_operator_type_wins_and_drops_off_type_terms():
    raw = {'family': 'table', 'type': {'nl': 'tafellamp', 'de': 'Tischlampe', 'com': 'table lamp'},
           'what': 'Een lamp.', 'placement': 'tafel', 'power': 'rechargeable', 'features': ['x'] * 9,
           'search_terms': {'nl': ['tafellamp', 'stekkerlamp', 'nachtlampje stopcontact'],
                            'de': ['tischlampe', 'steckdosenlampe'], 'com': ['table lamp', 'plug in night light']}}
    b = server._light_brief_guard(raw, product_type='Stekkerlamp')
    assert b['family'] == 'plugin' and b['family_source'] == 'operator'
    assert b['search_terms'] == {'nl': ['stekkerlamp', 'nachtlampje stopcontact'],
                                 'de': ['steckdosenlampe'], 'com': ['plug in night light']}
    assert b['terms_dropped'] == ['tafellamp', 'tischlampe', 'table lamp']
    assert len(b['features']) == 6


def test_brief_guard_uses_type_words_when_model_family_disagrees():
    raw = {'family': 'table', 'type': {'nl': 'stekkerlamp', 'de': 'Steckdosenlampe', 'com': 'plug-in light'},
           'search_terms': {'nl': ['stekkerlamp']}}
    b = server._light_brief_guard(raw, product_type='')
    assert b['family'] == 'plugin' and b['family_source'] == 'type words'


def test_brief_guard_keeps_model_family_when_nothing_else_is_known():
    b = server._light_brief_guard({'family': 'pendant', 'type': {'nl': 'lamp'}, 'search_terms': {'nl': ['lamp']}})
    assert b['family'] == 'pendant' and b['family_source'] == 'model'
    assert server._light_brief_guard({}, '')['family'] == 'other'


# ── research uses the brief's terms as seeds ───────────────────────────────
def test_research_seeds_come_from_the_brief(monkeypatch):
    monkeypatch.setattr(server, '_dfs_configured', lambda: True)
    monkeypatch.setattr(server, '_derive_seeds_llm',
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError('derived seeds asked')))
    seen = []

    def sugg(seed, st, min_volume=0, limit=20):
        seen.append(seed)
        return [{'keyword': f'{seed} zwart', 'volume': 500}]
    monkeypatch.setattr(server, '_dfs_keyword_suggestions', sugg)
    monkeypatch.setattr(server, '_dfs_clean_keywords_llm', lambda kws, st, **k: kws)
    monkeypatch.setattr(server, '_recommend_keywords', lambda kws, st, top_n=6: kws)
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', None)
    monkeypatch.setenv('DEV_LOCAL', '1')
    server.app.config['TESTING'] = True
    with server.app.test_client() as c:
        body = c.post('/api/research_keywords', json={
            'stores': ['nl'], 'product_name': 'X', 'competitor_title': 'Glow', 'category': 'Stekkerlamp',
            'min_volume': 100, 'seed_terms': {'nl': ['stekkerlamp', 'nachtlampje stopcontact']}}).get_json()
    assert seen == ['stekkerlamp', 'nachtlampje stopcontact']
    assert body['results']['nl']['seeds'] == ['stekkerlamp', 'nachtlampje stopcontact']


# ── copy: language + type enforced, one retry, flags when it still fails ───
class _FakeClient:
    answers = []
    prompts = []

    def __init__(self, api_key=None):
        self.messages = self

    def create(self, **kw):
        _FakeClient.prompts.append(kw['messages'][0]['content'])
        txt = json.dumps(_FakeClient.answers.pop(0))
        return type('M', (), {'content': [type('T', (), {'text': txt})()]})()


@pytest.fixture()
def gen(monkeypatch):
    import anthropic
    monkeypatch.setattr(anthropic, 'Anthropic', _FakeClient)
    monkeypatch.setattr(server, 'ANTHROPIC_KEY', 'test-key')
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', None)
    monkeypatch.setenv('DEV_LOCAL', '1')
    _FakeClient.answers, _FakeClient.prompts = [], []
    server.app.config['TESTING'] = True

    def run(store='de', **extra):
        with server.app.test_client() as c:
            return c.post('/api/lighting/generate', json={
                'store': store, 'product_name': 'PLUGIFY Aora', 'product_title': 'Glow',
                'product_type': 'Stekkerlamp', 'source_text': 'Lamp in het stopcontact met warm licht.',
                'brief': {'family': 'plugin', 'type': {'nl': 'stekkerlamp', 'de': 'Steckdosenlampe',
                                                       'com': 'plug-in light'},
                          'what': 'Een lamp die je in het stopcontact steekt.', 'power': 'socket',
                          'placement': 'stopcontact', 'features': ['warm licht']}, **extra}).get_json()
    return run


DUTCH = ('De PLUGIFY Aora is een oplaadbare tafellamp die je meeneemt van werkplek naar vensterbank, '
         'van eettafel naar nachtkastje. Warm licht in een compact ontwerp dat overal thuishoort.')
GERMAN = ('Die PLUGIFY Aora ist eine Steckdosenlampe, die du einfach in die Steckdose steckst. Warmes Licht '
          'ohne Kabel, das im Flur, im Schlafzimmer oder in der Küche überall passt und nicht stört.')


def test_dutch_answer_for_de_is_retried_and_the_german_retry_wins(gen):
    _FakeClient.answers = [
        {'description': DUTCH, 'meta_description': 'x', 'm_title_specs': 'y'},
        {'description': GERMAN, 'meta_description': 'Steckdosenlampe', 'm_title_specs': 'Steckdosenlampe'},
    ]
    body = gen('de')
    assert len(_FakeClient.prompts) == 2
    assert 'CORRECTIE' in _FakeClient.prompts[1] and 'Duits' in _FakeClient.prompts[1]
    assert 'tafellamp' in _FakeClient.prompts[1]                 # the wrong type word is named
    assert body['description'] == GERMAN
    assert not body.get('language_mismatch') and not body.get('type_mismatch')


def test_still_wrong_after_retry_is_flagged_not_hidden(gen):
    _FakeClient.answers = [
        {'description': DUTCH, 'meta_description': 'x', 'm_title_specs': 'y'},
        {'description': DUTCH, 'meta_description': 'x', 'm_title_specs': 'y'},
    ]
    body = gen('de')
    assert body['language_mismatch'] is True
    assert body['type_mismatch'] == ['tafellamp']


def test_prompt_names_language_type_and_brief(gen):
    _FakeClient.answers = [{'description': GERMAN, 'meta_description': 'a', 'm_title_specs': 'b'}]
    gen('de')
    p = _FakeClient.prompts[0]
    assert 'in het Duits (German)' in p and 'ANDER product (een tafellamp)' in p
    assert 'Het producttype is: Stekkerlamp' in p and 'Steckdosenlampe' in p
    assert 'Een lamp die je in het stopcontact steekt.' in p and 'Voeding: socket' in p


def test_correct_first_answer_needs_no_retry(gen):
    _FakeClient.answers = [{'description': GERMAN, 'meta_description': 'a', 'm_title_specs': 'b'}]
    body = gen('de')
    assert len(_FakeClient.prompts) == 1 and body['description'] == GERMAN


# ── understand endpoint ────────────────────────────────────────────────────
def test_understand_endpoint_returns_a_guarded_brief(monkeypatch):
    import anthropic
    monkeypatch.setattr(anthropic, 'Anthropic', _FakeClient)
    monkeypatch.setattr(server, 'ANTHROPIC_KEY', 'test-key')
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', None)
    monkeypatch.setenv('DEV_LOCAL', '1')
    _FakeClient.answers = [{'family': 'table', 'type': {'nl': 'stekkerlamp', 'de': 'Steckdosenlampe',
                                                       'com': 'plug-in night light'},
                            'what': 'Lamp in het stopcontact.', 'placement': 'stopcontact', 'power': 'socket',
                            'features': ['warm licht'], 'search_terms': {'nl': ['stekkerlamp', 'hanglamp']}}]
    _FakeClient.prompts = []
    server.app.config['TESTING'] = True
    with server.app.test_client() as c:
        body = c.post('/api/lighting/understand', json={
            'source_text': 'Steek hem in het stopcontact.', 'product_title': 'Glow'}).get_json()
    assert body['ok'] and body['family'] == 'plugin'
    assert body['search_terms'] == {'nl': ['stekkerlamp']} and body['terms_dropped'] == ['hanglamp']
    assert "family 'plugin'" in _FakeClient.prompts[0]
