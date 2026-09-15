# -*- coding: utf-8 -*-
"""Niche verdict: is this a WOMEN'S FASHION store?

Until now the only 'fashion' check in the stores funnel was '>= 5 bestsellers
without a men/kids word'. That let intersport.dk, golfexperten.dk, songmics.fr
(furniture, with a green dropshipper chip) and finlayson.fi into the pool
(measured 2026-09-15). One products.json sample + the bucketer decides; the LLM
only breaks ties; a transient failure is 'unknown', never 'no'.
"""
import datetime
import json

import server


def _prods(n, title, ptype='', tags=None):
    return [{'title': f'{title} {i}', 'product_type': ptype, 'tags': tags or []} for i in range(n)]


def _ago(days):
    return (datetime.datetime.utcnow() - datetime.timedelta(days=days)).isoformat() + 'Z'


def test_profile_and_yes_verdict():
    prof = server._niche_profile(_prods(8, 'Sommerkjole', 'Kjoler') + _prods(2, 'Sneakers', 'Sko'))
    assert (prof['total'], prof['fashion'], prof['clothing']) == (10, 10, 8)
    status, reason = server._niche_verdict(prof)
    assert status == 'yes' and '80% clothing' in reason


def test_home_store_is_no_with_kind():
    prof = server._niche_profile(_prods(9, 'Scented candle', 'Home') + _prods(1, 'Vase'))
    status, _ = server._niche_verdict(prof)
    assert status == 'no'
    assert server._niche_kind_from_profile(prof) == 'home'


def test_jewelry_only_store_is_no_with_kind_jewelry():
    prof = server._niche_profile(_prods(12, 'Gold hoop earrings', 'Jewellery'))
    status, reason = server._niche_verdict(prof)
    assert status == 'no' and 'jewelry' in reason
    assert server._niche_kind_from_profile(prof) == 'jewelry'


def test_too_few_fashion_products_is_no():
    prof = server._niche_profile(_prods(3, 'Kjole', 'Kjoler') + _prods(1, 'Candle'))
    assert server._niche_verdict(prof)[0] == 'no'


def test_mixed_store_is_ambiguous():
    prof = server._niche_profile(_prods(5, 'Maxi dress', 'Dresses') + _prods(5, 'Candle', 'Home'))
    assert server._niche_verdict(prof)[0] == 'ambiguous'


def test_ambiguous_uses_the_llm_and_falls_open_on_no_answer(monkeypatch, tmp_path):
    monkeypatch.setattr(server, 'WTL_NICHE_PATH', str(tmp_path / 'niche.json'))
    mixed = _prods(5, 'Maxi dress', 'Dresses') + _prods(5, 'Candle', 'Home')

    monkeypatch.setattr(server, '_niche_llm', lambda d, p, prof: (False, 'home'))
    n = server._wtl_niche_check('mixed.dk', products=mixed, http_status=200)
    assert (n['status'], n['kind'], n['source']) == ('no', 'home', 'llm')

    monkeypatch.setattr(server, '_niche_llm', lambda d, p, prof: (True, 'womenswear'))
    n = server._wtl_niche_check('mixed2.dk', products=mixed, http_status=200)
    assert (n['status'], n['kind']) == ('yes', 'womenswear') and not n.get('unverified')

    # No verdict obtainable → let through, flagged (warn, never block).
    monkeypatch.setattr(server, '_niche_llm', lambda d, p, prof: (None, None))
    n = server._wtl_niche_check('mixed3.dk', products=mixed, http_status=200)
    assert n['status'] == 'yes' and n['unverified'] is True

    saved = json.load(open(tmp_path / 'niche.json', encoding='utf-8'))
    assert set(saved) == {'mixed.dk', 'mixed2.dk', 'mixed3.dk'}


def test_transient_failure_is_unknown_with_a_short_ttl(monkeypatch, tmp_path):
    monkeypatch.setattr(server, 'WTL_NICHE_PATH', str(tmp_path / 'niche.json'))
    monkeypatch.setattr(server, '_gd_products_sample', lambda d, **kw: (None, 503, 'HTTP 503'))
    n = server._wtl_niche_check('down.dk')
    assert n['status'] == 'unknown' and 'HTTP 503' in n['reason']
    assert server._wtl_niche_fresh(n)                      # today: don't hammer it
    n['ts'] = _ago(2)
    assert not server._wtl_niche_fresh(n)                  # 2 days later: try again
    yes = {'status': 'yes', 'ts': _ago(2)}
    assert server._wtl_niche_fresh(yes)                    # a real verdict lasts 30 days
    yes['ts'] = _ago(40)
    assert not server._wtl_niche_fresh(yes)


def test_public_shape_hides_the_bucket_dump():
    pub = server._wtl_niche_public({'status': 'no', 'kind': 'home', 'reason': 'x', 'fashion_share': 0.1,
                                    'buckets': {'home': 9}, 'ts': _ago(0)})
    assert pub == {'status': 'no', 'kind': 'home', 'reason': 'x', 'fashion_share': 0.1,
                   'unverified': False, 'fresh': True}
    assert server._wtl_niche_public(None) is None


def test_niche_missing_checks_unmarked_stores_first(monkeypatch):
    monkeypatch.setattr(server, '_wtl_niche_load', lambda: {})
    monkeypatch.setattr(server, '_wtl_marks_load', lambda: {'a.dk': {'mark': 'skip'}})
    order = []

    def fake_check(d):
        order.append(d)
        return {'status': 'yes'}
    monkeypatch.setattr(server, '_wtl_niche_check', fake_check)
    res = server._wtl_niche_missing(['a.dk', 'b.dk', 'c.dk'], cap=2, workers=1)
    assert order == ['b.dk', 'c.dk']
    assert res == {'checked': 2, 'due': 3, 'yes': 2, 'no': 0, 'unknown': 0}
