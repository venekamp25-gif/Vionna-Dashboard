# -*- coding: utf-8 -*-
"""Home Decor publish (v1.317): variant option words per market, no tax on new
variants, the sales-channel permission made explicit + self-heal, and
m_title_specs in the store's own field type.

venek, 2026-09-28: "Home decor portal vertaalt bij import niet naar NL of DE bij
de varianten. Ook stonden de producten nog op btw rekenen en werden niet alle
verkoopkanalen standaard opengezet." — the PLUGIFY Aora went to NL/DE as
Color / Black, White with "charge tax" on; the channel step said "no
publications found in shop" because all three lighting apps lack
read_publications / write_publications.
"""
import json

import pytest

import server


# ── option words ────────────────────────────────────────────────────────────
def test_colour_option_gets_each_markets_own_words():
    r = server._light_option_i18n('Color', ['Black', 'White'], use_llm=False)
    assert r['nl'] == {'name': 'Kleur', 'values': {'Black': 'Zwart', 'White': 'Wit'}}
    assert r['de'] == {'name': 'Farbe', 'values': {'Black': 'Schwarz', 'White': 'Weiß'}}
    assert r['com'] == {'name': 'Color', 'values': {'Black': 'Black', 'White': 'White'}}
    assert r['untranslated'] == []


def test_any_source_language_and_modifiers():
    r = server._light_option_i18n('Kleur', ['Zwart', 'Warm wit', 'Weiß', 'Dark Green', 'Lichtblauw', 'Rose Gold'],
                                  use_llm=False)
    assert list(r['de']['values'].values()) == ['Schwarz', 'Warmweiß', 'Weiß', 'Dunkelgrün', 'Hellblau', 'Roségold']
    assert list(r['com']['values'].values()) == ['Black', 'Warm White', 'White', 'Dark Green', 'Light Blue', 'Rose Gold']
    assert list(r['nl']['values'].values()) == ['Zwart', 'Warm wit', 'Wit', 'Donkergroen', 'Lichtblauw', 'Rosé goud']
    r = server._light_option_i18n('Finish', ['Matte Black'], use_llm=False)
    assert (r['nl']['name'], r['nl']['values']['Matte Black'], r['de']['values']['Matte Black']) == \
        ('Kleur', 'Mat zwart', 'Mattschwarz')


def test_quantities_sizes_and_codes():
    r = server._light_option_i18n('Pack', ['2 Pack', '4 Pack'], use_llm=False)
    assert r['nl']['name'] == 'Aantal' and r['nl']['values']['2 Pack'] == '2 stuks'
    assert r['de']['values']['4 Pack'] == '4 Stück'
    r = server._light_option_i18n('Size', ['ø30cm', 'ø50cm'], use_llm=False)
    assert r['de']['name'] == 'Größe' and r['de']['values'] == {'ø30cm': 'ø30cm', 'ø50cm': 'ø50cm'}
    r = server._light_option_i18n('Plug type', ['US', 'UK'], use_llm=False)
    assert (r['nl']['name'], r['de']['name']) == ('Stekkertype', 'Steckertyp') and r['nl']['values']['US'] == 'US'
    # 'Light color' is not a plain colour
    assert server._light_option_i18n('Light color', ['Warm White'], use_llm=False)['nl']['name'] == 'Lichtkleur'


def test_unknown_words_are_kept_and_listed_never_an_error():
    r = server._light_option_i18n('Shade', ['Opal', 'Frosted'], use_llm=False)
    assert r['nl']['name'] == 'Shade' and r['nl']['values'] == {'Opal': 'Opal', 'Frosted': 'Frosted'}
    assert r['untranslated'] == ['Opal', 'Frosted']


def test_a_collision_keeps_the_source_words_for_that_market():
    r = server._light_option_i18n('Color', ['Black', 'Zwart'], use_llm=False)
    assert r['nl']['values'] == {'Black': 'Black', 'Zwart': 'Zwart'} and r['notes']


class _FakeClient:
    answers = []
    prompts = []

    def __init__(self, api_key=None):
        self.messages = self

    def create(self, **kw):
        _FakeClient.prompts.append(kw['messages'][0]['content'])
        return type('M', (), {'content': [type('T', (), {'text': json.dumps(_FakeClient.answers.pop(0))})()]})()


def test_the_model_fills_what_the_tables_do_not_know(monkeypatch):
    import anthropic
    monkeypatch.setattr(anthropic, 'Anthropic', _FakeClient)
    monkeypatch.setattr(server, 'ANTHROPIC_KEY', 'k')
    _FakeClient.answers = [{'name': {'nl': 'Kap', 'de': 'Schirm', 'com': 'Shade'},
                            'values': {'Frosted': {'nl': 'Mat glas', 'de': 'Satiniert', 'com': 'Frosted'}}}]
    _FakeClient.prompts = []
    r = server._light_option_i18n('Shade', ['White', 'Frosted'])
    assert r['nl'] == {'name': 'Kap', 'values': {'White': 'Wit', 'Frosted': 'Mat glas'}}
    assert r['llm'] is True and r['untranslated'] == []
    assert '"Frosted"' in _FakeClient.prompts[0] and '"White"' not in _FakeClient.prompts[0]   # only the unknowns


def test_option_i18n_endpoint(monkeypatch):
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', None)
    monkeypatch.setenv('DEV_LOCAL', '1')
    monkeypatch.setattr(server, 'ANTHROPIC_KEY', '')
    body = server.app.test_client().post('/api/lighting/option_i18n',
                                         json={'option_name': 'Color', 'values': ['Black', 'White']}).get_json()
    assert body['de']['values'] == {'Black': 'Schwarz', 'White': 'Weiß'}


# ── publish ────────────────────────────────────────────────────────────────
class _R:
    def __init__(self, status, body=None, text=''):
        self.status_code = status
        self._body = body or {}
        self.text = text or json.dumps(self._body)

    def json(self):
        return self._body


@pytest.fixture()
def pub(monkeypatch):
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', None)
    monkeypatch.setenv('DEV_LOCAL', '1')
    monkeypatch.setattr(server, 'ANTHROPIC_KEY', '')
    monkeypatch.setattr(server, 'LIGHT_TOKENS', {'nl': {'shop': 'nl-x.myshopify.com', 'token': 't1'},
                                                 'de': {'shop': 'de-x.myshopify.com', 'token': 't2'}})
    monkeypatch.setattr(server, '_find_product_by_handle', lambda store, handle, hdrs: None)
    monkeypatch.setattr(server, '_publish_to_all_channels', lambda store, pid, hdrs: (['Online Store'], []))
    monkeypatch.setattr(server, '_append_history', lambda entry, portal=None: calls['history'].append(entry))
    calls = {'products': {}, 'metafields': [], 'puts': [], 'history': []}

    def post(url, headers=None, json=None, timeout=None):
        if url.endswith('/products.json'):
            p = json['product']
            store = 'nl' if 'nl-x' in url else 'de'
            calls['products'][store] = p
            vs = [{'id': 100 + i, 'option1': v.get('option1')} for i, v in enumerate(p['variants'])]
            return _R(201, {'product': {'id': 900, 'variants': vs}})
        if '/metafields.json' in url:
            calls['metafields'].append((url, json['metafield']))
            ok = json['metafield']['type'] == ('rich_text_field' if 'nl-x' in url else 'single_line_text_field')
            return _R(201 if ok else 422, {'errors': 'type'})
        return _R(201, {})

    def put(url, headers=None, json=None, timeout=None):
        calls['puts'].append((url, json))
        return _R(200, {})
    monkeypatch.setattr(server.req, 'post', post)
    monkeypatch.setattr(server.req, 'put', put)

    def run(**extra):
        body = {'stores': ['nl', 'de'], 'product_name': 'PLUGIFY Aora', 'product_type': 'Stekkerlamp',
                'option_name': 'Color', 'option_values': ['Black', 'White'], 'price': '39',
                'images': [], 'images_by_value': {},
                'content': {'nl': {'description': 'x', 'meta_description': '', 'm_title_specs': 'Stekkerlamp met sensor'},
                            'de': {'description': 'y', 'meta_description': '', 'm_title_specs': 'Steckdosenlampe mit Sensor'}}}
        body.update(extra)
        with server.app.test_client() as c:
            return c.post('/api/lighting/publish', json=body).get_json()
    run.calls = calls
    return run


def test_publish_sends_each_market_its_own_words_and_no_tax(pub):
    out = pub()
    assert out['success']
    nl, de = pub.calls['products']['nl'], pub.calls['products']['de']
    assert nl['options'] == [{'name': 'Kleur', 'values': ['Zwart', 'Wit']}]
    assert de['options'] == [{'name': 'Farbe', 'values': ['Schwarz', 'Weiß']}]
    assert [v['option1'] for v in de['variants']] == ['Schwarz', 'Weiß']
    assert all(v['taxable'] is False for v in nl['variants'] + de['variants'])
    assert [v['sku'] for v in de['variants']] == ['TLS-PLUGIFYAora-Black', 'TLS-PLUGIFYAora-White']   # same SKU per item
    h = {e['store']: e for e in pub.calls['history']}
    assert h['de']['option_name'] == 'Farbe' and h['de']['option_source'] == {'name': 'Color', 'values': ['Black', 'White']}


def test_the_operators_edited_words_win(pub):
    pub(option_i18n={'nl': {'name': 'Kleur', 'values': {'Black': 'Mat zwart', 'White': 'Gebroken wit'}}})
    assert pub.calls['products']['nl']['options'][0]['values'] == ['Mat zwart', 'Gebroken wit']
    assert pub.calls['products']['de']['options'][0]['values'] == ['Schwarz', 'Weiß']   # server fills the rest


def test_photos_follow_the_source_value(pub, monkeypatch):
    monkeypatch.setattr(server, '_build_image_payload', lambda urls, max_images=1, report=None: [{'attachment': 'x'}])
    ids = iter([501, 502])
    monkeypatch.setattr(server, '_attach_images_one_by_one',
                        lambda store, pid, payload, hdrs, report=None: [{'id': next(ids)}])
    pub(stores=['de'], images=['https://cdn/a.jpg', 'https://cdn/b.jpg'],
        images_by_value={'Black': ['https://cdn/a.jpg'], 'White': ['https://cdn/b.jpg']})
    linked = {j['variant']['id']: j['variant']['image_id'] for u, j in pub.calls['puts'] if '/variants/' in u}
    assert linked == {100: 501, 101: 502}


def test_m_title_specs_lands_in_each_stores_own_field_type(pub):
    out = pub()
    for st in ('nl', 'de'):
        assert not any('m_title_specs' in e for e in out['results'][st]['metafield_errors'])
    de_writes = [mf for u, mf in pub.calls['metafields'] if 'de-x' in u and mf['key'] == 'm_title_specs']
    assert de_writes[-1]['type'] == 'single_line_text_field' and de_writes[-1]['value'] == 'Steckdosenlampe mit Sensor'


# ── sales channels ─────────────────────────────────────────────────────────
def test_a_missing_permission_is_named_and_never_cached(monkeypatch):
    monkeypatch.setattr(server, '_PUBLICATION_CACHE', {})
    monkeypatch.setattr(server, '_PUBLICATION_CACHE_AT', {})
    monkeypatch.setattr(server, '_PUBLICATION_ERR', {})
    monkeypatch.setattr(server, 'LIGHT_TOKENS', {'nl': {'shop': 'nl-x.myshopify.com', 'token': 't'}})
    hits = []

    def get(url, headers=None, timeout=None):
        hits.append(url)
        return _R(403, text='{"errors":"[API] This action requires merchant approval for read_publications scope."}')
    monkeypatch.setattr(server.req, 'get', get)
    on, errors = server._publish_to_all_channels('nl', 1, {})
    assert on == [] and 'read_publications' in errors[0] and 'write_publications' in errors[0]
    server._list_publications('nl', {})
    assert len(hits) == 2                                   # a failure is asked again, not cached


def test_a_successful_list_is_cached_for_an_hour(monkeypatch):
    monkeypatch.setattr(server, '_PUBLICATION_CACHE', {})
    monkeypatch.setattr(server, '_PUBLICATION_CACHE_AT', {})
    monkeypatch.setattr(server, '_PUBLICATION_ERR', {'nl': 'old reason'})
    monkeypatch.setattr(server, 'LIGHT_TOKENS', {'nl': {'shop': 'nl-x.myshopify.com', 'token': 't'}})
    hits = []
    monkeypatch.setattr(server.req, 'get', lambda url, headers=None, timeout=None:
                        (hits.append(url), _R(200, {'publications': [{'id': 1, 'name': 'Online Store'}]}))[1])
    assert server._list_publications('nl', {}) == [{'id': 1, 'name': 'Online Store'}]
    assert server._list_publications('nl', {}) == [{'id': 1, 'name': 'Online Store'}]
    assert len(hits) == 1 and 'nl' not in server._PUBLICATION_ERR


def test_channel_check_reports_the_missing_scopes(monkeypatch):
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', None)
    monkeypatch.setenv('DEV_LOCAL', '1')
    monkeypatch.setattr(server, '_LIGHT_SCOPE_CACHE', {})
    monkeypatch.setattr(server, 'LIGHT_TOKENS', {'nl': {'shop': 'nl-x.myshopify.com', 'token': 't'},
                                                 'com': {'shop': 'com-x.myshopify.com', 'token': 't'}})

    def get(url, headers=None, timeout=None):
        if 'nl-x' in url:
            return _R(200, {'access_scopes': [{'handle': 'write_products'}]})
        return _R(200, {'access_scopes': [{'handle': 'read_publications'}, {'handle': 'write_publications'}]})
    monkeypatch.setattr(server.req, 'get', get)
    body = server.app.test_client().get('/api/lighting/channel_check').get_json()
    assert body['stores']['nl'] == {'ok': False, 'missing': ['read_publications', 'write_publications'],
                                    'detail': 'missing permission: read_publications, write_publications'}
    assert body['stores']['com']['ok'] is True


def test_channel_check_that_cannot_ask_is_unknown_not_false(monkeypatch):
    monkeypatch.setattr(server, '_LIGHT_SCOPE_CACHE', {})
    monkeypatch.setattr(server, 'LIGHT_TOKENS', {'nl': {'shop': 'nl-x.myshopify.com', 'token': 't'}})
    monkeypatch.setattr(server.req, 'get', lambda *a, **k: _R(502))
    assert server._light_channel_scope('nl')['ok'] is None


def test_heal_opens_every_channel_once_per_product(monkeypatch, tmp_path):
    hist = tmp_path / 'lighting_history.jsonl'
    hist.write_text('\n'.join(json.dumps(e) for e in [
        {'store': 'nl', 'product_id': 1}, {'store': 'nl', 'product_id': 2}, {'store': 'nl', 'product_id': 1},
        {'store': 'de', 'product_id': 7}]), encoding='utf-8')
    monkeypatch.setattr(server, 'LIGHTING_HISTORY_PATH', str(hist))
    monkeypatch.setattr(server, 'LIGHT_CHANNELS_STATE_PATH', str(tmp_path / 'state.json'))
    monkeypatch.setattr(server, 'LIGHT_TOKENS', {'nl': {'shop': 'nl-x.myshopify.com', 'token': 't'},
                                                 'de': {'shop': 'de-x.myshopify.com', 'token': 't'}})
    monkeypatch.setattr(server, '_PUBLICATION_ERR', {'de': 'this store\'s app has no permission …'})
    pubs = [{'id': 11, 'name': 'Online Store'}, {'id': 12, 'name': 'Google & YouTube'}]
    monkeypatch.setattr(server, '_list_publications', lambda store, hdrs: pubs if store == 'nl' else [])
    calls = []

    def publish(store, pid, hdrs, todo):
        calls.append((pid, [p['id'] for p in todo]))
        if pid == 2:
            return [], ['Online Store: Product does not exist']
        return list(todo), []
    monkeypatch.setattr(server, '_publish_to_publications', publish)
    rep = server._light_channels_heal_once()
    assert rep['nl'] == {'products': 2, 'opened': 2, 'gone': 1, 'errors': []}
    assert rep['de']['skipped'].startswith("this store's app has no permission")
    assert calls == [(1, [11, 12]), (2, [11, 12])]
    calls.clear()
    rep = server._light_channels_heal_once()
    assert calls == [] and rep['nl']['opened'] == 0            # done once, never forced again
    pubs.append({'id': 13, 'name': 'TikTok'})                  # a new channel appears
    server._light_channels_heal_once()
    assert calls == [(1, [13])]
