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
    ('Pointure', 'shoes', ['35', '36', '37', '38', '39', '40', '41', '42', '43'], ['35', '36', '37', '38', '39', '40', '41', '42', '43'], 'competitor'),
    ('Maat', 'garment', ['S (36)', 'M (38)', 'L (40/42)', 'XL (44)', '2XL (46)', '3XL (48)'], ['S', 'M', 'L', 'XL', '2XL', '3XL'], 'competitor'),
    ('Size', 'garment', ['6', '8', '10', '12', '14', '16', '18'], ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'], 'converted-uk'),
    ('Size', 'shoes', ['5', '6', '7', '8', '9', '10'], ['38', '39', '40', '41', '42', '43'], 'converted-uk'),
    ('SIZE', 'garment', ['4', '6', '7', '8', '9', '10', '11'], ['XS', 'S', 'M', 'L', 'XL'], 'default'),
    ('Koko', 'garment', ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'], ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'], 'competitor'),
    ('Taille', 'garment', ['Taille unique'], ['One Size'], 'competitor'),
    ('Taille', 'garment', ['S', 'M (presque épuisé)', 'L Quasi épuisé'], ['S', 'M', 'L'], 'competitor'),
    ('Größe', 'shoes', ['UK 2 | EU 35', '35.5', '36', 'UK 6 | EU 39', '39.5'], ['35', '35.5', '36', '39', '39.5'], 'competitor'),
    ('Taille', 'garment', ['M', 'S', 'XL', "L'", 'XXL'], ['S', 'M', 'L', 'XL', '2XL'], 'competitor'),
    ('Size', 'garment', ['S/M', 'L/XL', 'XS', '2XL/3XL'], ['XS', 'S/M', 'L/XL', '2XL/3XL'], 'competitor'),
    ('Taille', 'garment', ['36.0', '38.0', '40.0'], ['36', '38', '40'], 'competitor'),
    ('Size', 'accessory', ['XS', 'S', 'M'], ['One Size'], 'one-size'),
    ('Color', 'garment', ['Black', 'White'], ['XS', 'S', 'M', 'L', 'XL'], 'default'),
    ('Color', 'shoes', ['Black'], ['36', '37', '38', '39', '40', '41'], 'shoe-default'),
    ('Forstørrelse', 'garment', ['+1.00', '+2.50'], ['XS', 'S', 'M', 'L', 'XL'], 'default'),
    ('Größe', 'garment', ['Einheitsgröße'], ['One Size'], 'competitor'),
    ('Taille', 'garment', ['XS', 'S', 'M', 'L', 'XL'], ['XS', 'S', 'M', 'L', 'XL'], 'competitor'),
]


@pytest.mark.parametrize('name,cat,values,sizes,source', CASES)
def test_real_competitor_size_lists_become_the_listing_sizes(name, cat, values, sizes, source):
    r = server._competitor_sizes([{'name': 'Couleur', 'values': ['Noir', 'Blanc']}, {'name': name, 'values': values}], cat)
    assert r['sizes'] == sizes and r['source'] == source


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
    captured, history = _publish(monkeypatch, [], 'dress', store='dk', sizes_source=None)
    assert captured['sizes'] == ['XS', 'S', 'M', 'L', 'XL'] and history[-1]['sizes_source'] == 'default'


# ── size backfill (check → apply) ─────────────────────────────────────────────

def _summary(key, name, sizes, cat='dress', active=1, processed=None, orders=None, ids=(1,)):
    return {'s': {'key': key, 'name': name, 'cat': cat, 'image': '', 'sizes': list(sizes), 'active': active,
                  'processed': processed, 'orders': orders, 'stores': {'dk': 1}},
            'ids': frozenset(ids)}


def test_the_check_proposes_competitor_sizes_only_for_default_listings(monkeypatch):
    items = [_summary('a', 'Runa', ['XS', 'S', 'M', 'L', 'XL'], ids=(1,)),
             _summary('b', 'Sabine', ['XS', 'S', 'M', 'L', 'XL'], cat='shoes', ids=(2,), orders={'count': 3}),
             _summary('c', 'Frida', ['S', 'M', 'L'], ids=(3,)),                      # already real sizes
             _summary('d', 'Done', ['XS', 'S', 'M', 'L', 'XL'], processed='2026-09-01', ids=(4,)),
             _summary('e', 'Nosrc', ['XS', 'S', 'M', 'L', 'XL'], ids=(5,))]
    monkeypatch.setattr(server, '_aq_summaries', lambda force=False: (items, {}))
    monkeypatch.setattr(server, '_aq_source_urls', lambda: {('dk', 1): 'https://shop.fr/products/runa?x=1',
                                                            ('dk', 2): 'https://shop.fr/collections/c/products/sabine'})
    pages = {'https://shop.fr/products/runa.json': [{'name': 'Taille', 'values': ['S', 'M', 'L', 'XL', 'XXL']}],
             'https://shop.fr/products/sabine.json': [{'name': 'Pointure', 'values': ['36', '37', '38']}]}
    monkeypatch.setattr(server, '_aq_competitor_options', lambda url: (pages[server._aq_competitor_json_url(url)], 'ok'))
    monkeypatch.setattr(server.time, 'sleep', lambda s: None)
    jid = server._aq_job_new('size_check', '')
    server._aq_size_check_run(jid, 'me')
    rep = __import__('json').load(open(server.AQ_SIZE_REPORT_PATH, encoding='utf-8'))
    rows = {r['name']: r for r in rep['rows']}
    assert set(rows) == {'Runa', 'Sabine', 'Nosrc'}                            # Frida real, Done processed
    assert rows['Runa']['proposed'] == ['S', 'M', 'L', 'XL', '2XL'] and rows['Runa']['status'] == 'change'
    assert rows['Sabine']['proposed'] == ['36', '37', '38'] and rows['Sabine']['orders'] == 3
    assert rows['Nosrc']['status'] == 'no_source'


def test_apply_skips_a_listing_that_changed_since_the_check_and_marks_backfill_not_done(monkeypatch):
    import json as _j
    report = {'rows': [{'key': 'a', 'name': 'Runa', 'status': 'change', 'current': ['XS', 'S', 'M', 'L', 'XL'],
                        'proposed': ['S', 'M', 'L', 'XL', '2XL'], 'source': 'competitor'},
                       {'key': 'b', 'name': 'Moved', 'status': 'change', 'current': ['XS', 'S', 'M', 'L', 'XL'],
                        'proposed': ['S', 'M'], 'source': 'competitor'}]}
    _j.dump(report, open(server.AQ_SIZE_REPORT_PATH, 'w', encoding='utf-8'))
    states = {'a': {'key': 'a', 'stores': {'dk': [{'status': 'active', 'sizes': ['XS', 'S', 'M', 'L', 'XL']}]}},
              'b': {'key': 'b', 'stores': {'dk': [{'status': 'active', 'sizes': ['S', 'M', 'L']}]}}}
    monkeypatch.setattr(server, '_aq_family_state', lambda key, force_index=False: states[key])
    monkeypatch.setattr(server, '_aq_state_sig', lambda st: 'sig')
    applied = []

    def fake_apply(sub, key, target, sig, user):
        applied.append((key, target))
        server._aq_job(sub, status='done')
        server._aq_history_append({'type': 'apply', 'key': key, 'backup_id': 'b-' + key,
                                   'kind': 'size_backfill' if target.get('kind') == 'size_backfill' else 'quotation'})
        server._aq_history_append({'type': 'apply_done', 'key': key, 'backup_id': 'b-' + key, 'status': 'done'})
    monkeypatch.setattr(server, '_aq_apply_run', fake_apply)
    jid = server._aq_job_new('size_apply', '')
    server._aq_size_apply_run(jid, ['a', 'b'], 'me')
    assert [k for k, _ in applied] == ['a'] and applied[0][1]['sizes'] == ['S', 'M', 'L', 'XL', '2XL']
    assert applied[0][1]['kind'] == 'size_backfill'
    log = ' '.join(l['text'] for l in server._AQ_JOBS[jid]['log'])
    assert 'changed since the check' in log
    assert 'a' not in server._aq_processed()             # still waits for the supplier's quote


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
