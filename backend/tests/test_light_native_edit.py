# -*- coding: utf-8 -*-
"""v1.312: the whole competitor page reaches the copy step; a native-editor pass
makes the Dutch/German/English natural without touching the facts; the type
word per market is the canonical shop word; '* ' bullets are normalised.

venek, 2026-09-25: "Een blinde muur wordt eindelijk interessant … een zachte
poel licht … Dusk-to-dawn sensor" — word-for-word English; and the German copy
said "Steckdosenlamp" because the brief's type word had a typo.
"""
import json

import pytest

import server


def test_bullets_and_caps():
    assert server._md_strip('* Eigenschap: x\n• Ander: y\n- Derde: z') == '- Eigenschap: x\n- Ander: y\n- Derde: z'
    assert server._PAGE_TEXT_MAX >= 12000


def test_canonical_type_words_replace_the_models_near_miss():
    b = server._light_brief_guard({'family': 'plugin', 'type': {'nl': 'stekkerlamp', 'de': 'Steckdosenlamp', 'com': 'plug in'},
                                   'search_terms': {}}, '')
    assert b['type'] == {'nl': 'stekkerlamp', 'de': 'Steckdosenlampe', 'com': 'plug-in light'}
    assert b['type_model']['de'] == 'Steckdosenlamp'
    # the operator's own Dutch word stays
    b = server._light_brief_guard({'family': 'plugin', 'type': {'nl': 'x', 'de': 'y', 'com': 'z'}}, 'Plug-in nachtlampje')
    assert b['type']['nl'] == 'Plug-in nachtlampje' and b['type']['de'] == 'Steckdosenlampe'
    # unknown family: the model's words stay
    assert server._light_brief_guard({'family': 'other', 'type': {'nl': 'lichtobject', 'de': 'Lichtobjekt', 'com': 'light object'}}, '')['type']['de'] == 'Lichtobjekt'


class _FakeClient:
    answers = []
    prompts = []
    systems = []

    def __init__(self, api_key=None):
        self.messages = self

    def create(self, **kw):
        _FakeClient.prompts.append(kw['messages'][0]['content'])
        _FakeClient.systems.append(kw.get('system') or '')
        a = _FakeClient.answers.pop(0)
        return type('M', (), {'content': [type('T', (), {'text': a if isinstance(a, str) else json.dumps(a)})()]})()


@pytest.fixture()
def gen(monkeypatch):
    import anthropic
    monkeypatch.setattr(anthropic, 'Anthropic', _FakeClient)
    monkeypatch.setattr(server, 'ANTHROPIC_KEY', 'test-key')
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', None)
    monkeypatch.setenv('DEV_LOCAL', '1')
    _FakeClient.answers, _FakeClient.prompts, _FakeClient.systems = [], [], []
    server.app.config['TESTING'] = True

    def run(store='nl', source_text=None, **extra):
        body = {'store': store, 'product_name': 'PLUGIFY Aora', 'product_title': 'Aoraglow',
                'product_type': 'Stekkerlamp', 'keywords': ['stekkerlamp'],
                'source_text': source_text or 'Aoraglow turns any outlet into a warm wall sconce. Plug it in. Dusk-to-dawn sensor. Two watts.',
                'brief': {'family': 'plugin', 'type': {'nl': 'stekkerlamp', 'de': 'Steckdosenlampe', 'com': 'plug-in light'},
                          'what': 'Een stekkerlamp.', 'power': 'socket', 'placement': 'stopcontact', 'features': ['schemersensor']}}
        body.update(extra)
        with server.app.test_client() as c:
            return c.post('/api/lighting/generate', json=body).get_json()
    return run


RAW = ('Een blinde muur wordt eindelijk interessant\n\nDe PLUGIFY Aora is een stekkerlamp die je rechtstreeks in het '
       'stopcontact steekt. Een warme lichtstraal klimt langs de muur omhoog terwijl er onder een zachte poel licht valt.\n\n'
       '- Dusk-to-dawn sensor: gaat vanzelf aan bij schemering\n- Op- en neerwaarts licht: als een ingebouwde wandlamp\n'
       '- 2 watt verbruik: brandt het hele jaar door\n\nDe PLUGIFY Aora steek je één keer in.')
EDITED = ('Een kale muur wordt eindelijk interessant\n\nDe PLUGIFY Aora is een stekkerlamp die je rechtstreeks in het '
          'stopcontact steekt. Een warme lichtstraal loopt langs de muur omhoog, met daaronder een zachte lichtvlek.\n\n'
          '- Schemersensor: gaat vanzelf aan bij schemering\n- Licht naar boven en beneden: als een vaste wandlamp\n'
          '- 2 watt verbruik: brandt het hele jaar door\n\nDe PLUGIFY Aora steek je één keer in.')


def test_editor_pass_makes_the_text_natural_and_reports_what_changed(gen):
    _FakeClient.answers = [
        {'description': RAW, 'meta_description': 'PLUGIFY Aora stekkerlamp', 'm_title_specs': 'Stekkerlamp met sensor'},
        {'description': EDITED, 'meta_description': 'PLUGIFY Aora stekkerlamp', 'm_title_specs': 'Stekkerlamp met schemersensor',
         'changes': ['blinde muur → kale muur', 'poel licht → lichtvlek', 'Dusk-to-dawn sensor → Schemersensor']},
    ]
    body = gen('nl')
    assert body['description'] == EDITED
    assert body['language_pass'] == {'applied': True, 'changes': ['blinde muur → kale muur', 'poel licht → lichtvlek',
                                                                   'Dusk-to-dawn sensor → Schemersensor']}
    assert 'eindredacteur Nederlands' in _FakeClient.systems[1]
    assert 'kale muur' in _FakeClient.prompts[0] and 'letterlijke vertaling' in _FakeClient.prompts[0]
    assert not body.get('language_mismatch') and not body.get('claim_mismatch')


def test_editor_may_fix_words_but_never_facts(gen):
    # a new claim (oplaadbaar) → rejected, first version kept
    bad = EDITED.replace('stekkerlamp die je', 'oplaadbare stekkerlamp die je')
    _FakeClient.answers = [{'description': RAW, 'meta_description': 'a', 'm_title_specs': 'b'},
                           {'description': bad, 'meta_description': 'a', 'm_title_specs': 'b', 'changes': ['x']}]
    body = gen('nl')
    assert body['description'] == RAW and body['language_pass']['applied'] is False
    assert 'claim introduced: oplaadbaar' in body['language_pass']['reason']
    # a bullet dropped → rejected
    fewer = EDITED.replace('- 2 watt verbruik: brandt het hele jaar door\n', '')
    _FakeClient.answers = [{'description': RAW, 'meta_description': 'a', 'm_title_specs': 'b'},
                           {'description': fewer, 'meta_description': 'a', 'm_title_specs': 'b', 'changes': []}]
    body = gen('nl')
    assert body['description'] == RAW and 'bullet count' in body['language_pass']['reason']
    # another lamp type → rejected
    other = EDITED.replace('stekkerlamp die je', 'tafellamp die je')
    _FakeClient.answers = [{'description': RAW, 'meta_description': 'a', 'm_title_specs': 'b'},
                           {'description': other, 'meta_description': 'a', 'm_title_specs': 'b', 'changes': []}]
    body = gen('nl')
    assert body['description'] == RAW and 'another lamp type' in body['language_pass']['reason']


def test_editor_failure_keeps_the_first_version_without_a_502(gen):
    _FakeClient.answers = [{'description': RAW, 'meta_description': 'a', 'm_title_specs': 'b'}]   # editor gets nothing → raises
    body = gen('nl')
    assert body['description'] == RAW and 'error' not in body
    assert body['language_pass']['applied'] is False and 'editor unavailable' in body['language_pass']['reason']


def test_editor_pass_can_be_skipped(gen):
    _FakeClient.answers = [{'description': RAW, 'meta_description': 'a', 'm_title_specs': 'b'}]
    body = gen('nl', skip_language_pass=True)
    assert len(_FakeClient.prompts) == 1 and body['language_pass'] == {'applied': False, 'reason': 'skipped'}


def test_the_whole_page_reaches_the_copy_prompt(gen):
    long_src = 'Aoraglow. ' + ' '.join(f'fact{i}' for i in range(900))       # ≈ 6,300 chars
    _FakeClient.answers = [{'description': RAW, 'meta_description': 'a', 'm_title_specs': 'b'}]
    gen('nl', source_text=long_src, skip_language_pass=True)
    assert 'fact700' in _FakeClient.prompts[0]           # beyond the old 2,500-char cut


# ── publish: every sales channel, one mutation each ────────────────────────
def test_publish_to_all_channels_hits_every_publication_and_isolates_failures(monkeypatch):
    pubs = [{'id': 1, 'name': 'Online Store'}, {'id': 2, 'name': 'Shop'}, {'id': 3, 'name': 'Google & YouTube'},
            {'id': 4, 'name': 'Facebook & Instagram'}, {'id': 5, 'name': 'Point of Sale'}]
    monkeypatch.setattr(server, '_list_publications', lambda store, hdrs: pubs)
    calls = []

    class R:
        status_code = 200

        def __init__(self, pid):
            self.pid = pid

        def json(self):
            if self.pid == 'gid://shopify/Publication/5':
                return {'data': {'publishablePublish': {'userErrors': [{'field': ['id'], 'message': 'POS not available'}]}}}
            return {'data': {'publishablePublish': {'publishable': {'id': 'x'}, 'userErrors': []}}}

    def call(method, url, hdrs, json=None, timeout=15):
        pid = json['variables']['input'][0]['publicationId']
        calls.append(pid)
        return R(pid)
    monkeypatch.setattr(server, '_shopify_call', call)
    on, errors = server._publish_to_all_channels('nl', 123, {})
    assert on == ['Online Store', 'Shop', 'Google & YouTube', 'Facebook & Instagram']
    assert errors == ['Point of Sale: POS not available']
    assert len(calls) == 5 and all(c.startswith('gid://shopify/Publication/') for c in calls)


def test_publish_to_all_channels_without_publications_reports_it(monkeypatch):
    monkeypatch.setattr(server, '_list_publications', lambda store, hdrs: [])
    assert server._publish_to_all_channels('nl', 1, {}) == ([], ['no publications found in shop'])


def test_a_type_the_source_itself_names_is_not_another_type(gen):
    """aorabrand: 'Designer wall light … warm wall sconce' → 'wandlamp' in our copy is fine."""
    text = RAW.replace('als een ingebouwde wandlamp', 'en je hebt een wandlamp')
    _FakeClient.answers = [{'description': text, 'meta_description': 'a', 'm_title_specs': 'b'}]
    body = gen('nl', source_text='Aoraglow turns any outlet into a warm wall sconce. Designer wall light, no wiring. Plug it in.',
               skip_language_pass=True)
    assert len(_FakeClient.prompts) == 1 and not body.get('type_mismatch')
    # …but a type NOBODY names is still flagged
    _FakeClient.answers = [{'description': text.replace('wandlamp', 'plafondlamp'), 'meta_description': 'a', 'm_title_specs': 'b'},
                           {'description': text.replace('wandlamp', 'plafondlamp'), 'meta_description': 'a', 'm_title_specs': 'b'}]
    _FakeClient.prompts = []
    body = gen('nl', source_text='Aoraglow turns any outlet into a warm wall sconce. Plug it in.', skip_language_pass=True)
    assert body['type_mismatch'] == ['plafondlamp']


def test_editor_is_only_blamed_for_type_words_it_added(gen):
    first = RAW.replace('als een ingebouwde wandlamp', 'en je hebt een plafondlamp')   # writer's own slip
    edited = EDITED.replace('als een vaste wandlamp', 'en je hebt een plafondlamp')
    _FakeClient.answers = [{'description': first, 'meta_description': 'a', 'm_title_specs': 'b'},
                           {'description': first, 'meta_description': 'a', 'm_title_specs': 'b'},      # retry
                           {'description': edited, 'meta_description': 'a', 'm_title_specs': 'b', 'changes': ['x']}]
    body = gen('nl')
    assert body['language_pass']['applied'] is True and body['type_mismatch'] == ['plafondlamp']


def test_a_dimmer_in_the_source_proves_dimmable():
    assert 'dimbaar' in server._light_spec_claims('Slide dimmer on the side, 0-100%.')
    assert server._light_unverified_claims('Dimbaar van 0 tot 100%.', 'Slide dimmer on the side.') == []
