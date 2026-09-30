# -*- coding: utf-8 -*-
"""Competitor sizes at listing (v1.323) — server twin of frontend/lib/competitorSizes.ts.

Measured 30 Sep 2026 on 9,406 products of 42 competitor stores: only 13% of
their letter lists are exactly XS–XL, shoes come in EU 35–43, some UK/AU shops
use dress sizes 6–18 (venek: convert to letters). CASES is the SAME table as
frontend/tests/competitorSizes.test.ts — the size backfill runs here and must
read sizes exactly like the listing screen (checked offline on all 28,218
sample cases: 0 differences)."""
import pytest

import server

CASES = [
    # (option name, category, competitor values, expected sizes, expected source, competitor host)
    ('Pointure', 'shoes', ['35', '36', '37', '38', '39', '40', '41', '42', '43'], ['35', '36', '37', '38', '39', '40', '41', '42', '43'], 'competitor', ''),
    ('Maat', 'garment', ['S (36)', 'M (38)', 'L (40/42)', 'XL (44)', '2XL (46)', '3XL (48)'], ['S', 'M', 'L', 'XL', '2XL', '3XL'], 'competitor', ''),
    ('Size', 'garment', ['6', '8', '10', '12', '14', '16', '18'], ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'], 'converted-uk', 'goddiva.co.uk'),
    ('Size', 'garment', ['16', '18', '20', '22', '24', '26'], ['2XL', '3XL', '4XL', '5XL', '6XL', '7XL'], 'converted-uk', 'goddiva.co.uk'),
    ('Size', 'garment', ['4', '6', '8', '10', '12', '14', '16', '18'], ['XS', 'S', 'M', 'L', 'XL'], 'default', 'tp-kjoler.dk'),
    ('Size', 'shoes', ['5', '6', '7', '8', '9', '10'], ['38', '39', '40', '41', '42', '43'], 'converted-uk', 'www.meshki.co.uk'),
    ('Size', 'shoes', ['5', '6', '7', '8', '9', '10'], ['36', '37', '38', '39', '40', '41'], 'converted-uk', 'billyj.com.au'),
    ('Size', 'shoes', ['5', '6', '7', '8'], ['36', '37', '38', '39', '40', '41'], 'shoe-default', 'zentaro.nl'),
    ('Size', 'shoes', ['3', '3.5', '4', '4.5', '5'], ['36', '37', '38', '39', '40', '41'], 'shoe-default', 'www.meshki.co.uk'),
    ('SIZE', 'garment', ['4', '6', '7', '8', '9', '10', '11'], ['XS', 'S', 'M', 'L', 'XL'], 'default', ''),
    ('Koko', 'garment', ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'], ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'], 'competitor', ''),
    ('Koko', 'garment', ['32', '34', '36', '38', '40', '42', '44', 'Lady S (46)', 'Lady M (48)', 'Lady L (50)', 'Lady XL (52)', 'Lady XXL (54)'],
     ['32', '34', '36', '38', '40', '42', '44', '46', '48', '50', '52', '54'], 'competitor', 'briima.fi'),
    ('Size', 'garment', ['S(US 6-8)', 'M(US 10-12)', 'L(US 14-16)', 'XL(US 18)', '2XL(US 20)', '5XL(US 22)'], ['S', 'M', 'L', 'XL', '2XL', '5XL'], 'competitor', 'zentaro.nl'),
    ('Maat', 'garment', ['XS 32/34', 'S 36/38', 'M 38/40', 'L 40/42', 'XL 42/44', 'XXL 42/44', '3XL 44/46'], ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'], 'competitor', 'zentaro.nl'),
    ('Size', 'garment', ['0XL', '1XL', '2XL', '3XL'], ['0XL', '1XL', '2XL', '3XL'], 'competitor', ''),
    ('Size', 'garment', ['XXXS', 'XXS', 'XS', 'S'], ['3XS', 'XXS', 'XS', 'S'], 'competitor', ''),
    ('Størrelse', 'garment', ['Lille', 'Medium', 'Stor'], ['S', 'M', 'L'], 'competitor', ''),
    ('Size', 'garment', ['36-38', '39-41'], ['36-38', '39-41'], 'competitor', 'famme.fi'),
    ('Pointure', 'shoes', ['S', 'M', 'L'], ['S', 'M', 'L'], 'competitor', ''),
    ('Size', 'garment', ['One Size', 'One Size Plus'], ['One Size'], 'competitor', ''),
    ('Taille', 'garment', ['Taille unique'], ['One Size'], 'competitor', ''),
    ('Taille', 'garment', ['S', 'M (presque épuisé)', 'L Quasi épuisé'], ['S', 'M', 'L'], 'competitor', ''),
    ('Größe', 'shoes', ['UK 2 | EU 35', '35.5', '36', 'UK 6 | EU 39', '39.5'], ['35', '35.5', '36', '39', '39.5'], 'competitor', ''),
    ('Taille', 'garment', ['M', 'S', 'XL', "L'", 'XXL'], ['S', 'M', 'L', 'XL', '2XL'], 'competitor', ''),
    ('Size', 'garment', ['S/M', 'L/XL', 'XS', '2XL/3XL'], ['XS', 'S/M', 'L/XL', '2XL/3XL'], 'competitor', ''),
    ('Taille', 'garment', ['36.0', '38.0', '40.0'], ['36', '38', '40'], 'competitor', ''),
    ('Size', 'accessory', ['XS', 'S', 'M'], ['One Size'], 'one-size', ''),
    ('Color', 'garment', ['Black', 'White'], ['XS', 'S', 'M', 'L', 'XL'], 'default', ''),
    ('Color', 'shoes', ['Black'], ['36', '37', '38', '39', '40', '41'], 'shoe-default', ''),
    ('Forstørrelse', 'garment', ['+1.00', '+2.50'], ['XS', 'S', 'M', 'L', 'XL'], 'default', ''),
    ('Größe', 'garment', ['Einheitsgröße'], ['One Size'], 'competitor', ''),
    ('Taille', 'garment', ['XS', 'S', 'M', 'L', 'XL'], ['XS', 'S', 'M', 'L', 'XL'], 'competitor', ''),
]


@pytest.mark.parametrize('name,cat,values,sizes,source,host', CASES)
def test_real_competitor_size_lists_become_the_listing_sizes(name, cat, values, sizes, source, host):
    r = server._competitor_sizes([{'name': 'Couleur', 'values': ['Noir', 'Blanc']}, {'name': name, 'values': values}],
                                 cat, host)
    assert r['sizes'] == sizes and r['source'] == source


def test_notes_say_what_was_dropped_converted_or_not_converted():
    f = server._competitor_sizes
    assert 'One Size Plus' in f([{'name': 'Size', 'values': ['One Size', 'One Size Plus']}], 'garment')['note']
    assert 'UK or US' in f([{'name': 'Size', 'values': ['6', '8', '10']}], 'garment', 'shop.dk')['note']
    assert 'AU shoe' in f([{'name': 'Size', 'values': ['5', '6']}], 'shoes', 'billyj.com.au')['note']
    assert 'listed as shoes' in f([{'name': 'Pointure', 'values': ['S', 'M']}], 'shoes')['note']
    # a garment the title took for an accessory: One Size, but the competitor's sizes are named
    acc = f([{'name': 'Taille', 'values': ['S', 'M', 'L']}], 'accessory')
    assert acc['sizes'] == ['One Size'] and 'S M L' in acc['note']
    assert f([{'name': 'Taille', 'values': ['One Size']}], 'accessory')['note'] is None


def test_publish_normalises_what_the_screen_sends_and_falls_back_only_when_empty():
    assert server._listing_sizes(None) == (['XS', 'S', 'M', 'L', 'XL'], True)
    assert server._listing_sizes([]) == (['XS', 'S', 'M', 'L', 'XL'], True)
    assert server._listing_sizes(['xxl', 'S', 'S (36)', '2XL']) == (['2XL', 'S'], False)
    long = 'Petite Taille (80-120 Livres)'
    assert server._listing_sizes([long])[0] == [long]          # never cut at 20 characters


def test_the_size_option_is_recognised_in_every_language_seen():
    for name in ('Koko', 'Größe', 'Pointure', 'Taglia', 'Storlek', 'Grootte', 'Størrelse', 'Taille'):
        assert server._SIZE_OPT_RE.search(name), name
    assert not server._SIZE_OPT_RE.search('Couleur')


def test_aq_normaliser_speaks_the_same_vocabulary():
    assert server._aq_norm_size('36.0') == '36' and server._aq_norm_size('37½') == '37.5'
    assert server._aq_norm_size('OSFA') == 'One Size' and server._aq_norm_size('2XS') == 'XXS'
    # distinct sizes are never merged: 1XL is not XL, XXXS is not XXS
    assert server._aq_norm_size('1XL') == '1XL' and server._aq_norm_size('XXXS') == '3XS'
    assert server._aq_sort_sizes(['L/XL', 'XS', 'S/M']) == ['XS', 'S/M', 'L/XL']


def _publish(monkeypatch, sizes, cat, store='fr', sizes_source='competitor'):
    captured, history = {}, []
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', None)
    monkeypatch.setenv('DEV_LOCAL', '1')
    monkeypatch.setattr(server, 'tokens', {store: {'shop': f'{store}.myshopify.com', 'token': 't'}})
    monkeypatch.setattr(server, '_category_for_publish', lambda data, name, image_url=None: cat)
    monkeypatch.setattr(server, '_publish_tags_for', lambda data, name, c, images=None: ([f'cat:{c}'], None))
    monkeypatch.setattr(server, '_std_chart_for', lambda s, c: ('', None))
    monkeypatch.setattr(server, '_size_chart_html', lambda chart, s: '')

    def one(**kw):
        captured.update(kw)
        return {'product_id': 1, 'product_url': 'x', 'metafield_errors': [], 'image_errors': [], 'images_attached': 0}
    monkeypatch.setattr(server, '_publish_one_variant', one)
    monkeypatch.setattr(server, '_append_history', lambda entry, portal=None: history.append(entry))
    with server.app.test_client() as c:
        c.post('/api/publish/create_variant', json={'store': store, 'product_name': 'Carina', 'color': 'Noir',
                                                     'sizes': sizes, 'sizes_source': sizes_source, 'price': '49'})
    return captured, history


def test_publish_writes_one_size_in_the_stores_own_words(monkeypatch):
    captured, history = _publish(monkeypatch, ['One Size'], 'accessory', store='fr', sizes_source='one-size')
    assert captured['sizes'] == ['Taille unique']
    assert history[-1]['sizes_source'] == 'one-size' and history[-1]['sizes_in'] == ['One Size']


def test_publish_keeps_competitor_shoe_sizes(monkeypatch):
    captured, history = _publish(monkeypatch, ['35', '36', '37'], 'shoes', store='dk')
    assert captured['sizes'] == ['35', '36', '37'] and history[-1]['sizes_source'] == 'competitor'


def test_a_client_that_sends_no_sizes_is_logged_as_default(monkeypatch):
    # an old draft without a sizes field: the XS–XL fallback, logged as such
    # whatever source the client claims
    captured, history = _publish(monkeypatch, None, 'dress', store='dk', sizes_source='manual')
    assert captured['sizes'] == ['XS', 'S', 'M', 'L', 'XL'] and history[-1]['sizes_source'] == 'default'


def test_an_explicitly_empty_size_list_is_refused(monkeypatch):
    # the operator removed every chip: never quietly XS–XL (shoes included)
    captured, history = _publish(monkeypatch, [], 'shoes', store='dk', sizes_source='manual')
    assert captured == {} and history == []


# ── size backfill (check → apply) ─────────────────────────────────────────────

XS_XL = ['XS', 'S', 'M', 'L', 'XL']
TRACKING = '2026-08-02T00:00:00Z'


def _summary(key, name, sizes, cat='dress', active=1, processed=None, orders=None, ids=(1,)):
    return {'s': {'key': key, 'name': name, 'cat': cat, 'image': '', 'sizes': list(sizes), 'active': active,
                  'processed': processed, 'orders': orders, 'stores': {'dk': 1}},
            'ids': frozenset(ids)}


def _members(sizes_by_store, created='2026-09-10T00:00:00Z'):
    """-> an _aq_size_members() entry: {'sizes': {store: {pid: sizes}}, 'members': [(store, product)]}"""
    m = {'sizes': {}, 'members': []}
    for s, prods in sizes_by_store.items():
        for pid, sizes in prods.items():
            m['sizes'].setdefault(s, {})[str(pid)] = list(sizes)
            m['members'].append((s, {'id': pid, 'created': created}))
    return m


def _check(monkeypatch, items, fam, sources, pages, meta=None):
    monkeypatch.setattr(server, '_aq_summaries', lambda force=False: (items, {}))
    monkeypatch.setattr(server, '_aq_size_members', lambda: fam)
    monkeypatch.setattr(server, '_aq_orders_ensure', lambda wait=False, full=False: None)
    monkeypatch.setattr(server, '_aq_orders_agg', lambda: ({}, meta if meta is not None else
                                                            {'dk': {'tracking_since': TRACKING, 'error': None}}))
    monkeypatch.setattr(server, '_aq_source_urls', lambda: sources)
    monkeypatch.setattr(server, '_aq_competitor_options',
                        lambda url: (pages[server._aq_competitor_json_url(url)], 'ok'))
    monkeypatch.setattr(server.time, 'sleep', lambda s: None)
    jid = server._aq_job_new('size_check', '')
    server._aq_size_check_run(jid, 'me')
    rep = __import__('json').load(open(server.AQ_SIZE_REPORT_PATH, encoding='utf-8'))
    return {r['name']: r for r in rep['rows']}, server._AQ_JOBS[jid]


def test_the_check_proposes_competitor_sizes_only_for_default_listings(monkeypatch):
    items = [_summary('a', 'Runa', XS_XL, ids=(1,)),
             _summary('b', 'Sabine', XS_XL, cat='shoes', ids=(2,), orders={'count': 3}),
             _summary('c', 'Frida', ['S', 'M', 'L'], ids=(3,)),                      # already real sizes
             _summary('d', 'Done', XS_XL, processed='2026-09-01', ids=(4,)),
             _summary('e', 'Nosrc', XS_XL, ids=(5,))]
    fam = {'a': _members({'dk': {1: XS_XL}}), 'b': _members({'dk': {2: XS_XL}}),
           'c': _members({'dk': {3: ['S', 'M', 'L']}}), 'e': _members({'dk': {5: XS_XL}})}
    rows, job = _check(monkeypatch, items, fam,
                       {('dk', 1): 'https://shop.fr/products/runa?x=1', ('dk', 2): 'https://shop.fr/collections/c/products/sabine'},
                       {'https://shop.fr/products/runa.json': [{'name': 'Taille', 'values': ['S', 'M', 'L', 'XL', 'XXL']}],
                        'https://shop.fr/products/sabine.json': [{'name': 'Pointure', 'values': ['36', '37', '38']}]})
    assert set(rows) == {'Runa', 'Sabine', 'Nosrc'}                            # Frida real, Done processed
    assert rows['Runa']['proposed'] == ['S', 'M', 'L', 'XL', '2XL'] and rows['Runa']['status'] == 'change'
    assert rows['Runa']['snapshot'] == {'dk': {'1': XS_XL}} and rows['Runa']['orders_known'] is True
    assert rows['Sabine']['proposed'] == ['36', '37', '38'] and rows['Sabine']['orders'] == 3
    assert rows['Nosrc']['status'] == 'no_source'
    assert job['log'] == [] and job['done'] == 3             # progress, not a ✓ line per row


def test_the_check_never_calls_unreadable_sizes_already_right(monkeypatch):
    # meshki jeans 22–30: can't be read → XS–XL fallback == current, which used
    # to be reported as "Already right"; shoes without sizes got made-up EU sizes
    items = [_summary('a', 'Jeans', XS_XL, ids=(1,)), _summary('b', 'Boot', XS_XL, cat='shoes', ids=(2,))]
    fam = {'a': _members({'dk': {1: XS_XL}}), 'b': _members({'dk': {2: XS_XL}})}
    rows, _ = _check(monkeypatch, items, fam,
                     {('dk', 1): 'https://meshki.co.uk/products/j', ('dk', 2): 'https://x.dk/products/b'},
                     {'https://meshki.co.uk/products/j.json': [{'name': 'Size', 'values': ['W22', 'W24', 'W26']}],
                      'https://x.dk/products/b.json': [{'name': 'Color', 'values': ['Black']}]})
    assert rows['Jeans']['status'] == 'unreadable' and rows['Boot']['status'] == 'unreadable'


def test_a_group_whose_colours_or_stores_differ_is_not_proposed(monkeypatch):
    # britta-siblings: DK Salvie and FR Sauge on XS–XL, FI Salvie already S M L XL
    items = [_summary('a', 'Britta', XS_XL, ids=(1, 2, 3))]
    fam = {'a': _members({'dk': {1: XS_XL}, 'fr': {2: XS_XL}, 'fi': {3: ['S', 'M', 'L', 'XL']}})}
    rows, _ = _check(monkeypatch, items, fam, {('dk', 1): 'https://s.fr/products/b'},
                     {'https://s.fr/products/b.json': [{'name': 'Taille', 'values': ['S', 'M']}]})
    assert rows['Britta']['status'] == 'mixed' and rows['Britta']['proposed'] is None
    assert 'S M L XL' in rows['Britta']['note']


def test_sales_before_the_order_window_are_unknown(monkeypatch):
    # listed in June, orders read from August: no order on file proves nothing
    items = [_summary('a', 'Old', XS_XL, ids=(1,)), _summary('b', 'New', XS_XL, ids=(2,))]
    fam = {'a': _members({'dk': {1: XS_XL}}, created='2026-06-01T00:00:00Z'),
           'b': _members({'dk': {2: XS_XL}}, created='2026-09-01T00:00:00Z')}
    pages = {'https://s.fr/products/x.json': [{'name': 'Taille', 'values': ['S', 'M']}]}
    rows, _ = _check(monkeypatch, items, fam, {('dk', 1): 'https://s.fr/products/x', ('dk', 2): 'https://s.fr/products/x'},
                     pages)
    assert rows['Old']['orders_known'] is False and rows['New']['orders_known'] is True
    # an order sync that failed makes every "no orders" unknown
    rows, _ = _check(monkeypatch, items, fam, {('dk', 1): 'https://s.fr/products/x', ('dk', 2): 'https://s.fr/products/x'},
                     pages, meta={'dk': {'tracking_since': TRACKING, 'error': 'HTTP 503'}})
    assert rows['New']['orders_known'] is False


def _apply(monkeypatch, rows, states, processed=None):
    import json as _j
    _j.dump({'generated_at': '2026-09-30T10:00:00Z', 'rows': rows}, open(server.AQ_SIZE_REPORT_PATH, 'w', encoding='utf-8'))
    monkeypatch.setattr(server, '_aq_family_state', lambda key, force_index=False: states[key])
    monkeypatch.setattr(server, '_aq_state_sig', lambda st: 'sig')
    if processed is not None:
        monkeypatch.setattr(server, '_aq_processed', lambda: processed)
    applied = []

    def fake_apply(sub, key, target, sig, user):
        applied.append((key, target))
        server._aq_job(sub, status='done')
        server._aq_history_append({'type': 'apply', 'key': key, 'backup_id': 'b-' + key,
                                   'kind': 'size_backfill' if target.get('kind') == 'size_backfill' else 'quotation'})
        server._aq_history_append({'type': 'apply_done', 'key': key, 'backup_id': 'b-' + key, 'status': 'done'})
    monkeypatch.setattr(server, '_aq_apply_run', fake_apply)
    jid = server._aq_job_new('size_apply', '')
    server._aq_size_apply_run(jid, [r['key'] for r in rows], 'me')
    return applied, ' | '.join(l['text'] for l in server._AQ_JOBS[jid]['log'] if not l['ok'])


def _row(key, name, snapshot, stores=('dk',)):
    return {'key': key, 'name': name, 'status': 'change', 'current': XS_XL, 'proposed': ['S', 'M', 'L', 'XL', '2XL'],
            'source': 'competitor', 'stores': list(stores), 'snapshot': snapshot}


def _state(key, per_store, errors=None):
    return {'key': key, 'store_errors': errors or {},
            'stores': {s: [{'id': pid, 'status': 'active', 'sizes': sz} for pid, sz in prods.items()]
                       for s, prods in per_store.items()}}


def test_apply_skips_a_listing_that_changed_since_the_check_and_marks_backfill_not_done(monkeypatch):
    rows = [_row('a', 'Runa', {'dk': {'1': XS_XL}}), _row('b', 'Moved', {'dk': {'2': XS_XL}})]
    states = {'a': _state('a', {'dk': {1: XS_XL}}), 'b': _state('b', {'dk': {2: ['S', 'M', 'L']}})}
    applied, fails = _apply(monkeypatch, rows, states)
    assert [k for k, _ in applied] == ['a'] and applied[0][1]['sizes'] == ['S', 'M', 'L', 'XL', '2XL']
    assert applied[0][1]['kind'] == 'size_backfill'
    assert 'changed since the check' in fails
    assert 'a' not in server._aq_processed()             # still waits for the supplier's quote


def test_apply_checks_every_colour_and_store_not_just_the_first(monkeypatch):
    # a colour added, or a draft colour in FI fixed by hand, after the check
    rows = [_row('a', 'Added', {'dk': {'1': XS_XL}}), _row('b', 'FiFixed', {'dk': {'2': XS_XL}, 'fi': {'3': XS_XL}}, ('dk', 'fi'))]
    states = {'a': _state('a', {'dk': {1: XS_XL, 9: XS_XL}}),
              'b': _state('b', {'dk': {2: XS_XL}, 'fi': {3: ['S', 'M', 'L', 'XL']}})}
    applied, fails = _apply(monkeypatch, rows, states)
    assert applied == [] and fails.count('changed since the check') == 2


def test_apply_skips_a_group_whose_quotation_was_applied_after_the_check(monkeypatch):
    rows = [_row('a', 'Quoted', {'dk': {'1': XS_XL}})]
    applied, fails = _apply(monkeypatch, rows, {'a': _state('a', {'dk': {1: XS_XL}})},
                            processed={'a': '2026-09-30T11:00:00Z'})
    assert applied == [] and "quotation was applied" in fails


def test_apply_never_writes_half_a_group_when_a_store_cannot_be_read(monkeypatch):
    rows = [_row('a', 'NoFr', {'dk': {'1': XS_XL}, 'fr': {'2': XS_XL}}, ('dk', 'fr')),
            _row('b', 'FrErr', {'dk': {'3': XS_XL}})]
    states = {'a': _state('a', {'dk': {1: XS_XL}}),                                  # FR missing
              'b': _state('b', {'dk': {3: XS_XL}}, errors={'fr': 'HTTP 502'})}
    applied, fails = _apply(monkeypatch, rows, states)
    assert applied == [] and fails.count("couldn't be read") == 2


def test_a_backfill_apply_does_not_schedule_a_rebuild_per_group():
    src = open(server.__file__, encoding='utf-8').read()
    assert "_aq_refresh_after_write(written, rebuild=target.get('kind') != 'size_backfill')" in src


def test_competitor_json_url_is_built_from_any_product_link():
    f = server._aq_competitor_json_url
    assert f('https://www.chic-parisien.fr/collections/femme/products/dejana?_pos=1') == 'https://www.chic-parisien.fr/products/dejana.json'
    assert f('https://shop.dk/products/x.json') == 'https://shop.dk/products/x.json'
    assert f('https://shop.dk/pages/about') is None


@pytest.mark.parametrize('method,path', [('post', '/api/aq/size_backfill/check'), ('get', '/api/aq/size_backfill/report'),
                                         ('post', '/api/aq/size_backfill/apply')])
def test_size_backfill_routes_are_gated(monkeypatch, method, path):
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', 'unit-secret', raising=False)
    monkeypatch.delenv('DEV_LOCAL', raising=False)
    with server.app.test_client() as c:
        assert getattr(c, method)(path, json={} if method == 'post' else None).status_code == 401
