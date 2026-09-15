# -*- coding: utf-8 -*-
"""Discovery must look somewhere NEW each run.

The old run built the same 26 Google queries every time (8 terms x 5 'tells'),
so the same ~700 domains came back and only the 14-day 'seen' memory kept them
out — until it expired. Now: a rotating query bank per market, and the
'similar stores' source rotates its seed stores and pages deeper on reuse.
Also covers the step-① audience guard added in the same change.
"""
import server


def test_queries_rotate_between_runs():
    state = {}
    first = server._gd_pick_queries('dk', state, n=10)
    second = server._gd_pick_queries('dk', state, n=10)
    assert len(first) == 10 and len(second) == 10
    assert not set(first) & set(second)
    assert len(server._gd_query_bank('dk')) >= 100
    assert len(server._gd_query_bank('fi')) >= 100
    # the state carries the stamps, so the NEXT process rotates too
    assert set(state['queries']['dk']) == set(first) | set(second)


def test_query_bank_has_no_duplicates_and_folds_in_wtl_terms(monkeypatch):
    monkeypatch.setattr(server, '_gd_wtl_terms_any', lambda m, n=6: ['blazer'])
    bank = server._gd_query_bank('dk')
    assert len(bank) == len(set(bank))
    assert 'blazer webshop' in bank
    assert any('site:.dk' in q for q in bank)        # the old term x tell queries are still in


def test_seed_stores_rotate_and_page_deeper(monkeypatch):
    monkeypatch.setattr(server, '_gd_seed_candidates', lambda m: ['a.dk', 'b.dk', 'c.dk', 'd.dk'])
    state = {}
    assert server._gd_pick_seed_stores('dk', state, n=3) == [('a.dk', 0), ('b.dk', 0), ('c.dk', 0)]
    # d.dk was never used → first; a.dk/b.dk come back at offset 100
    assert server._gd_pick_seed_stores('dk', state, n=3) == [('d.dk', 0), ('a.dk', 100), ('b.dk', 100)]
    assert state['seed_offsets']['dk']['a.dk'] == 200


def test_seed_candidates_are_proven_fashion_sources_only(monkeypatch):
    monkeypatch.setattr(server, '_wtl_all_domains', lambda: {'good.dk', 'home.dk', 'skip.dk', 'none.dk', 'ali.dk'})
    monkeypatch.setattr(server, '_wtl_verdicts_load', lambda: {
        'good.dk': {'label': 'Dropshipper'}, 'home.dk': {'label': 'Dropshipper'},
        'skip.dk': {'label': 'Dropshipper'}, 'none.dk': {'label': 'Onbekend'},
        'ali.dk': {'label': 'Eigen voorraad', 'override': 'ali-verified'}})
    monkeypatch.setattr(server, '_wtl_niche_load', lambda: {'home.dk': {'status': 'no'}})
    monkeypatch.setattr(server, '_wtl_marks_load', lambda: {'skip.dk': {'mark': 'skip'}})
    monkeypatch.setattr(server, '_wtl_traffic_load', lambda: {
        'good.dk': {'total_visits': 1000, 'shares': {'DK': 1.0}},
        'ali.dk': {'total_visits': 5000, 'shares': {'DK': 0.9}}})
    monkeypatch.setattr(server, '_known_comp_data', lambda: [{'domain': 'imp.dk', 'products': 9}])
    out = server._gd_seed_candidates('dk')
    assert out[:2] == ['ali.dk', 'good.dk']          # best local traffic first
    assert 'home.dk' not in out and 'skip.dk' not in out and 'none.dk' not in out
    assert 'imp.dk' in out                            # fallback: most-imported-from


def test_audience_guard_drops_men_and_kids():
    kept, dropped = server._wtl_filter_audience([
        {'keyword': 'pantalon homme'}, {'keyword': 'robe longue'}, {'keyword': 'lasten mekko'}])
    assert [k['keyword'] for k in kept] == ['robe longue'] and dropped == 2
    assert server._wtl_filter_audience([]) == ([], 0)


def test_what_to_list_wires_guard_and_parallel_counts():
    import inspect
    src = inspect.getsource(server.api_what_to_list)
    assert '_wtl_filter_audience(' in src
    assert 'pool.submit(_recent_cat_counts' in src and 'pool.submit(_live_cat_counts' in src
    assert "'clean_ok'" in src


def test_clean_fail_open_is_recorded(monkeypatch):
    monkeypatch.setattr(server, 'ANTHROPIC_KEY', '')
    kws = [{'keyword': 'nike sko'}]
    assert server._dfs_clean_keywords_llm(kws, 'dk') == kws
    assert server._DFS_CLEAN_LAST['dk']['ok'] is False
