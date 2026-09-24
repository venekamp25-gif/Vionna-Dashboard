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
        a = _FakeClient.answers.pop(0)
        txt = a if isinstance(a, str) else json.dumps(a)
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


# ── v1.309: fixes from the adversarial review of PR #66 ───────────────────
def test_retry_without_usable_text_never_replaces_the_first_answer(gen):
    """A prose / truncated retry scored 0 and 'won' → empty card, no flags."""
    _FakeClient.answers = [
        {'description': DUTCH, 'meta_description': 'x', 'm_title_specs': 'y'},
        'Entschuldigung, hier ist die Beschreibung ohne JSON.',
    ]
    body = gen('de')
    assert body['description'] == DUTCH
    assert body['language_mismatch'] is True and body['type_mismatch'] == ['tafellamp']


def test_retry_that_fails_transiently_keeps_the_first_answer_and_its_flags(gen):
    """429 on the retry is not a verdict: answer one + warning, never a 502."""
    class Boom(Exception):
        pass

    def create(self, **kw):
        _FakeClient.prompts.append(kw['messages'][0]['content'])
        if len(_FakeClient.prompts) == 2:
            raise Boom('429 rate limited')
        return type('M', (), {'content': [type('T', (), {'text': json.dumps(
            {'description': DUTCH, 'meta_description': 'x', 'm_title_specs': 'y'})})()]})()
    orig = _FakeClient.create
    _FakeClient.create = create
    try:
        body = gen('de')
    finally:
        _FakeClient.create = orig
    assert body['description'] == DUTCH
    assert body['language_mismatch'] is True and 'error' not in body


def test_wrong_language_weighs_more_than_one_stray_type_word(gen):
    german_with_word = GERMAN.replace('eine Steckdosenlampe', 'eine kleine Tischlampe')
    _FakeClient.answers = [
        {'description': german_with_word, 'meta_description': 'a', 'm_title_specs': 'b'},
        {'description': DUTCH.replace('tafellamp', 'stekkerlamp'), 'meta_description': 'a', 'm_title_specs': 'b'},
    ]
    body = gen('de')
    assert body['description'] == german_with_word          # right language kept
    assert body['type_mismatch'] == ['tischlampe'] and not body.get('language_mismatch')


def test_correction_names_the_stores_own_type_word(gen):
    _FakeClient.answers = [
        {'description': DUTCH, 'meta_description': 'x', 'm_title_specs': 'y'},
        {'description': GERMAN, 'meta_description': 'a', 'm_title_specs': 'b'},
    ]
    gen('de')
    p = _FakeClient.prompts[1]
    assert 'het is een Steckdosenlampe (Duits)' in p and 'een Stekkerlamp.' not in p


def test_portable_is_an_attribute_not_a_rival_type():
    # keyword research: 'draadloze lamp' is fine for an oplaadbare tafellamp
    assert server._light_type_conflict('draadloze lamp', 'Oplaadbare tafellamp') is False
    assert server._light_type_conflict('hanglamp', 'Oplaadbare tafellamp') is True
    # brief guard: portable seeds survive, the family is the placement
    b = server._light_brief_guard({'family': 'portable', 'type': {'nl': 'tafellamp'},
                                   'search_terms': {'nl': ['oplaadbare lamp', 'tafellamp', 'hanglamp']}},
                                  'Oplaadbare tafellamp')
    assert b['family'] == 'table' and b['search_terms'] == {'nl': ['oplaadbare lamp', 'tafellamp']}
    assert b['terms_dropped'] == ['hanglamp']
    # copy check: 'oplaadbare lamp' in the text of a table lamp is not a rival
    assert server._light_type_words_in('Een oplaadbare lamp voor op tafel.', exclude={'table'}) == []


def test_multi_family_type_and_prose_words_are_not_flagged():
    fams = server._light_type_families('Plug-in wall light', placement_only=True)
    assert fams == {'plugin', 'wall'}
    assert server._light_type_words_in('This plug-in wall light sits in any socket.', exclude=fams) == []
    assert server._light_type_words_in('creates warm spots of light on the table', exclude={'pendant'}) == []
    assert server._light_type_words_in('Perfect als nachtlampje op het nachtkastje', exclude={'table'}) == []
    assert server._light_type_words_in('Deze tafellamp past overal.', exclude={'plugin'}) == ['tafellamp']
    b = server._light_brief_guard({'family': 'plugin', 'type': {'nl': 'stekkerlamp'},
                                   'search_terms': {'nl': ['wandlamp stopcontact', 'stekkerlamp', 'hanglamp']}},
                                  'Plug-in wall light')
    assert b['search_terms'] == {'nl': ['wandlamp stopcontact', 'stekkerlamp']} and b['terms_dropped'] == ['hanglamp']


def test_guard_survives_a_family_that_is_not_a_string():
    b = server._light_brief_guard({'family': ['plugin'], 'type': {'nl': 'stekkerlamp'}}, '')
    assert b['family'] == 'plugin' and b['family_source'] == 'type words'
    assert server._light_brief_guard({'family': {'x': 1}, 'type': 'nope'}, '')['family'] == 'other'


def test_understand_without_json_is_an_error_not_an_empty_brief(monkeypatch):
    import anthropic
    monkeypatch.setattr(anthropic, 'Anthropic', _FakeClient)
    monkeypatch.setattr(server, 'ANTHROPIC_KEY', 'test-key')
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', None)
    monkeypatch.setenv('DEV_LOCAL', '1')
    _FakeClient.answers, _FakeClient.prompts = ['Ik kan dit niet lezen.'], []
    server.app.config['TESTING'] = True
    with server.app.test_client() as c:
        r = c.post('/api/lighting/understand', json={'source_text': 'x y z', 'product_title': 'Glow'})
    assert r.status_code == 502 and 'no JSON' in r.get_json()['error']
