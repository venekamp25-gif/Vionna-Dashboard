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
    'newshop.dk': (_resp_products(30, 'Sommerkjole', 'Kjoler'), 200, None),
    'homeshop.dk': (_resp_products(30, 'Duftlys', 'Home'), 200, None),
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
    monkeypatch.setattr(server, '_gd_pick_queries', lambda m, st, n=24: [('kjole webshop', 30)])
    monkeypatch.setattr(server, '_dfs_competitor_domains',
                        lambda target, store, limit=100, offset=0: [
                            {'domain': 'newshop.dk'}, {'domain': 'known.dk'}, {'domain': 'homeshop.dk'},
                            {'domain': 'notshop.dk'}])
    monkeypatch.setattr(server, '_dfs_serp_results',
                        lambda q, store, depth=30: [{'url': 'https://serpshop.dk/x', 'type': 'organic'},
                                                    {'url': 'https://www.facebook.com/x', 'type': 'organic'}])
    monkeypatch.setattr(server, '_gd_is_local', lambda d, m: True)
    monkeypatch.setattr(server, '_gd_products_sample', lambda d, **kw: SAMPLES[d])
    # The niche check reads the store's own homepage words (bug #62) — keep the
    # suite offline; an empty hint means 'the store does not say', as before.
    monkeypatch.setattr(server, '_gd_homepage_hint', lambda d, **kw: '')
    monkeypatch.setattr(server, '_wtl_classify_store', classify or (lambda d: {
        'label': 'Dropshipper', 'detail': '', 'confidence': 'high', 'source': 'policy',
        'ts': datetime.datetime.utcnow().isoformat() + 'Z'}))
    # The gate must never trigger a bestseller scan (that was the 21-request
    # check per candidate). Make it explode if it does.
    monkeypatch.setattr(server, '_bs_scan_cached', lambda *a, **k: (_ for _ in ()).throw(AssertionError('scan in gate')))
    monkeypatch.setattr(server, '_wtl_catalog_overlap', lambda d: (_ for _ in ()).throw(AssertionError('overlap scan in gate')))
    monkeypatch.setattr(server, '_similarweb_bulk',
                        lambda hosts: {h: {'total_visits': 12000, 'shares': {'DK': 1.0}, 'ts': 'x'} for h in hosts})
    # A real catalogue (60+ products) — asked with ONE extra products.json page.
    monkeypatch.setattr(server, '_gd_catalogue_at_least', lambda d, n, **kw: True)
    monkeypatch.setattr(server, '_GD_TRAFFIC_BATCH_S', 0.05)
    import shipping_check
    monkeypatch.setattr(shipping_check, 'looks_like_brand', lambda d: (False, []))


def test_pipeline_end_to_end(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path)
    jid = server._job_new('wtl_discover', 'wtl')
    res = server._wtl_discover(['dk'], jid=jid)

    assert [a['domain'] for a in res['added']] == ['newshop.dk']
    assert res['added'][0]['status'] == 'added' and res['added'][0]['verdict'] == 'Dropshipper'
    reasons = {s['domain']: s['reason'] for s in res['skipped']}
    assert reasons['homeshop.dk'].startswith('not womenswear (home')
    assert reasons['serpshop.dk'].startswith('check failed')
    assert reasons['notshop.dk'] == 'not Shopify'
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
    assert live['found'][0]['status'] == 'added' and live['found'][0]['visits'] == 12000
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
    assert found[0]['status'] in ('checking_traffic', 'checking')   # shown while the gates still run
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
    assert seen['newshop.dk']['reason'] == 'brand / own stock'
    assert server._gd_seen_fresh(seen, 'newshop.dk')
    # entries written by the previous (Dutch) version keep their long memory
    seen['legacy.dk'] = {'reason': 'merk/eigen voorraad', 'market': 'dk', 'ts': seen['newshop.dk']['ts']}
    assert server._gd_seen_fresh(seen, 'legacy.dk')


def test_a_store_with_little_traffic_is_never_added(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path)
    monkeypatch.setattr(server, '_similarweb_bulk',
                        lambda hosts: {h: {'total_visits': 1700, 'shares': {}, 'ts': 'x'} for h in hosts})
    monkeypatch.setattr(server, '_wtl_classify_store',
                        lambda d: (_ for _ in ()).throw(AssertionError('dropship check on a small store')))
    jid = server._job_new('wtl_discover', 'wtl')
    res = server._wtl_discover(['dk'], jid=jid)
    assert res['added'] == []
    assert [g['domain'] for g in res['gated']] == ['newshop.dk']
    assert 'too little traffic (1,700 visits/month' in res['gated'][0]['reason']
    assert not (tmp_path / 'extra.json').exists() or json.load(open(tmp_path / 'extra.json')) == []
    assert server._JOBS[jid]['live']['found'][0]['status'] == 'gated'
    seen = json.load(open(tmp_path / 'seen.json'))
    assert seen['newshop.dk']['reason'] == 'too little traffic'


def test_serp_is_read_at_the_depth_the_rotation_picked(monkeypatch, tmp_path):
    """bug #63: the run hardcoded depth 30, so the deeper pages the rotation
    hands out never reached DataForSEO and every repeat query re-read page 1."""
    _setup(monkeypatch, tmp_path)
    monkeypatch.setattr(server, '_gd_pick_queries', lambda m, st, n=24: [('kjole webshop', 200)])
    asked = []

    def _serp(q, store, depth=30):
        asked.append((q, store, depth))
        return []
    monkeypatch.setattr(server, '_dfs_serp_results', _serp)
    server._wtl_discover(['dk'])
    assert asked == [('kjole webshop', 'dk', 200)]


def test_a_store_unknown_to_similarweb_is_not_added(monkeypatch, tmp_path):
    """venek 2026-09-29: 'very low visits a month if they even have any'."""
    _setup(monkeypatch, tmp_path)
    monkeypatch.setattr(server, '_similarweb_bulk',
                        lambda hosts: {h: {'total_visits': 0, 'shares': {}, 'ts': 'x'} for h in hosts})
    res = server._wtl_discover(['dk'])
    assert res['added'] == []
    assert res['gated'][0]['reason'] == 'no measurable traffic (unknown to SimilarWeb)'
    seen = json.load(open(tmp_path / 'seen.json'))
    assert seen['newshop.dk']['reason'] == 'no measurable traffic' and server._gd_seen_fresh(seen, 'newshop.dk')


def test_a_failed_similarweb_run_is_not_a_verdict(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path)
    monkeypatch.setattr(server, '_similarweb_bulk', lambda hosts: {})
    res = server._wtl_discover(['dk'])
    assert res['added'] == [] and res['gated'][0]['reason'] == 'traffic check failed — next run'
    seen = json.load(open(tmp_path / 'seen.json'))
    two_days = (datetime.datetime.utcnow() - datetime.timedelta(days=2)).isoformat() + 'Z'
    seen['newshop.dk']['ts'] = two_days
    assert not server._gd_seen_fresh(seen, 'newshop.dk')        # retried after a day


def test_a_small_catalogue_is_dropped_before_any_other_check(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path)
    samples = dict(SAMPLES)
    samples['newshop.dk'] = (_resp_products(12, 'Sommerkjole', 'Kjoler'), 200, None)
    monkeypatch.setattr(server, '_gd_products_sample', lambda d, **kw: samples[d])
    monkeypatch.setattr(server, '_gd_is_local', lambda d, m: (_ for _ in ()).throw(AssertionError('locality asked')))
    res = server._wtl_discover(['dk'])
    reasons = {x['domain']: x['reason'] for x in res['skipped']}
    assert reasons['newshop.dk'] == 'too few products (12)'
    # a full first page but under 60 in total: the one extra page says so
    samples['newshop.dk'] = (_resp_products(30, 'Sommerkjole', 'Kjoler'), 200, None)
    monkeypatch.setattr(server, '_gd_catalogue_at_least', lambda d, n, **kw: False)
    res = server._wtl_discover(['dk'], ignore_seen=True)
    reasons = {x['domain']: x['reason'] for x in res['skipped']}
    assert reasons['newshop.dk'] == 'too few products (under 60)'
    # an unreadable second page is a storing, not a verdict
    monkeypatch.setattr(server, '_gd_catalogue_at_least', lambda d, n, **kw: None)
    res = server._wtl_discover(['dk'], ignore_seen=True)
    reasons = {x['domain']: x['reason'] for x in res['skipped']}
    assert reasons['newshop.dk'].startswith('check failed')


def test_cached_traffic_skips_the_similarweb_run(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path)
    now = datetime.datetime.utcnow().isoformat() + 'Z'
    monkeypatch.setattr(server, '_wtl_traffic_load', lambda: {'newshop.dk': {'total_visits': 40000, 'shares': {}, 'ts': now}})
    monkeypatch.setattr(server, '_similarweb_bulk', lambda hosts: (_ for _ in ()).throw(AssertionError('paid run for a cached host')))
    res = server._wtl_discover(['dk'])
    assert [a['domain'] for a in res['added']] == ['newshop.dk'] and res['added'][0]['visits'] == 40000


def test_catalogue_at_least_reads_the_page_that_holds_product_n(monkeypatch):
    asked = []

    class R:
        status_code = 200

        def __init__(self, n):
            self.n = n

        def json(self):
            return {'products': [{}] * self.n}

    def get(url, timeout=12):
        asked.append(url)
        return R(30 if 'page=2' in url else 0)
    monkeypatch.setattr(server, '_scrape_get', get)
    assert server._gd_catalogue_at_least('x.dk', 60) is True
    assert asked == ['https://x.dk/products.json?limit=30&page=2']
    monkeypatch.setattr(server, '_scrape_get', lambda url, timeout=12: R(29))
    assert server._gd_catalogue_at_least('x.dk', 60) is False
    monkeypatch.setattr(server, '_scrape_get', lambda url, timeout=12: type('E', (), {'status_code': 429})())
    assert server._gd_catalogue_at_least('x.dk', 60) is None


def test_similarweb_answer_for_a_www_host_is_not_a_fake_zero(monkeypatch):
    """The actor reports 'boheme-infinity.com'; we asked for the www-host."""
    monkeypatch.setenv('APIFY_TOKEN', 'x')

    class R:
        def __init__(self, body, status=200):
            self._b, self.status_code = body, status

        def json(self):
            return self._b

    def post(url, params=None, json=None, timeout=None):
        return R({'data': {'id': 'r', 'defaultDatasetId': 'ds', 'status': 'SUCCEEDED'}}, 201)

    def get(url, params=None, timeout=None):
        return R([{'domain': 'boheme-infinity.com', 'totalVisits': 41000,
                   'countryShare': [{'country': 'fr', 'share': 0.9}]}])
    monkeypatch.setattr(server.req, 'post', post)
    monkeypatch.setattr(server.req, 'get', get)
    out = server._similarweb_bulk(['www.boheme-infinity.com', 'www.unknown-shop.fr'])
    assert out['www.boheme-infinity.com']['total_visits'] == 41000
    assert out['www.boheme-infinity.com']['shares'] == {'FR': 0.9}
    assert out['www.unknown-shop.fr']['total_visits'] == 0


def test_a_cached_www_zero_falls_back_to_the_bare_domain():
    cache = {'www.x.fr': {'total_visits': 0, 'shares': {}, 'ts': 't'},
             'x.fr': {'total_visits': 30000, 'shares': {'FR': 1.0}, 'ts': 't'}}
    assert server._wtl_traffic_lookup(cache, 'www.x.fr')['total_visits'] == 30000
    assert server._wtl_traffic_lookup(cache, 'x.fr')['total_visits'] == 30000
    assert server._wtl_traffic_lookup({'www.y.fr': {'total_visits': 0}}, 'www.y.fr') == {'total_visits': 0}
    assert server._wtl_traffic_lookup({}, 'www.z.fr') is None
