# -*- coding: utf-8 -*-
"""Store discovery streams its finds, gates on the niche, and never scans in
the gate.

venek, 2026-09-15: "yesterday it took 2,5 hours to find new stores, it is
constantly finding and giving the same stores and also if it found something
new it wasn't a fashion store." The old pipeline reported nothing until the
end, used a full 21-request bestseller scan as its 'fashion' check (a furniture
store passes that) and ran the 1-minute dropship check per passer one at a time.
"""
import datetime
import json
import threading
import time

import server


def _resp_products(n, title, ptype):
    return [{'title': f'{title} {i}', 'product_type': ptype, 'tags': []} for i in range(n)]


SAMPLES = {
    'newshop.dk': (_resp_products(12, 'Sommerkjole', 'Kjoler'), 200, None),
    'homeshop.dk': (_resp_products(12, 'Duftlys', 'Home'), 200, None),
    'serpshop.dk': (None, 503, 'HTTP 503'),
    'notshop.dk': (None, 404, 'HTTP 404'),
}


def _setup(monkeypatch, tmp_path, classify=None):
    for name, fn in (('WTL_NICHE_PATH', 'niche.json'), ('WTL_VERDICTS_PATH', 'verdicts.json'),
                     ('WTL_EXTRA_STORES_PATH', 'extra.json'), ('WTL_DISCOVER_STATE_PATH', 'state.json'),
                     ('WTL_DISCOVER_SEEN_PATH', 'seen.json')):
        monkeypatch.setattr(server, name, str(tmp_path / fn))
    monkeypatch.setattr(server, '_wtl_traffic_load', lambda: {})
    monkeypatch.setattr(server, '_wtl_traffic_save', lambda data: None)
    monkeypatch.setattr(server, '_wtl_marks_load', lambda: {})
    monkeypatch.setattr(server, '_wtl_all_domains', lambda: {'known.dk'})
    monkeypatch.setattr(server, '_load_blocked_sources', lambda: set())
    monkeypatch.setattr(server, '_dfs_configured', lambda: True)
    monkeypatch.setattr(server, '_gd_pick_seed_stores', lambda m, st, n=3: [('seed.dk', 0)])
    monkeypatch.setattr(server, '_gd_pick_queries', lambda m, st, n=24: ['kjole webshop'])
    monkeypatch.setattr(server, '_dfs_competitor_domains',
                        lambda target, store, limit=100, offset=0: [
                            {'domain': 'newshop.dk'}, {'domain': 'known.dk'}, {'domain': 'homeshop.dk'},
                            {'domain': 'notshop.dk'}])
    monkeypatch.setattr(server, '_dfs_serp_results',
                        lambda q, store, depth=30: [{'url': 'https://serpshop.dk/x', 'type': 'organic'},
                                                    {'url': 'https://www.facebook.com/x', 'type': 'organic'}])
    monkeypatch.setattr(server, '_gd_is_local', lambda d, m: True)
    monkeypatch.setattr(server, '_gd_products_sample', lambda d, **kw: SAMPLES[d])
    monkeypatch.setattr(server, '_wtl_classify_store', classify or (lambda d: {
        'label': 'Dropshipper', 'detail': '', 'confidence': 'high', 'source': 'policy',
        'ts': datetime.datetime.utcnow().isoformat() + 'Z'}))
    # The gate must never trigger a bestseller scan (that was the 21-request
    # check per candidate). Make it explode if it does.
    monkeypatch.setattr(server, '_bs_scan_cached', lambda *a, **k: (_ for _ in ()).throw(AssertionError('scan in gate')))
    monkeypatch.setattr(server, '_wtl_catalog_overlap', lambda d: (_ for _ in ()).throw(AssertionError('overlap scan in gate')))
    monkeypatch.setattr(server, '_similarweb_bulk',
                        lambda hosts: {h: {'total_visits': 5000, 'shares': {'DK': 1.0}, 'ts': 'x'} for h in hosts})
    import shipping_check
    monkeypatch.setattr(shipping_check, 'looks_like_brand', lambda d: (False, []))


def test_pipeline_end_to_end(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path)
    jid = server._job_new('wtl_discover', 'wtl')
    res = server._wtl_discover(['dk'], jid=jid)

    assert [a['domain'] for a in res['added']] == ['newshop.dk']
    assert res['added'][0]['status'] == 'added' and res['added'][0]['verdict'] == 'Dropshipper'
    reasons = {s['domain']: s['reason'] for s in res['skipped']}
    assert reasons['homeshop.dk'].startswith('geen damesmode (home')
    assert reasons['serpshop.dk'].startswith('check mislukt')
    assert reasons['notshop.dk'] == 'geen Shopify'
    assert 'known.dk' not in reasons and 'facebook.com' not in reasons
    assert res['candidates'] == 4 and res['known_or_seen'] == 1
    assert res['sources'] == {'competitors': 3, 'google': 1}

    # Added at once: extra-stores file + verdict cache, so the stores tab shows it.
    assert json.load(open(tmp_path / 'extra.json')) == ['newshop.dk']
    assert json.load(open(tmp_path / 'verdicts.json'))['newshop.dk']['label'] == 'Dropshipper'
    assert json.load(open(tmp_path / 'niche.json'))['newshop.dk']['status'] == 'yes'

    # The job carries the live list and the counters the UI shows.
    live = server._JOBS[jid]['live']
    assert [r['domain'] for r in live['found']] == ['newshop.dk']
    assert live['found'][0]['status'] == 'added' and live['found'][0]['visits'] == 5000
    assert live['sources'] == {'competitors': 3, 'google': 1}
    assert server._JOBS[jid]['total'] == 4 and server._JOBS[jid]['processed'] == 4

    # Rejections are remembered — with a SHORT memory for a transient failure.
    seen = json.load(open(tmp_path / 'seen.json'))
    assert server._gd_seen_fresh(seen, 'homeshop.dk') and server._gd_seen_fresh(seen, 'serpshop.dk')
    two_days = (datetime.datetime.utcnow() - datetime.timedelta(days=2)).isoformat() + 'Z'
    seen['serpshop.dk']['ts'] = two_days
    seen['homeshop.dk']['ts'] = two_days
    assert not server._gd_seen_fresh(seen, 'serpshop.dk')   # 'check mislukt' = 1 day
    assert server._gd_seen_fresh(seen, 'homeshop.dk')       # 'geen damesmode' = 60 days


def test_first_store_is_visible_before_the_dropship_gate_finishes(monkeypatch, tmp_path):
    gate = threading.Event()

    def slow_classify(d):
        gate.wait(10)
        return {'label': 'Onbekend', 'detail': '', 'confidence': 'none', 'source': 'none', 'ts': 'x'}
    _setup(monkeypatch, tmp_path, classify=slow_classify)
    jid = server._job_new('wtl_discover', 'wtl')
    out = []
    t = threading.Thread(target=lambda: out.append(server._wtl_discover(['dk'], jid=jid)), daemon=True)
    t.start()
    found = []
    for _ in range(200):                         # up to 10 s
        found = (server._JOBS[jid].get('live') or {}).get('found') or []
        if found:
            break
        time.sleep(0.05)
    assert found and found[0]['domain'] == 'newshop.dk'
    assert found[0]['status'] == 'checking'      # shown while the gate still runs
    assert t.is_alive()
    gate.set()
    t.join(15)
    assert not t.is_alive()
    res = out[0]
    # 'Onbekend' = no evidence either way → added, flagged as unverified.
    assert res['added'][0]['status'] == 'added_unverified'
    assert [u['domain'] for u in res['uncertain']] == ['newshop.dk']
    assert server._JOBS[jid]['live']['found'][0]['status'] == 'added_unverified'


def test_brand_is_rejected_and_remembered(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path, classify=lambda d: {
        'label': 'Eigen voorraad', 'detail': '1-3 dagen', 'confidence': 'high', 'source': 'policy', 'ts': 'x'})
    res = server._wtl_discover(['dk'])
    assert res['added'] == [] and [r['domain'] for r in res['rejected']] == ['newshop.dk']
    extra = json.load(open(tmp_path / 'extra.json')) if (tmp_path / 'extra.json').exists() else []
    assert extra == []
    seen = json.load(open(tmp_path / 'seen.json'))
    assert seen['newshop.dk']['reason'] == 'merk/eigen voorraad'


def test_dead_store_is_removed_after_the_life_check(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path)
    monkeypatch.setattr(server, '_similarweb_bulk',
                        lambda hosts: {h: {'total_visits': 12, 'shares': {}, 'ts': 'x'} for h in hosts})
    jid = server._job_new('wtl_discover', 'wtl')
    res = server._wtl_discover(['dk'], jid=jid)
    assert res['added'] == []
    assert [g['domain'] for g in res['gated']] == ['newshop.dk']
    assert json.load(open(tmp_path / 'extra.json')) == []
    assert server._JOBS[jid]['live']['found'][0]['status'] == 'gated'


def test_unknown_traffic_is_allowed(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path)
    monkeypatch.setattr(server, '_similarweb_bulk', lambda hosts: {})
    res = server._wtl_discover(['dk'])
    assert [a['domain'] for a in res['added']] == ['newshop.dk']
    assert res['added'][0]['traffic_unknown'] is True
