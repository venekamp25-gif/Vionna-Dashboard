# -*- coding: utf-8 -*-
"""After Quotation speed + first-order signal (v1.322).

Measured 30 Sep 2026: a warm search took 2.3 s (95% re-deaccenting the colour
table), a search right after a deploy 12-16 s (index only in memory), opening a
listing 3.8 s (one global 0.55 s gap after every GraphQL call). venek: "searching
takes far too long" + "put recently first-sold products on top, as default"."""
import datetime
import json
import time

import pytest

import server


class _R:
    def __init__(self, status=200, body=None, headers=None, text=None):
        self.status_code, self._b = status, body or {}
        self.headers = headers or {}
        self.text = text if text is not None else json.dumps(self._b)

    def json(self):
        return self._b


@pytest.fixture
def aq_tmp(monkeypatch, tmp_path):
    monkeypatch.setattr(server, 'AQ_ORDERS_PATH', str(tmp_path / 'aq_orders.json'))
    monkeypatch.setattr(server, 'AQ_INDEX_DISK', str(tmp_path / 'aq_index_%s.json'))
    monkeypatch.setattr(server, 'AQ_HISTORY_PATH', str(tmp_path / 'aq_history.jsonl'))
    monkeypatch.setattr(server, '_AQ_ORDERS', {'data': None, 'agg': None, 'ver': 0})
    monkeypatch.setattr(server, '_AQ_SUMMARY_CACHE', {'sig': None, 'items': None})
    monkeypatch.setattr(server, '_AQ_LIST_CACHE', {'sig': None, 'payload': None})
    monkeypatch.setattr(server, '_AQ_INDEX', {})
    monkeypatch.setattr(server, '_AQ_INDEX_PATCHES', {s: [] for s in server.AQ_STORES})
    monkeypatch.setattr(server, 'tokens', {'dk': {'shop': 'dk.myshopify.com', 'token': 't'},
                                           'fr': {'shop': 'fr.myshopify.com', 'token': 't'}})
    return tmp_path


def _node(pid, title, colour, created, status='ACTIVE', sib='x-siblings', cat='dress', sizes=('XS', 'S')):
    return {'legacyResourceId': str(pid), 'title': title, 'handle': f'{title.lower()}-{colour.lower()}',
            'status': status, 'productType': 'Dress', 'createdAt': created, 'tags': [f'cat:{cat}'],
            'featuredImage': {'url': 'https://cdn/x.jpg'}, 'options': [{'name': 'Size', 'values': list(sizes)}],
            'cut': {'value': colour}, 'sib': {'value': sib},
            # a chart that matches the sizes: no hard flag unless a test wants one
            'sc': {'value': '<table><tr><th>Size</th><th>Bust</th></tr>'
                            + ''.join(f'<tr><td>{x}</td><td>8{i}</td></tr>' for i, x in enumerate(sizes))
                            + '</table>'}}


def _orders_page(orders):
    return {'orders': {'pageInfo': {'hasNextPage': False}, 'nodes': orders}}


def _order(oid, created, pids, cancelled=False, test=False, updated=None):
    return {'legacyResourceId': str(oid), 'createdAt': created, 'updatedAt': updated or created,
            'cancelledAt': '2026-09-29T00:00:00Z' if cancelled else None, 'test': test,
            'lineItems': {'nodes': [{'quantity': 1, 'product': {'legacyResourceId': str(p)}} for p in pids]}}


def test_colour_concept_is_memoised_and_answers_like_before():
    assert server._color_concept('Mørkeblå') == 'navy' and server._color_concept('Rose Vif') == 'pink'
    info = server._color_concept.cache_info()
    server._color_concept('Mørkeblå')
    assert server._color_concept.cache_info().hits > info.hits


def test_orders_sync_keeps_per_order_data_and_counts_only_real_orders(aq_tmp, monkeypatch):
    now = datetime.datetime.utcnow()
    iso = lambda d: (now - datetime.timedelta(days=d)).strftime('%Y-%m-%dT%H:%M:%SZ')
    page = _orders_page([_order(1, iso(3), [11]), _order(2, iso(1), [11, 12]),
                         _order(3, iso(2), [13], cancelled=True), _order(4, iso(2), [14], test=True)])
    monkeypatch.setattr(server, '_aq_gql', lambda s, q, v=None: page if s == 'dk' else _orders_page([]))
    server._aq_orders_sync('dk')
    saved = json.load(open(aq_tmp / 'aq_orders.json', encoding='utf-8'))
    st = saved['stores']['dk']
    assert set(st['orders']) == {'1', '2', '3', '4'} and st['tracking_since'] and st['full_at']
    assert 'customer' not in json.dumps(saved)                      # no customer data on disk
    agg, meta = server._aq_orders_agg()
    assert agg[('dk', 11)]['first'] == iso(3) and len(agg[('dk', 11)]['orders']) == 2
    assert ('dk', 13) not in agg and ('dk', 14) not in agg          # cancelled / test don't count
    assert meta['dk']['error'] is None


def test_a_failed_orders_sync_keeps_the_data_and_says_so(aq_tmp, monkeypatch):
    monkeypatch.setattr(server, '_aq_gql', lambda s, q, v=None: _orders_page([_order(1, '2026-09-28T10:00:00Z', [11])]))
    server._aq_orders_sync('dk')
    monkeypatch.setattr(server, '_aq_gql', lambda s, q, v=None: (_ for _ in ()).throw(RuntimeError('HTTP 503')))
    server._aq_orders_sync('dk', full=True)
    agg, meta = server._aq_orders_agg()
    assert ('dk', 11) in agg and 'HTTP 503' in meta['dk']['error']   # storing ≠ oordeel


def test_first_order_is_certain_only_for_products_created_while_we_watch():
    agg = {('dk', 1): {'first': '2026-09-20T00:00:00Z', 'last': '2026-09-25T00:00:00Z', 'orders': {'a', 'b'}}}
    meta = {'dk': {'tracking_since': '2026-08-01T00:00:00Z'}}
    new = {'dk': [{'id': 1, 'created': '2026-09-01T00:00:00Z'}, {'id': 2, 'created': '2026-09-02T00:00:00Z'}]}
    old = {'dk': [{'id': 1, 'created': '2026-05-01T00:00:00Z'}]}
    o = server._aq_family_orders(new, agg, meta)
    assert o == {'first': '2026-09-20T00:00:00Z', 'last': '2026-09-25T00:00:00Z', 'count': 2, 'first_known': True}
    assert server._aq_family_orders(old, agg, meta)['first_known'] is False
    assert server._aq_family_orders({'dk': [{'id': 9, 'created': 'x'}]}, agg, meta) is None


def _seed_index(monkeypatch):
    now = datetime.datetime.utcnow()
    iso = lambda d: (now - datetime.timedelta(days=d)).strftime('%Y-%m-%dT%H:%M:%SZ')
    nodes = [_node(11, 'Ottilie', 'Sort', iso(10), sib='ottilie-siblings'),
             _node(21, 'Runa', 'Hvid', iso(20), sib='runa-siblings'),
             _node(31, 'Gamle', 'Sort', iso(400), sib='gamle-siblings'),
             _node(41, 'Frisk', 'Blå', iso(5), sib='frisk-siblings')]
    orders = _orders_page([_order(1, iso(1), [11]), _order(2, iso(4), [21]), _order(3, iso(2), [31])])

    def gql(store, q, v=None):
        if 'orders(' in q:
            return orders if store == 'dk' else _orders_page([])
        if 'status:archived' in q:
            return {'products': {'pageInfo': {'hasNextPage': False}, 'nodes': []}}
        if store == 'dk':
            return {'products': {'pageInfo': {'hasNextPage': False}, 'nodes': nodes}}
        return {'products': {'pageInfo': {'hasNextPage': False}, 'nodes': []}}
    monkeypatch.setattr(server, '_aq_gql', gql)
    return iso


def test_recommended_puts_the_newest_first_order_on_top(aq_tmp, monkeypatch):
    _seed_index(monkeypatch)
    res = server._aq_search('', 'recommended')
    names = [f['name'] for f in res['families']]
    # Ottilie first-ordered yesterday, Runa 4 days ago (both certain), Gamle
    # (listed before we watched: first order unknown) after them, then the
    # fresh unsold listing — Gamle has no other reason to be there
    assert names == ['Ottilie', 'Runa', 'Gamle', 'Frisk']
    assert res['families'][0]['orders']['first_known'] is True
    assert res['families'][2]['orders']['first_known'] is False
    assert server._aq_search('', 'attention')['total'] == 3               # Gamle: too old, no flag
    assert [f['name'] for f in server._aq_search('run', 'recommended')['families']] == ['Runa']


def test_search_is_served_from_prepared_summaries(aq_tmp, monkeypatch):
    _seed_index(monkeypatch)
    server._aq_search('', 'recommended')
    monkeypatch.setattr(server, '_aq_family_summary', lambda *a, **k: pytest.fail('rebuilt per search'))
    t = time.perf_counter()
    for q in ('', 'o', 'ott', 'sort'):
        server._aq_search(q, 'recommended')
    assert time.perf_counter() - t < 0.5


def test_the_list_endpoint_carries_what_the_page_filters_on(aq_tmp, monkeypatch):
    _seed_index(monkeypatch)
    lst = server._aq_list()
    by = {f['name']: f for f in lst['families']}
    assert by['Ottilie']['rec'][0] == 3 and by['Gamle']['rec'][0] == 2 and by['Frisk']['rec'][0] == 1
    assert by['Frisk']['att'] is True and by['Gamle']['att'] is False
    assert 'sort' in by['Ottilie']['hay'] and by['Ottilie']['names'] == ['ottilie']
    assert lst['orders_meta']['dk']['tracking_since']


def test_after_a_restart_the_disk_copy_is_served_at_once(aq_tmp, monkeypatch):
    _seed_index(monkeypatch)
    server._aq_index('dk')                                   # builds + writes the disk copy
    monkeypatch.setattr(server, '_AQ_INDEX', {})             # "restart"
    monkeypatch.setattr(server, '_aq_gql', lambda *a, **k: pytest.fail('rebuilt instead of the disk copy'))
    assert [p['title'] for p in server._aq_index('dk')][:1] == ['Ottilie']


def test_a_write_is_patched_in_by_id_and_survives_a_build_that_started_before_it(aq_tmp, monkeypatch):
    iso = _seed_index(monkeypatch)
    server._aq_index('dk')
    created = _node(99, 'Ottilie', 'Beige', iso(0), status='DRAFT', sib='ottilie-siblings')
    monkeypatch.setattr(server, '_aq_gql', lambda s, q, v=None: {'nodes': [created, None]})
    server._aq_index_patch('dk', [99, 21])                   # 21 no longer exists → dropped
    ids = {p['id'] for p in server._AQ_INDEX['dk']['products']}
    assert 99 in ids and 21 not in ids
    # a full build that STARTED before the patch must not bring the old state back
    old_nodes = [_node(11, 'Ottilie', 'Sort', iso(10), sib='ottilie-siblings'), _node(21, 'Runa', 'Hvid', iso(20))]
    t_patch = server._AQ_INDEX_PATCHES['dk'][-1][0]
    monkeypatch.setattr(server.time, 'time', lambda: t_patch - 5)        # build start < patch
    monkeypatch.setattr(server, '_aq_gql', lambda s, q, v=None: {'products': {'pageInfo': {'hasNextPage': False},
                                                                             'nodes': old_nodes}})
    out = server._aq_index_build('dk', 0)
    got = {p['id'] for p in out}
    assert 99 in got and 21 not in got


def test_pacing_is_per_shop_and_graphql_reads_its_own_budget():
    assert server._shopify_pace_key('https://dk.myshopify.com/admin/api/2024-10/products/1.json') == 'dk.myshopify.com'
    assert server._shopify_pace_key('https://dk.myshopify.com/admin/api/2024-10/graphql.json') == 'dk.myshopify.com:gql'
    rest_full = _R(headers={'X-Shopify-Shop-Api-Call-Limit': '35/40'})
    rest_ok = _R(headers={'X-Shopify-Shop-Api-Call-Limit': '5/40'})
    assert server._shopify_gap_after(rest_full, False) == server._SHOPIFY_MIN_INTERVAL
    assert server._shopify_gap_after(rest_ok, False) == 0.0
    plenty = _R(text='{"data":{},"extensions":{"cost":{"requestedQueryCost":68,"throttleStatus":'
                     '{"maximumAvailable":2000,"currentlyAvailable":1900,"restoreRate":100}}}}')
    empty = _R(text='{"data":{},"extensions":{"cost":{"requestedQueryCost":500,"throttleStatus":'
                    '{"maximumAvailable":2000,"currentlyAvailable":100,"restoreRate":100}}}}')
    assert server._shopify_gap_after(plenty, True) == 0.0           # no blind 0.55 s after GraphQL
    assert server._shopify_gap_after(empty, True) == pytest.approx(9.0)


def test_a_waiting_store_does_not_hold_up_the_others(monkeypatch):
    monkeypatch.setattr(server, '_shopify_next_gap', {'slow.myshopify.com': 5.0})
    monkeypatch.setattr(server, '_shopify_last_call_at', {'slow.myshopify.com': time.monotonic()})
    monkeypatch.setattr(server.req, 'get', lambda url, **k: _R(headers={'X-Shopify-Shop-Api-Call-Limit': '1/40'}))
    t = time.perf_counter()
    server._shopify_call('get', 'https://fast.myshopify.com/admin/api/2024-10/products.json', {})
    assert time.perf_counter() - t < 1.0


def test_json_answers_are_gzipped_for_browsers_that_ask(monkeypatch):
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', None)
    monkeypatch.setenv('DEV_LOCAL', '1')
    monkeypatch.setattr(server, '_aq_list', lambda force=False: {'families': [{'name': 'x' * 50}] * 200})
    with server.app.test_client() as c:
        r = c.get('/api/aq/list', headers={'Accept-Encoding': 'gzip, br'})
        plain = c.get('/api/aq/list')
    import gzip
    assert r.headers.get('Content-Encoding') == 'gzip' and 'Accept-Encoding' in r.headers.get('Vary', '')
    assert json.loads(gzip.decompress(r.get_data()))['families'][0]['name'] == 'x' * 50
    assert plain.headers.get('Content-Encoding') is None


def test_the_list_route_is_gated(monkeypatch):
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', 'unit-secret', raising=False)
    monkeypatch.delenv('DEV_LOCAL', raising=False)
    with server.app.test_client() as c:
        assert c.get('/api/aq/list').status_code == 401


def test_a_build_that_suddenly_finds_half_the_catalogue_keeps_the_good_list(aq_tmp, monkeypatch):
    good = [{'id': i, 'title': f'P{i}'} for i in range(200)]
    monkeypatch.setitem(server._AQ_INDEX, 'dk', {'ts': time.time() - 3600, 'products': good})
    monkeypatch.setattr(server, '_aq_gql', lambda s, q, v=None: {'products': {'pageInfo': {'hasNextPage': False},
                                                                             'nodes': []}})
    with pytest.raises(RuntimeError, match='shrank'):
        server._aq_index_build('dk', 0)
    assert server._AQ_INDEX['dk']['products'] is good
    assert not (aq_tmp / 'aq_index_dk.json').exists()


# ── adversarial review 30 Sep: regressions ─────────────────────────────────────

def test_a_patch_survives_a_build_that_starts_just_after_it(aq_tmp, monkeypatch):
    iso = _seed_index(monkeypatch)
    server._aq_index('dk')
    created = _node(99, 'Ottilie', 'Beige', iso(0), status='DRAFT', sib='ottilie-siblings')
    monkeypatch.setattr(server, '_aq_gql', lambda s, q, v=None: {'nodes': [created]})
    server._aq_index_patch('dk', [99])
    t_patch = server._AQ_INDEX_PATCHES['dk'][-1][0]
    # Shopify's search hasn't caught up: a build 5 s AFTER the patch doesn't see 99
    monkeypatch.setattr(server.time, 'time', lambda: t_patch + 5)
    monkeypatch.setattr(server, '_aq_gql', lambda s, q, v=None: {'products': {'pageInfo': {'hasNextPage': False},
                                                                             'nodes': [_node(11, 'Ottilie', 'Sort', iso(10), sib='ottilie-siblings')]}})
    out = server._aq_index_build('dk', 0)
    assert 99 in {p['id'] for p in out}


def test_a_failed_refresh_serves_the_last_good_copy(aq_tmp, monkeypatch):
    _seed_index(monkeypatch)
    before = server._aq_list()
    n = len(before['families'])
    with server._AQ_INDEX_LOCK:
        server._AQ_INDEX['dk'] = {**server._AQ_INDEX['dk'], 'ts': time.time() - 3600}
    monkeypatch.setattr(server, '_aq_gql', lambda s, q, v=None: (_ for _ in ()).throw(RuntimeError('HTTP 503'))
                        if 'orders(' not in q else _orders_page([]))
    after = server._aq_list(force=True)
    assert len(after['families']) == n and 'showing the last copy' in after['store_errors']['dk']


def test_a_failing_orders_store_backs_off_and_keeps_the_caches(aq_tmp, monkeypatch):
    calls = []

    def gql(s, q, v=None):
        calls.append(s)
        raise RuntimeError('ACCESS_DENIED')
    monkeypatch.setattr(server, '_aq_gql', gql)
    server._aq_orders_ensure()
    v1 = server._AQ_ORDERS['ver']
    server._aq_orders_ensure()
    server._aq_orders_ensure()
    assert server._AQ_ORDERS['ver'] == v1                       # same error: no cache bust
    assert calls.count('dk') == 1                               # and no retry inside the back-off


def test_an_archived_colour_sold_earlier_makes_the_first_order_uncertain_and_older():
    agg = {('dk', 12): {'first': '2026-09-29T00:00:00Z', 'last': '2026-09-29T00:00:00Z', 'orders': {'b'}},
           ('dk', 11): {'first': '2026-08-20T00:00:00Z', 'last': '2026-08-20T00:00:00Z', 'orders': {'a'}}}
    meta = {'dk': {'tracking_since': '2026-08-01T00:00:00Z'}}
    live = {'dk': [{'id': 12, 'created': '2026-09-01T00:00:00Z'}]}
    arch = {'dk': [{'id': 11, 'created': '2026-08-10T00:00:00Z'}]}
    o = server._aq_family_orders(live, agg, meta, arch)
    assert o['first'] == '2026-08-20T00:00:00Z' and o['count'] == 2 and o['first_known'] is True
    old_arch = {'dk': [{'id': 11, 'created': '2026-05-01T00:00:00Z'}]}
    assert server._aq_family_orders(live, agg, meta, old_arch)['first_known'] is False


def test_an_order_line_removed_by_an_edit_is_not_a_sale(aq_tmp, monkeypatch):
    page = _orders_page([{'legacyResourceId': '1', 'createdAt': '2026-09-29T10:00:00Z', 'updatedAt': '2026-09-29T11:00:00Z',
                          'cancelledAt': None, 'test': False, 'lineItems': {'nodes': [
                              {'quantity': 1, 'currentQuantity': 0, 'product': {'legacyResourceId': '11'}},
                              {'quantity': 1, 'currentQuantity': 1, 'product': {'legacyResourceId': '12'}}]}}])
    monkeypatch.setattr(server, '_aq_gql', lambda s, q, v=None: page)
    server._aq_orders_sync('dk')
    agg, _ = server._aq_orders_agg()
    assert ('dk', 11) not in agg and ('dk', 12) in agg


def test_a_sync_gap_longer_than_shopifys_window_moves_tracking_forward(aq_tmp, monkeypatch):
    monkeypatch.setattr(server, '_aq_gql', lambda s, q, v=None: _orders_page([]))
    server._aq_orders_sync('dk')
    with server._AQ_ORDERS_LOCK:
        st = server._AQ_ORDERS['data']['stores']['dk']
        st['tracking_since'] = '2026-01-01T00:00:00Z'
        st['synced_at'] = '2026-03-01T00:00:00Z'
    server._aq_orders_sync('dk', full=True)
    assert server._AQ_ORDERS['data']['stores']['dk']['tracking_since'] > '2026-07-01'


def test_an_older_index_entry_is_never_saved_over_a_newer_one(aq_tmp):
    old = {'ts': 1.0, 'products': [{'id': 1}]}
    new = {'ts': 2.0, 'products': [{'id': 1}, {'id': 99}]}
    with server._AQ_INDEX_LOCK:
        server._AQ_INDEX['dk'] = new
    server._aq_index_disk_save('dk', old)                       # stale writer arrives late
    assert not (aq_tmp / 'aq_index_dk.json').exists()
    server._aq_index_disk_save('dk', new)
    assert len(json.load(open(aq_tmp / 'aq_index_dk.json'))['products']) == 2
