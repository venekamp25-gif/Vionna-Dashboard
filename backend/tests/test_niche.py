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
    monkeypatch.setattr(server, '_gd_homepage_hint', lambda d, **kw: 'Mixed webshop')  # no HTTP
    mixed = _prods(5, 'Maxi dress', 'Dresses') + _prods(5, 'Candle', 'Home')

    monkeypatch.setattr(server, '_niche_llm', lambda d, p, prof, hint='': (False, 'home'))
    n = server._wtl_niche_check('mixed.dk', products=mixed, http_status=200)
    assert (n['status'], n['kind'], n['source']) == ('no', 'home', 'llm')

    monkeypatch.setattr(server, '_niche_llm', lambda d, p, prof, hint='': (True, 'womenswear'))
    n = server._wtl_niche_check('mixed2.dk', products=mixed, http_status=200)
    assert (n['status'], n['kind']) == ('yes', 'womenswear') and not n.get('unverified')

    # No verdict obtainable → let through, flagged (warn, never block) — and
    # re-tried tomorrow instead of pinned for 30 days.
    monkeypatch.setattr(server, '_niche_llm', lambda d, p, prof, hint='': (None, None))
    n = server._wtl_niche_check('mixed3.dk', products=mixed, http_status=200)
    assert n['status'] == 'yes' and n['unverified'] is True
    assert server._wtl_niche_fresh(n)
    n['ts'] = _ago(2)
    assert not server._wtl_niche_fresh(n)

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
    yes = {'status': 'yes', 'rules': server._WTL_NICHE_RULES, 'ts': _ago(2)}
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


# ── bug #62: the store's own words decide who it dresses ────────────────────
# Product titles almost never name the audience: 'Skjorte', 'Strik' and
# 'Sneakers' sit in a men's, a kids' and a women's shop alike. Measured on the
# live DK list (2026-09-23) skjorten.dk ("Herretøj online … tøj til mænd"),
# herrernesmagasin.dk and halokids.dk ("Tøj til Børn") all carried a green
# "womenswear" chip in the stores tab. The homepage says it plainly.

MENS_CATALOGUE = _prods(15, 'Strik V-Neck Navy - Modern fit', 'STRIK') + \
                 _prods(10, 'Sand Hørskjorte - Summer', 'SKJORTE')
KIDS_CATALOGUE = _prods(12, 'Sneakers - Glam Racer', 'Sneakers') + _prods(8, 'Jakke', 'Jakke')


def test_store_audience_reads_the_stores_own_words():
    a = server._store_audience
    assert a('skjorten.dk', 'Herretøj online | Skjorter og tøj til mænd | Skjorten.dk') == 'menswear'
    assert a('herrernesmagasin.dk', 'Herrernes Magasin by David K') == 'menswear'
    assert a('legends.dk', 'Legends - Shop Menswear') == 'menswear'
    assert a('boutique.fr', 'Vêtements homme | chemises pour hommes') == 'menswear'
    assert a('halokids.dk', 'Tøj til Børn | Køb børnetøj fra lækre brands') == 'kids'
    assert a('pikku.fi', 'Lasten vaatteet verkkokaupasta') == 'kids'
    # Womenswear stores are untouched — including the ones that say nothing.
    assert a('basicapparel.dk', 'Stort udvalg af økologisk kvalitetstøj til kvinder') is None
    assert a('aya-s.dk', 'Essentials designed for the modern woman') is None
    assert a('cyycle.dk', 'Cyycle') is None
    assert a('shop.dk', '') is None
    # A store that dresses BOTH is not a rejection (wupp.dk, measured).
    assert a('wupp.dk', 'Shop tøj til mænd og kvinder | dametøj, herretøj') is None
    # 'men' is Danish for 'but' — never a men's signal on its own.
    assert a('kjoleshop.dk', 'Vi sender i dag, men kun før kl. 15') is None


def test_menswear_store_is_no_even_when_every_product_reads_as_womenswear(monkeypatch, tmp_path):
    monkeypatch.setattr(server, 'WTL_NICHE_PATH', str(tmp_path / 'niche.json'))
    monkeypatch.setattr(server, '_niche_llm',
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError('llm asked')))
    # The bucketer alone calls this womenswear — that is exactly the bug.
    assert server._niche_verdict(server._niche_profile(MENS_CATALOGUE))[0] == 'yes'

    monkeypatch.setattr(server, '_gd_homepage_hint',
                        lambda d, **kw: 'Herretøj online | Skjorter og tøj til mænd')
    n = server._wtl_niche_check('skjorten.dk', products=MENS_CATALOGUE, http_status=200)
    assert (n['status'], n['kind'], n['source']) == ('no', 'menswear', 'audience')
    # The product numbers stay in the reason — the chip must say WHY it flipped.
    assert "men's store" in n['reason'] and '100% womenswear' in n['reason']


def test_kids_store_is_no(monkeypatch, tmp_path):
    monkeypatch.setattr(server, 'WTL_NICHE_PATH', str(tmp_path / 'niche.json'))
    monkeypatch.setattr(server, '_gd_homepage_hint', lambda d, **kw: 'Tøj til Børn | børnetøj')
    assert server._niche_verdict(server._niche_profile(KIDS_CATALOGUE))[0] == 'yes'
    n = server._wtl_niche_check('halokids.dk', products=KIDS_CATALOGUE, http_status=200)
    assert (n['status'], n['kind'], n['source']) == ('no', 'kids', 'audience')


def test_a_womenswear_store_still_passes(monkeypatch, tmp_path):
    """The gate may only ever take stores OUT — never block a real source."""
    monkeypatch.setattr(server, 'WTL_NICHE_PATH', str(tmp_path / 'niche.json'))
    monkeypatch.setattr(server, '_gd_homepage_hint', lambda d, **kw: 'Kvalitetstøj til kvinder')
    n = server._wtl_niche_check('basicapparel.dk',
                                products=_prods(20, 'Sommerkjole', 'Kjoler'), http_status=200)
    assert (n['status'], n['kind'], n['source']) == ('yes', 'womenswear', 'rules')

    # Homepage unreadable → no signal → the product rules keep the last word.
    monkeypatch.setattr(server, '_gd_homepage_hint', lambda d, **kw: '')
    n = server._wtl_niche_check('quiet.dk', products=_prods(20, 'Kjole', 'Kjoler'), http_status=200)
    assert n['status'] == 'yes'


def test_audience_beats_the_llm_on_an_ambiguous_menswear_store(monkeypatch, tmp_path):
    """herrernesmagasin.dk landed in the ambiguous zone and the LLM said 'yes'.
    A deterministic 'this shop dresses men' outranks that guess."""
    monkeypatch.setattr(server, 'WTL_NICHE_PATH', str(tmp_path / 'niche.json'))
    monkeypatch.setattr(server, '_gd_homepage_hint', lambda d, **kw: 'Herrernes Magasin')
    monkeypatch.setattr(server, '_niche_llm',
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError('llm asked')))
    ambiguous = _prods(5, 'Maxi dress', 'Dresses') + _prods(5, 'Candle', 'Home')
    assert server._niche_verdict(server._niche_profile(ambiguous))[0] == 'ambiguous'
    n = server._wtl_niche_check('herrernesmagasin.dk', products=ambiguous, http_status=200)
    assert (n['status'], n['kind'], n['source']) == ('no', 'menswear', 'audience')


def test_a_yes_from_an_older_ruleset_is_rechecked():
    """Without this the 453 stores already cached as 'yes' would keep their
    wrong chip for 30 days and the fix would be invisible."""
    old = {'status': 'yes', 'ts': _ago(1)}                      # written before the gate
    assert not server._wtl_niche_fresh(old)
    new = dict(old, rules=server._WTL_NICHE_RULES)
    assert server._wtl_niche_fresh(new)
    # A 'no' or an 'unknown' is untouched: the gate can only overturn a 'yes'.
    assert server._wtl_niche_fresh({'status': 'no', 'ts': _ago(1)})
    assert server._wtl_niche_fresh({'status': 'unknown', 'ts': _ago(0)})


# ── plan #11: unisex merch reads as 100% womenswear to the bucketer ─────────
# A graphic-tee shop sells nothing but tops, so the rules call it 100%
# womenswear, and the store-audience gate cannot help: such a shop names no
# audience at all, in neither its domain nor its <title>. Only whoever READS
# 'Warhammer 40k T-Shirt' sees it. So every rules-'yes' now goes past the LLM
# too, not just the ambiguous ones.
MERCH_CATALOGUE = _prods(12, 'Warhammer 40k T-Shirt Black', 'T-Shirts') + \
                  _prods(8, 'Dune Hoodie Oversized', 'Hoodies')
MERCH_HINT = 'Geek Store | film- en game-prints'


def test_a_rules_yes_is_read_by_the_llm_too(monkeypatch, tmp_path):
    monkeypatch.setattr(server, 'WTL_NICHE_PATH', str(tmp_path / 'niche.json'))
    monkeypatch.setattr(server, '_gd_homepage_hint', lambda d, **kw: MERCH_HINT)
    monkeypatch.setattr(server, 'ANTHROPIC_KEY', 'sk-test')   # an LLM IS available
    # The two gates before the LLM both wave this shop through — that is the bug.
    assert server._niche_verdict(server._niche_profile(MERCH_CATALOGUE))[0] == 'yes'
    assert server._store_audience('geekstore.dk', MERCH_HINT) is None

    seen = {}

    def fake_llm(d, p, prof, hint=''):
        seen['hint'] = hint
        return False, 'general'
    monkeypatch.setattr(server, '_niche_llm', fake_llm)
    n = server._wtl_niche_check('geekstore.dk', products=MERCH_CATALOGUE, http_status=200)
    assert (n['status'], n['kind'], n['source']) == ('no', 'general', 'llm')
    assert seen['hint'] == MERCH_HINT          # the homepage words go along


def test_a_confirmed_yes_keeps_its_30_day_verdict(monkeypatch, tmp_path):
    monkeypatch.setattr(server, 'WTL_NICHE_PATH', str(tmp_path / 'niche.json'))
    monkeypatch.setattr(server, '_gd_homepage_hint', lambda d, **kw: 'Kvalitetstøj til kvinder')
    monkeypatch.setattr(server, 'ANTHROPIC_KEY', 'sk-test')   # an LLM IS available
    monkeypatch.setattr(server, '_niche_llm', lambda *a, **k: (True, 'womenswear'))
    n = server._wtl_niche_check('basicapparel.dk',
                                products=_prods(20, 'Sommerkjole', 'Kjoler'), http_status=200)
    assert (n['status'], n['kind'], n['source']) == ('yes', 'womenswear', 'llm')
    assert not n.get('unverified')
    n['ts'] = _ago(2)
    assert server._wtl_niche_fresh(n)          # a real verdict lasts 30 days


def test_an_unanswered_yes_stays_yes_but_flagged(monkeypatch, tmp_path):
    """Warn, never block: a shop may not disappear because the LLM was down."""
    monkeypatch.setattr(server, 'WTL_NICHE_PATH', str(tmp_path / 'niche.json'))
    monkeypatch.setattr(server, '_gd_homepage_hint', lambda d, **kw: 'Shop')
    monkeypatch.setattr(server, 'ANTHROPIC_KEY', 'sk-test')   # an LLM IS available
    monkeypatch.setattr(server, '_niche_llm', lambda *a, **k: (None, None))
    n = server._wtl_niche_check('quiet.dk', products=_prods(20, 'Kjole', 'Kjoler'), http_status=200)
    assert (n['status'], n['kind']) == ('yes', 'womenswear')
    assert n['unverified'] is True and n['source'] == 'rules'
    n['ts'] = _ago(2)
    assert not server._wtl_niche_fresh(n)      # re-tried tomorrow, not pinned for 30 days


def test_without_an_llm_key_a_rules_yes_is_left_alone(monkeypatch, tmp_path):
    """No key is a missing CONFIG, not doubt about the store — flagging all 655
    stores 'unconfirmed' would make the flag meaningless."""
    monkeypatch.setattr(server, 'WTL_NICHE_PATH', str(tmp_path / 'niche.json'))
    monkeypatch.setattr(server, '_gd_homepage_hint', lambda d, **kw: 'Shop')
    monkeypatch.setattr(server, 'ANTHROPIC_KEY', None)
    monkeypatch.setattr(server, '_niche_llm',
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError('llm asked')))
    n = server._wtl_niche_check('quiet.dk', products=_prods(20, 'Kjole', 'Kjoler'), http_status=200)
    assert (n['status'], n['source']) == ('yes', 'rules') and not n.get('unverified')
