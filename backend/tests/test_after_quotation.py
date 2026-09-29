# -*- coding: utf-8 -*-
"""After Quotation tool (v1.321): correct fashion listings once the supplier's
quote is in — real sizes, size chart, colours, photos and facts.

Measured on DK 2026-09-29: 49 shoe listings sold XS-XL against an EU 35-42
chart. These tests pin the rules that keep the writes safe: sizes that stay
keep their variant id, a colour is drafted never deleted, the URL never
changes, a listing that moved since the preview is not written, and every
apply can be undone from its backup."""
import io
import json
import zipfile

import pytest

import server


# ── a synthetic family: Carina loafers, 2 colours × DK/FR ─────────────────────

def _variant(vid, size, colour, price='374.95'):
    return {'id': vid, 'size': size, 'sku': f'VIONNA-Carina-{colour}-{size}', 'price': price,
            'compare_at': '500.00', 'taxable': False, 'policy': 'deny', 'mgmt': None,
            'image_id': 900, 'requires_shipping': True}


def _product(pid, store, colour, sizes, created, status='active', cat='shoes', chart_html=None, opts=1):
    chart_html = chart_html if chart_html is not None else (
        '<table><tr><th>EU</th><th>Fodlængde (cm)</th></tr>'
        '<tr><td>35</td><td>22.1</td></tr><tr><td>36</td><td>22.8</td></tr></table>')
    return {
        'id': pid, 'title': 'Carina', 'handle': f'carina-{server._publish_slug(colour)}', 'status': status,
        'type': 'Shoes', 'tags': [f'cat:{cat}', 'new'], 'cat': cat, 'created': created,
        'size_opt': server.STORE_SIZE_OPTION[store], 'options_count': opts,
        'variants': [_variant(pid * 10 + i, s, colour) for i, s in enumerate(sizes)],
        'sizes': list(sizes), 'images': [{'id': 900, 'src': 'https://cdn/x.jpg', 'position': 1}],
        'body_html': '<p>Stilfulde mocassins i blødt ruskind.</p>', 'colour': colour,
        'sib': 'carina-siblings', 'chart_html': chart_html,
        'chart': server._size_chart_from_html(chart_html) if chart_html else None,
        'title_tag': f'Mocassins - Carina {colour}', 'description_tag': 'Carina mocassins',
        'specs': 'Mocassins med god komfort',
    }


def _state(**over):
    sizes = ['XS', 'S', 'M', 'L', 'XL']
    st = {'key': 'carina-siblings', 'store_errors': {}, 'stores': {
        'dk': [_product(11, 'dk', 'Sort', sizes, '2026-09-16T10:00:00Z'),
               _product(12, 'dk', 'Lyserød', sizes, '2026-09-16T10:01:00Z')],
        'fr': [_product(21, 'fr', 'Noir', sizes, '2026-09-16T10:00:30Z'),
               _product(22, 'fr', 'Rose Vif', sizes, '2026-09-16T10:01:30Z')],
    }}
    st.update(over)
    return st


# ── sizes ─────────────────────────────────────────────────────────────────────

def test_sizes_have_one_spelling_and_sort_smallest_first():
    assert [server._aq_norm_size(x) for x in ('xxl', 'XXXL', ' m ', 'EU 38', '38,5', 'Taille unique', 'Yksi koko')] \
        == ['2XL', '3XL', 'M', '38', '38.5', 'One Size', 'One Size']
    assert server._aq_sort_sizes(['XL', 's', 'M', 'xxl', 'XS']) == ['XS', 'S', 'M', 'XL', '2XL']
    assert server._aq_sort_sizes(['40', '36', '38', 'EU 36']) == ['36', '38', '40']
    assert server._aq_size_kind(['35', '36']) == 'number' and server._aq_size_kind(['S', 'M']) == 'letter'


def test_letter_sizes_against_an_eu_chart_is_not_a_contradiction_for_clothing():
    assert server._aq_sizes_vs_chart(['S', 'M'], ['36', '38']) is None       # conversion table
    assert server._aq_sizes_vs_chart(['S', 'M', 'L'], ['S', 'M']) is False
    assert server._aq_sizes_vs_chart(['35', '36'], ['35', '36']) is True


def test_accessory_sizes_become_the_stores_own_one_size():
    assert server._aq_sizes_for_store('fr', 'accessory', ['S', 'M']) == ['Taille unique']
    assert server._aq_sizes_for_store('fi', 'dress', ['One Size']) == ['Yksi koko']
    assert server._aq_sizes_for_store('dk', 'shoes', ['35', '36']) == ['35', '36']


def test_chart_sizes_read_the_first_column_or_a_transposed_header():
    assert server._aq_chart_sizes({'headers': ['EU', 'cm'], 'rows': [['35', '22'], ['36', '23']]}) == ['35', '36']
    assert server._aq_chart_sizes({'headers': ['', '35', '36', '37'],
                                   'rows': [['Fodlængde', '22', '23', '24']]}) == ['35', '36', '37']
    assert server._aq_chart_sizes({'headers': ['Mål', 'A'], 'rows': [['Bryst', '1'], ['Talje', '2']]}) == []


# ── families + colour rows ────────────────────────────────────────────────────

def test_colours_line_up_across_stores_by_concept_then_by_order():
    st = _state()
    st['stores']['fr'][1]['colour'] = 'Framboise'          # a word the concept table doesn't know
    rows = server._aq_rows(st['stores'])
    assert len(rows) == 2
    assert rows[0]['cells']['fr']['colour'] == 'Noir' and rows[0]['match']['fr'] == 'colour'
    assert rows[1]['cells']['fr']['colour'] == 'Framboise' and rows[1]['match']['fr'] == 'order'


def test_an_extra_colour_in_one_store_gets_its_own_row():
    st = _state()
    st['stores']['fr'].append(_product(23, 'fr', 'Vert Foncé', ['S'], '2026-09-16T10:02:00Z'))
    rows = server._aq_rows(st['stores'])
    assert len(rows) == 3 and rows[2]['cells'].keys() == {'fr'}


def test_flags_name_the_contradictions():
    st = _state()
    idx = {s: [{**p, 'has_chart': bool(p['chart']), 'chart_sizes': server._aq_chart_sizes(p['chart'])}
               for p in ps] for s, ps in st['stores'].items()}
    codes = {f['code'] for f in server._aq_flags(idx)}
    assert {'shoe_letter_sizes', 'default_sizes'} <= codes
    idx['fr'][0]['has_chart'] = False
    assert 'no_chart' in {f['code'] for f in server._aq_flags(idx)}


# ── plan ──────────────────────────────────────────────────────────────────────

def test_plan_swaps_sizes_on_every_colour_and_keeps_the_ids_that_stay(monkeypatch):
    st = _state()
    plan = server._aq_plan(st, {'sizes': ['36', 'EU 35']})
    assert not plan['errors']
    ops = [o for o in plan['ops'] if o['op'] == 'variants']
    assert len(ops) == 4 and all(o['after'] == ['35', '36'] for o in ops)      # sorted, one spelling
    assert ops[0]['added'] == ['35', '36'] and ops[0]['removed'] == ['XS', 'S', 'M', 'L', 'XL']
    mixed = server._aq_plan(st, {'sizes': ['36', '35', 'S'], 'stores': ['dk']})
    assert mixed['ops'][0]['after'] == ['36', '35', 'S']                       # mixed: typed order kept
    assert mixed['ops'][0]['removed'] == ['XS', 'M', 'L', 'XL']                # S keeps its variant


def test_plan_rename_rewrites_swatch_title_and_skus_but_never_the_url():
    st = _state()
    rid = server._aq_rows(st['stores'])[1]['row_id']
    plan = server._aq_plan(st, {'colours': [{'row_id': rid, 'action': 'rename',
                                             'labels': {'dk': 'Rosa', 'fr': 'Rose'}}]})
    ren = [o for o in plan['ops'] if o['op'] == 'rename']
    assert {(o['store'], o['after']) for o in ren} == {('dk', 'Rosa'), ('fr', 'Rose')}
    assert ren[0]['title_tag'].endswith('Carina Rosa')
    var = [o for o in plan['ops'] if o['op'] == 'variants']
    assert all(o['rename_skus'] for o in var) and len(var) == 2
    assert not any('handle' in o for o in ren)


def test_plan_drops_a_colour_to_draft_and_warns_when_a_shop_would_be_empty():
    st = _state()
    rows = server._aq_rows(st['stores'])
    plan = server._aq_plan(st, {'colours': [{'row_id': r['row_id'], 'action': 'drop'} for r in rows],
                                'stores': ['dk']})
    assert [o['op'] for o in plan['ops']] == ['draft', 'draft']
    assert any('every colour would be hidden' in w for w in plan['warnings'])


def test_plan_refuses_a_new_colour_without_photos_or_that_already_exists():
    st = _state()
    p1 = server._aq_plan(st, {'new_colours': [{'labels': {'dk': 'Beige', 'fr': 'Beige'}, 'images': 0}]})
    assert any('add at least one photo' in e for e in p1['errors'])
    p2 = server._aq_plan(st, {'new_colours': [{'labels': {'dk': 'Sort', 'fr': 'Noir'}, 'images': 2}]})
    assert any('already exists' in e for e in p2['errors'])
    p3 = server._aq_plan(st, {'new_colours': [{'labels': {'dk': 'Beige', 'fr': 'Beige'}, 'images': 2}]})
    add = [o for o in p3['ops'] if o['op'] == 'add_colour']
    assert not p3['errors'] and {o['handle'] for o in add} == {'carina-beige'}


def test_plan_skips_a_chart_that_only_differs_in_markup():
    st = _state()
    same = server._size_chart_from_html(st['stores']['dk'][0]['chart_html'])
    monkey_html = server._chart_table_html(same['headers'], same['rows'])
    orig = server._size_chart_html
    try:
        server._size_chart_html = lambda chart, store: monkey_html
        plan = server._aq_plan(st, {'size_chart': same, 'stores': ['dk']})
    finally:
        server._size_chart_html = orig
    assert not [o for o in plan['ops'] if o['op'] == 'chart']


def test_plan_refuses_size_edits_on_a_two_option_product():
    st = _state()
    st['stores']['dk'][0]['options_count'] = 2
    plan = server._aq_plan(st, {'sizes': ['35'], 'stores': ['dk']})
    assert any('options' in e for e in plan['errors'])


def test_plan_warns_shoes_in_letter_sizes_and_chart_mismatch():
    plan = server._aq_plan(_state(), {'sizes': ['S', 'M'],
                                      'size_chart': {'headers': ['EU', 'cm'], 'rows': [['35', '22']]}})
    assert any('clothing sizes' in w for w in plan['warnings'])


# ── writes (fake Shopify) ─────────────────────────────────────────────────────

class _R:
    def __init__(self, status, body=None):
        self.status_code, self._b, self.text = status, body or {}, json.dumps(body or {})
        self.headers = {}

    def json(self):
        return self._b


def _fake_variants_shopify(p, calls=None, options_order=None):
    """A product PUT answered the way Shopify answers it: listed ids kept,
    new variants get fresh ids, the array order is the position order."""
    def call(method, url, hdrs, json=None, timeout=None, **kw):
        if calls is not None:
            calls.append((method, url, json))
        vs = []
        for i, v in enumerate(json['product'].get('variants') or []):
            size = v.get('option1') or next(x['size'] for x in p['variants'] if x['id'] == v['id'])
            vs.append({'id': v.get('id') or 5000 + i, 'option1': size, 'position': i + 1,
                       'sku': v.get('sku') or next((x['sku'] for x in p['variants'] if x['id'] == v.get('id')), '')})
        vals = options_order if options_order is not None else [v['option1'] for v in vs]
        return _R(200, {'product': {'id': p['id'], 'variants': vs,
                                    'options': [{'name': 'Størrelse', 'values': vals}]}})
    return call


def test_variant_write_keeps_ids_copies_settings_and_verifies(monkeypatch):
    p = _state()['stores']['dk'][0]
    calls = []
    monkeypatch.setattr(server, '_shopify_call', _fake_variants_shopify(p, calls))
    monkeypatch.setattr(server, 'shopify_url', lambda s, path: f'https://x/{path}')
    monkeypatch.setattr(server, 'shopify_headers', lambda s: {})
    prod, warn = server._aq_put_variants(
        'dk', p, ['S', '35'], lambda sz, v: None if v else server._publish_make_sku('Carina', 'Sort', sz))
    out = calls[0][2]['product']['variants']
    assert out[0] == {'id': p['variants'][1]['id']}                        # S kept, untouched
    assert out[1]['option1'] == '35' and out[1]['price'] == '374.95' and out[1]['compare_at_price'] == '500.00'
    assert out[1]['sku'] == 'VIONNA-Carina-Sort-35' and out[1]['taxable'] is False and out[1]['image_id'] == 900
    assert warn is None and [v['option1'] for v in prod['variants']] == ['S', '35']


def test_size_picker_order_is_put_right_when_shopify_keeps_the_old_value_order(monkeypatch):
    p = _state()['stores']['dk'][0]
    monkeypatch.setattr(server, '_shopify_call', _fake_variants_shopify(p, options_order=['S', 'M', 'XS']))
    monkeypatch.setattr(server, 'shopify_url', lambda s, path: f'https://x/{path}')
    monkeypatch.setattr(server, 'shopify_headers', lambda s: {})
    asked = []
    monkeypatch.setattr(server, '_aq_gql', lambda s, q, v=None: asked.append(v) or {'productOptionsReorder': {'userErrors': []}})
    _prod, warn = server._aq_put_variants('dk', p, ['XS', 'S', 'M'], lambda sz, v: None)
    assert warn is None and asked[0]['opts'][0]['values'] == [{'name': 'XS'}, {'name': 'S'}, {'name': 'M'}]


def test_variant_write_raises_when_shopify_shows_other_sizes(monkeypatch):
    p = _state()['stores']['dk'][0]
    monkeypatch.setattr(server, '_shopify_call', lambda *a, **k: _R(200, {'product': {'variants': [
        {'id': 1, 'option1': 'XS', 'position': 1}]}}))
    monkeypatch.setattr(server, 'shopify_url', lambda s, path: f'https://x/{path}')
    monkeypatch.setattr(server, 'shopify_headers', lambda s: {})
    with pytest.raises(RuntimeError, match='instead of'):
        server._aq_put_variants('dk', p, ['35'], lambda sz, v: None)


def test_a_respelled_size_keeps_its_sku_in_step():
    assert server._aq_respell_sku('VIONNA-Carina-Sort-XXL', 'XXL', '2XL') == 'VIONNA-Carina-Sort-2XL'
    assert server._aq_respell_sku('LEGACY123', 'XXL', '2XL') is None


@pytest.fixture
def isolated(monkeypatch, tmp_path):
    monkeypatch.setattr(server, 'AQ_HISTORY_PATH', str(tmp_path / 'aq_history.jsonl'))
    monkeypatch.setattr(server, 'AQ_BACKUP_DIR', str(tmp_path / 'aq_backups'))
    monkeypatch.setattr(server, '_aq_invalidate', lambda stores=None: None)
    monkeypatch.setattr(server, 'shopify_url', lambda s, path: f'https://{s}/{path}')
    monkeypatch.setattr(server, 'shopify_headers', lambda s: {})
    return tmp_path


def test_apply_refuses_when_the_listing_moved_since_the_preview(monkeypatch, isolated):
    st = _state()
    monkeypatch.setattr(server, '_aq_family_state', lambda key, force_index=False: st)
    monkeypatch.setattr(server, '_shopify_call', lambda *a, **k: pytest.fail('wrote to Shopify'))
    jid = server._aq_job_new('apply', 'carina-siblings')
    server._aq_apply_run(jid, 'carina-siblings', {'sizes': ['35']}, 'stale-signature', 'me')
    j = server._AQ_JOBS[jid]
    assert j['status'] == 'error' and 'changed in Shopify since your preview' in j['errors'][0]
    assert not (isolated / 'aq_backups').exists()
    assert server._aq_history_rows('carina-siblings') == []                  # nothing written, nothing logged


def _apply_carina(monkeypatch, isolated, target, calls=None):
    st = _state()
    monkeypatch.setattr(server, '_aq_family_state', lambda key, force_index=False: st)
    calls = [] if calls is None else calls

    def call(method, url, hdrs, json=None, timeout=None, **kw):
        calls.append((method, url, json))
        assert (isolated / 'aq_backups').exists(), 'wrote before the backup existed'
        vs = [{'id': v.get('id') or 7000 + i, 'option1': v.get('option1') or 'S', 'position': i + 1,
               'sku': v.get('sku') or ''}
              for i, v in enumerate(((json or {}).get('product') or {}).get('variants') or [])]
        return _R(200, {'product': {'id': 1, 'variants': vs}})
    monkeypatch.setattr(server, '_shopify_call', call)
    monkeypatch.setattr(server, '_aq_metafields_set', lambda s, items: [])
    jid = server._aq_job_new('apply', 'carina-siblings')
    server._aq_apply_run(jid, 'carina-siblings', target, server._aq_state_sig(st), 'me@x')
    return st, jid, calls


def test_apply_backs_up_first_records_what_it_wrote_and_logs(monkeypatch, isolated):
    rid = server._aq_rows(_state()['stores'])[1]['row_id']
    st, jid, calls = _apply_carina(monkeypatch, isolated, {'sizes': ['35', '36'], 'stores': ['dk'],
                                                           'colours': [{'row_id': rid, 'action': 'drop'}]})
    j = server._AQ_JOBS[jid]
    assert j['status'] == 'done', j['errors']
    puts = [c for c in calls if c[0] == 'put']
    assert any(c[2]['product'].get('status') == 'draft' for c in puts)        # Lyserød hidden, not deleted
    assert not any(c[0] == 'delete' for c in calls)
    bk = json.loads((isolated / 'aq_backups' / (j['result']['backup_id'] + '.json')).read_text('utf-8'))
    assert set(bk['products']['dk']) == {'11', '12'} and bk['user'] == 'me@x'
    assert bk['writes']['dk']['11']['variants_after'] == [['35', 'VIONNA-Carina-Sort-35'],
                                                         ['36', 'VIONNA-Carina-Sort-36']]
    assert bk['writes']['dk']['12'] == {'status': 'draft'}
    hist = server._aq_history_rows('carina-siblings')
    assert len(hist) == 1 and hist[0]['status'] == 'done' and not hist[0]['undone']
    assert server._aq_processed()['carina-siblings']


def test_an_apply_that_dies_halfway_still_shows_up_with_undo(isolated):
    server._aq_history_append({'type': 'apply', 'key': 'k', 'backup_id': 'b1', 'status': 'started'})
    rows = server._aq_history_rows('k')
    assert rows[0]['status'] == 'interrupted' and not rows[0]['undone']
    assert server._aq_processed()['k']


def test_undo_restores_only_what_the_apply_wrote_and_skips_what_changed_since(monkeypatch, isolated):
    st = _state()
    before = st['stores']['dk'][0]
    bid = '20260929T120000Z_carina_abcdef'
    server._aq_backup_write(bid, {
        'backup_id': bid, 'key': 'carina-siblings', 'name': 'Carina', 'products': {'dk': {'11': before}},
        'writes': {'dk': {'11': {'variants_after': [['35', 'VIONNA-Carina-Sort-35']], 'cutline': 'Rosa',
                                 'title_tag': 'Mocassins - Carina Rosa', 'status': 'draft',
                                 'chart_html': '<table><tr><td>35</td></tr></table>'}}},
        'created': [{'store': 'dk', 'product_id': 99, 'label': 'Beige'}],
        'photos_added': [{'store': 'dk', 'product_id': 11, 'image_ids': [555]}]})
    server._aq_history_append({'type': 'apply', 'key': 'carina-siblings', 'backup_id': bid})
    server._aq_history_append({'type': 'apply_done', 'key': 'carina-siblings', 'backup_id': bid, 'status': 'done'})
    # now: sizes + cutline still as written; status set live by hand since; title tag edited since
    now = {'id': 11, 'status': 'active', 'body_html': before['body_html'],
           'variants': [{'id': 7000, 'option1': '35', 'sku': 'VIONNA-Carina-Sort-35', 'position': 1}],
           'images': [{'id': 900}], 'options': [{'name': 'Størrelse'}]}
    monkeypatch.setattr(server, '_aq_gql', lambda s, q, v=None: {'nodes': [{
        'legacyResourceId': '11', 'cut': {'value': 'Rosa'}, 'tt': {'value': 'Edited by hand'},
        'sc': {'value': '<table><tr><td>35</td></tr></table>'}}]})
    calls = []

    def call(method, url, hdrs, json=None, timeout=None, **kw):
        calls.append((method, url, json))
        if method == 'get':
            return _R(200, {'product': now})
        vs = [{'id': v.get('id') or 8000 + i, 'option1': v.get('option1'), 'position': i + 1,
               'sku': v.get('sku')} for i, v in enumerate(((json or {}).get('product') or {}).get('variants') or [])]
        return _R(200, {'product': {'variants': vs, 'options': [{'name': 'Størrelse',
                                                                  'values': [v['option1'] for v in vs]}]}})
    monkeypatch.setattr(server, '_shopify_call', call)
    mf_sets, deleted = [], []
    monkeypatch.setattr(server, '_aq_metafields_set', lambda s, items: mf_sets.append(items) or [])
    monkeypatch.setattr(server, '_aq_mf_delete', lambda s, pid, ns, k: deleted.append((ns, k)))
    jid = server._aq_job_new('undo', '')
    server._aq_undo_run(jid, bid, 'me')
    j = server._AQ_JOBS[jid]
    assert j['status'] == 'done', j['errors']
    assert ('delete', 'https://dk/products/11/images/555.json', None) in calls
    var_put = next(c[2] for c in calls if c[0] == 'put' and 'variants' in (c[2] or {}).get('product', {}))
    assert [v.get('option1') for v in var_put['product']['variants']] == ['XS', 'S', 'M', 'L', 'XL']
    assert not any((c[2] or {}).get('product', {}).get('status') for c in calls
                   if c[0] == 'put' and '/11.json' in c[1])                    # live-by-hand stays live
    keys = {(m['namespace'], m['key']) for m in mf_sets[0]}
    assert ('theme', 'cutline') in keys and ('custom', 'size_chart') in keys
    assert ('global', 'title_tag') not in keys                                 # edited since: left alone
    log = ' '.join(l['text'] for l in j['log'])
    assert 'left alone because it changed since: status, title tag' in log
    assert any('/99.json' in c[1] and (c[2] or {}).get('product', {}).get('status') == 'draft' for c in calls)
    assert server._aq_history_rows('carina-siblings')[-1]['undone'] is True


def test_changes_are_undone_newest_first(monkeypatch, isolated):
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', None)
    monkeypatch.setenv('DEV_LOCAL', '1')
    for bid in ('20260929T120000Z_carina_aaaaaa', '20260929T130000Z_carina_bbbbbb'):
        server._aq_backup_write(bid, {'backup_id': bid, 'key': 'k', 'products': {}})
        server._aq_history_append({'type': 'apply', 'key': 'k', 'backup_id': bid})
        server._aq_history_append({'type': 'apply_done', 'key': 'k', 'backup_id': bid, 'status': 'done'})
    with server.app.test_client() as c:
        r = c.post('/api/aq/undo', json={'backup_id': '20260929T120000Z_carina_aaaaaa'})
    assert r.status_code == 409 and 'newest first' in r.get_json()['error']


def test_backup_ids_cannot_escape_the_backup_folder():
    for bad in ('../server', '20260929T120000Z_x_abcdef/../../x', '', 'x' * 10):
        with pytest.raises(ValueError):
            server._aq_backup_path(bad)


# ── uploads + extraction ──────────────────────────────────────────────────────

def _xlsx(rows):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        z.writestr('xl/workbook.xml', '<workbook/>')
        strings = sorted({c for r in rows for c in r if not c.replace('.', '').isdigit()})
        z.writestr('xl/sharedStrings.xml', '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                   + ''.join(f'<si><t>{s}</t></si>' for s in strings) + '</sst>')
        cells = ''
        for i, r in enumerate(rows, 1):
            cs = ''
            for j, c in enumerate(r):
                ref = f'{chr(65 + j)}{i}'
                if c.replace('.', '').isdigit():
                    cs += f'<c r="{ref}"><v>{c}</v></c>'
                elif c:
                    cs += f'<c r="{ref}" t="s"><v>{strings.index(c)}</v></c>'
            cells += f'<row r="{i}">{cs}</row>'
        z.writestr('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/'
                   f'spreadsheetml/2006/main"><sheetData>{cells}</sheetData></worksheet>')
    return buf.getvalue()


def test_xlsx_quote_is_read_without_extra_packages():
    txt = server._aq_xlsx_text(_xlsx([['Size', 'Bust', 'Length'], ['S', '86', '120'], ['M', '', '122']]))
    lines = txt.splitlines()
    assert lines[1] == 'Size\tBust\tLength' and lines[2] == 'S\t86\t120' and lines[3] == 'M\t\t122'


def test_uploads_are_sniffed_from_their_bytes():
    import base64
    b = lambda raw: {'name': 'f', 'data': 'data:application/octet-stream;base64,' + base64.b64encode(raw).decode()}
    assert server._aq_decode_upload(b(b'\xff\xd8\xff\xe0' + b'0' * 20))[1] == 'image/jpeg'
    assert server._aq_decode_upload(b(b'%PDF-1.7 ...'))[1] == 'pdf'
    assert server._aq_decode_upload(b('Størrelse S M L'.encode()))[1] == 'text'
    with pytest.raises(ValueError, match='HEIC'):
        server._aq_decode_upload(b(b'\x00\x00\x00\x18ftypheic' + b'0' * 20))


def test_extraction_matches_colours_and_takes_sizes_from_the_chart(monkeypatch):
    ctx = {'name': 'Carina', 'cat': 'shoes', 'sizes': ['XS', 'S'],
           'rows': [{'row_id': 'dk-11', 'labels': {'dk': 'Sort', 'fr': 'Noir'}},
                    {'row_id': 'dk-12', 'labels': {'dk': 'Lyserød', 'fr': 'Rose Vif'}}]}
    answer = {'colours': [{'supplier_name': 'Black', 'english': 'black', 'labels': {'dk': 'Sort', 'fr': 'Noir',
                                                                                     'fi': 'Musta'},
                           'matches_row': 1},
                          {'supplier_name': 'Apricot', 'english': 'apricot', 'labels': {'dk': 'Abrikos'},
                           'matches_row': None}],
              'sizes': [], 'size_chart': {'headers': ['EU', 'Foot length (inch)'],
                                          'rows': [['35', '8.7'], ['36', '9.0']]},
              'chart_unit': 'inch', 'material': 'PU leather', 'facts': ['Heel 2 cm'], 'confidence': 'high'}
    monkeypatch.setattr(server, '_aq_claude', lambda *a, **k: 'Here: ' + json.dumps(answer))
    res, used, skipped = server._aq_extract([], 'Black + Apricot, EU 35-36', ctx)
    assert [c['row_id'] for c in res['colours']] == ['dk-11', None]
    assert res['sizes'] == ['35', '36'] and any('from the size chart' in n for n in res['notes'])
    assert res['material'] == 'PU leather'


def test_extraction_needs_something_to_read():
    with pytest.raises(ValueError):
        server._aq_extract([], '  ', {})


def test_copy_rewrite_flags_a_colour_word_it_added(monkeypatch):
    monkeypatch.setattr(server, '_aq_claude', lambda *a, **k: json.dumps(
        {'html': '<p>Stilfulde sorte mocassins i PU-læder.</p>', 'changes': ['material']}))
    out = server._aq_copy_one('dk', '<p>Stilfulde mocassins i blødt ruskind.</p>', '- Material: PU leather')
    assert out['after'].startswith('<p>Stilfulde') and any('sorte' in w for w in out['warnings'])


def test_json_is_found_in_a_chatty_answer():
    assert server._aq_json('Sure! {"a": {"b": 1}} trailing') == {'a': {'b': 1}}
    assert server._aq_json('no json') is None


# ── routes are gated ──────────────────────────────────────────────────────────

@pytest.mark.parametrize('method,path', [
    ('get', '/api/aq/search'), ('get', '/api/aq/family?key=x'), ('post', '/api/aq/extract'),
    ('post', '/api/aq/copy'), ('post', '/api/aq/plan'), ('post', '/api/aq/apply'),
    ('post', '/api/aq/undo'), ('get', '/api/aq/job?id=x'), ('get', '/api/aq/history'),
])
def test_every_route_needs_a_session_token(monkeypatch, method, path):
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', 'unit-secret', raising=False)
    monkeypatch.delenv('DEV_LOCAL', raising=False)
    with server.app.test_client() as c:
        r = getattr(c, method)(path, json={} if method == 'post' else None)
    assert r.status_code == 401


def test_apply_without_a_preview_is_refused(monkeypatch):
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', None)
    monkeypatch.setenv('DEV_LOCAL', '1')
    with server.app.test_client() as c:
        r = c.post('/api/aq/apply', json={'key': 'carina-siblings', 'target': {'sizes': ['35']}})
    assert r.status_code == 400 and 'Preview' in r.get_json()['error']



# ── review 2026-09-29: security + write-safety regressions ────────────────────

@pytest.mark.parametrize('evil', [
    '<img src=x onerror=alert(1)>', '<svg/onload="alert(1)">', '<script src=//x.js>',
    '<scr<script></script>ipt>alert(1)</script>', '<a href="javascript:alert(1)">x</a>',
    '<meta http-equiv=refresh content=0;url=//x>', '<iframe src=//x>', '<p style="x" onclick="y">ok</p>',
])
def test_description_html_keeps_no_executable_part(evil):
    out = server._aq_clean_html('<p>Tekst</p>' + evil)
    low = out.lower()
    for bad in ('<script', 'onerror', 'onload', 'onclick', 'javascript:', '<iframe', '<svg', '<meta', 'style='):
        assert bad not in low, (evil, out)
    assert out.startswith('<p>Tekst</p>')


def test_description_html_keeps_normal_copy():
    h = '<p>Blød <strong>viskose</strong> &amp; hør.</p><ul><li>Længde 118 cm</li></ul><a href="https://v.dk/x">link</a>'
    assert server._aq_clean_html(h) == h


def test_a_spreadsheet_with_a_giant_cell_ref_is_capped():
    import zipfile as zf
    buf = io.BytesIO()
    with zf.ZipFile(buf, 'w') as z:
        z.writestr('xl/workbook.xml', '<workbook/>')
        z.writestr('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/'
                   '2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>S</t></is></c>'
                   '<c r="ZZZZZZZZ1"><v>9</v></c></row></sheetData></worksheet>')
    assert server._aq_xlsx_text(buf.getvalue()).splitlines()[1] == 'S'


def test_a_docx_is_not_read_as_a_spreadsheet():
    import zipfile as zf
    buf = io.BytesIO()
    with zf.ZipFile(buf, 'w') as z:
        z.writestr('word/document.xml', '<w/>')
    with pytest.raises(ValueError, match='not an Excel workbook'):
        server._aq_xlsx_text(buf.getvalue())


def test_colour_names_cannot_break_out_of_the_theme():
    assert server._aq_label_ok('Mørkegrøn') and server._aq_label_ok("Rose d'été") and server._aq_label_ok('Sort/Hvid')
    for bad in ('x" onfocus=alert(1) autofocus "', '<b>', 'a=b', '', 'x' * 41):
        assert not server._aq_label_ok(bad)


def test_a_colour_group_mixing_two_garments_is_refused():
    st = _state()
    st['stores']['fr'][0]['cat'] = 'outerwear'
    plan = server._aq_plan(st, {'sizes': ['35']})
    assert any('mixes different products' in e for e in plan['errors'])


def test_an_empty_store_choice_is_an_error_not_all_stores():
    assert 'Choose at least one store' in server._aq_plan(_state(), {'stores': [], 'sizes': ['35']})['errors']


def test_requests_without_a_length_or_too_big_are_refused(monkeypatch):
    import types
    with server.app.app_context():
        monkeypatch.setattr(server, 'request', types.SimpleNamespace(content_length=40_000_000))
        assert server._aq_body_error('extract')[1] == 413
        monkeypatch.setattr(server, 'request', types.SimpleNamespace(content_length=None))
        assert server._aq_body_error('extract')[1] == 411            # chunked: nothing bounds it
        monkeypatch.setattr(server, 'request', types.SimpleNamespace(content_length=5_000))
        assert server._aq_body_error('extract') is None


def test_a_forced_index_rebuild_within_a_minute_is_served_from_memory(monkeypatch):
    monkeypatch.setitem(server._AQ_INDEX, 'dk', {'ts': server.time.time() - 5, 'products': ['cached']})
    monkeypatch.setattr(server, '_aq_gql', lambda *a, **k: pytest.fail('rebuilt again'))
    assert server._aq_index('dk', force=True) == ['cached']
