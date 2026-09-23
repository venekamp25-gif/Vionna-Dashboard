# -*- coding: utf-8 -*-
"""Follow-ups from the adversarial review of #52/#53 (2026-09-15).

Each test names the defect it pins; all of them were reproduced against the
merged code before the fix.
"""
import datetime
import threading

import pytest

import server


# ── bucketer: exclusion rules must not fire on fashion vocabulary ─────────
@pytest.mark.parametrize('title,ptype,expected', [
    ('Cable knit sweater', '', 'knitwear'),        # was: tech ('cable')
    ('Kabelstrik cardigan', '', 'knitwear'),       # was: tech ('kabel')
    ('Blush pink midi dress', '', 'dress'),        # was: beauty ('blush')
    ('Robe coquelicot', '', 'dress'),              # was: tech ('coque')
    ('Coquette blouse', '', 'top'),                # was: tech
    ('Cuir vernis loafers', '', 'shoes'),          # was: beauty ('vernis')
    ('Babyblå strikbluse', '', 'knitwear'),        # was: kids (baby + colour)
    ('Vauvansininen mekko', '', 'dress'),          # was: kids
    ('Baby pink satin dress', 'Dresses', 'dress'),
    ('Bøjle-bh sort', '', 'lingerie'),             # was: home ('bøjle' = hanger)
    ('Combinaison de ski', '', 'sport'),           # was: jumpsuit
    ('Guldring med sten', '', 'jewelry'),          # was: other
    ('Sølvring', 'Smykker', 'jewelry'),
    ('Hair claw clip', '', 'accessory'),           # was: other
    ('AirPods case', '', 'tech'),                  # was: other
    ('Phone case iPhone 15', '', 'tech'),
    ('Coque iPhone 15', '', 'tech'),
    ('USB-C charging cable', '', 'tech'),
    ('Ladekabel', '', 'tech'),
    ('Blush brush', '', 'beauty'),
    ('Vernis à ongles rouge', '', 'beauty'),
    ('Tøjbøjler i træ', '', 'home'),
    ('Robe bébé 6 mois', '', 'kids'),
])
def test_bucketer_false_positives_fixed(title, ptype, expected):
    assert server._bs_category(title, ptype, '') == expected


# ── niche: unknown ≠ no; name-only catalogues go to the tie-break ─────────
def test_empty_catalogue_is_unknown_not_no():
    assert server._niche_verdict(server._niche_profile([]))[0] == 'unknown'


def test_name_only_catalogue_is_ambiguous(monkeypatch, tmp_path):
    prods = [{'title': n, 'product_type': '', 'tags': []}
             for n in ('Livia', 'Maeve', 'Adele', 'Chloé', 'Hilde', 'Sabine', 'Daphne', 'Elise')]
    prof = server._niche_profile(prods)
    status, reason = server._niche_verdict(prof)
    assert status == 'ambiguous' and 'unrecognised' in reason
    # the tie-break gets the homepage's own words
    seen = {}
    monkeypatch.setattr(server, 'WTL_NICHE_PATH', str(tmp_path / 'niche.json'))
    monkeypatch.setattr(server, '_gd_homepage_hint', lambda d, **kw: 'Livia — dametøj online')
    monkeypatch.setattr(server, '_niche_llm',
                        lambda d, p, prof, hint='': (seen.setdefault('hint', hint), (True, 'womenswear'))[1])
    n = server._wtl_niche_check('names.dk', products=prods, http_status=200)
    assert n['status'] == 'yes' and seen['hint'] == 'Livia — dametøj online'


def test_empty_catalogue_check_is_transient(monkeypatch, tmp_path):
    monkeypatch.setattr(server, 'WTL_NICHE_PATH', str(tmp_path / 'niche.json'))
    n = server._wtl_niche_check('locked.dk', products=[], http_status=200)
    assert n['status'] == 'unknown'
    n['ts'] = (datetime.datetime.utcnow() - datetime.timedelta(days=2)).isoformat() + 'Z'
    assert not server._wtl_niche_fresh(n)


def test_cached_or_check_does_not_refetch(monkeypatch):
    fresh = {'status': 'yes', 'rules': server._WTL_NICHE_RULES,
             'ts': datetime.datetime.utcnow().isoformat() + 'Z'}
    monkeypatch.setattr(server, '_wtl_niche_load', lambda: {'known.dk': fresh})
    monkeypatch.setattr(server, '_wtl_niche_check', lambda d: (_ for _ in ()).throw(AssertionError('refetched')))
    assert server._wtl_niche_cached_or_check('www.known.dk') is fresh


def test_add_niche_rate_limit(monkeypatch):
    monkeypatch.setattr(server, '_wtl_niche_load', lambda: {})
    server._ADD_NICHE_WINDOW['ts'] = []
    allowed = [server._add_niche_allowed(f'x{i}.dk') for i in range(server._ADD_NICHE_PER_10MIN + 3)]
    assert allowed.count(True) == server._ADD_NICHE_PER_10MIN and allowed[-1] is False
    server._ADD_NICHE_WINDOW['ts'] = []


# ── discovery: transient locality, single-flight, cap before classify ─────
def test_is_local_returns_none_on_transient(monkeypatch):
    class R:
        status_code = 503
        text = ''
    monkeypatch.setattr(server, '_scrape_get', lambda url, timeout=10, **kw: R())
    assert server._gd_is_local('shop.com', 'dk') is None
    monkeypatch.setattr(server, '_scrape_get', lambda url, timeout=10, **kw: (_ for _ in ()).throw(TimeoutError()))
    assert server._gd_is_local('shop.com', 'dk') is None
    assert server._gd_is_local('shop.dk', 'dk') is True          # market TLD: no fetch
    assert server._gd_is_local('shop.se', 'dk') is False         # someone else's TLD


def test_discovery_is_single_flight(monkeypatch):
    assert server._WTL_DISCOVER_LOCK.acquire(blocking=False)
    try:
        res = server._wtl_discover(['dk'])
        assert 'already running' in res['error']
    finally:
        server._WTL_DISCOVER_LOCK.release()


def test_seen_ttl_keys_cover_english_and_legacy_dutch():
    for k in ('check failed', 'not Shopify', 'not local', 'not womenswear', 'too little traffic',
              'brand / own stock', 'check mislukt', 'geen Shopify', 'niet lokaal', 'geen damesmode',
              'onder de marktgrootte-lat', 'merk/eigen voorraad'):
        assert k in server._GD_SEEN_TTL_DAYS
    assert server._GD_SEEN_TTL_DAYS['check failed'] == 1


def test_pool_shutdown_helper_tolerates_old_python():
    class P:
        def __init__(self):
            self.calls = []

        def shutdown(self, wait=True, **kw):
            if kw:
                raise TypeError('unexpected keyword')
            self.calls.append(wait)
    p = P()
    server._pool_shutdown(p)
    assert p.calls == [False]


def test_verdict_put_is_serialised(monkeypatch, tmp_path):
    monkeypatch.setattr(server, 'WTL_VERDICTS_PATH', str(tmp_path / 'v.json'))
    errors = []

    def w(i):
        try:
            server._wtl_verdict_put(f'd{i}.dk', {'label': 'Dropshipper', 'i': i})
        except Exception as e:      # pragma: no cover
            errors.append(e)
    ts = [threading.Thread(target=w, args=(i,)) for i in range(20)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert not errors
    assert len(server._wtl_verdicts_load()) == 20     # no lost writes


def test_clean_status_is_per_call(monkeypatch):
    monkeypatch.setattr(server, 'ANTHROPIC_KEY', '')
    st = {}
    server._dfs_clean_keywords_llm([{'keyword': 'x'}], 'dk', status=st)
    assert st == {'ok': False, 'why': 'no Anthropic key'}


# ── accessory prompts: per-kind face / materials / finish ─────────────────
def test_ring_and_bracelet_have_their_own_framing():
    assert server._nb_accessory_kind('guldring') == 'ring'
    assert server._nb_accessory_kind('armbånd') == 'bracelet'
    assert 'hand' in server._nb_accessory_framing('ring')
    assert 'wrist' in server._nb_accessory_framing('bracelet')


def test_face_and_materials_follow_the_kind():
    p_belt = server._nb_render_prompt(2, 'belt', '')
    assert 'her face may be partly out of frame' in p_belt and 'face clearly visible' not in p_belt
    p_neck = server._nb_render_prompt(2, 'necklace', '')
    assert 'her face clearly visible' in p_neck
    p_scarf = server._nb_render_prompt(4, 'scarf', '')
    assert 'weave' in p_scarf and 'lenses' not in p_scarf and 'stones' not in p_scarf
    p_glasses = server._nb_render_prompt(14, 'sunglasses', 'tortoise')
    assert 'lenses' in p_glasses and 'buckle' not in p_glasses
    p_scarf_colour = server._nb_render_prompt(11, 'scarf', 'red')
    assert 'tortoise' not in p_scarf_colour and 'exact shade' in p_scarf_colour


def test_noise_keeps_ring_spun_tees_and_toe_ring_sandals_out_of_the_ring_set():
    assert server._nb_category('ring-spun cotton tee') == 'garment'
    assert server._nb_category('toe ring sandals') == 'shoes'
    assert server._nb_category('d-ring belt') == 'accessory' and server._nb_accessory_kind('d-ring belt') == 'belt'
    assert server._nb_category('chain strap bag') == 'bag'


def test_winter_accessories_get_the_cool_weather_scene():
    prompt, _ = server._lifestyle_prompt('beanie', season='summer')
    assert 'cool-weather' in prompt
    prompt, _ = server._lifestyle_prompt('gloves', season='summer')
    assert 'cool-weather' in prompt
