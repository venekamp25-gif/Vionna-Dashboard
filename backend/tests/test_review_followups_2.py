# -*- coding: utf-8 -*-
"""Second round of review follow-ups (findings not covered by #54)."""
import pytest

import server


# ── scans keep unrecognised products; only NAMED non-fashion is dropped ───
def test_scan_keeps_other_and_drops_only_named_non_fashion(monkeypatch):
    handles = ['livia', 'maeve', 'lipstick', 'candle']
    html = ''.join(f'<a href="/products/{h}">x</a>' for h in handles)

    class R:
        status_code = 200
        text = html
        headers = {}

    prods = {'livia': {'title': 'Livia', 'product_type': ''},
             'maeve': {'title': 'Maeve', 'product_type': ''},
             'lipstick': {'title': 'Shade Shifter Lipstick', 'product_type': 'Læbestift'},
             'candle': {'title': 'Scented candle', 'product_type': ''}}
    monkeypatch.setattr(server, '_scrape_get', lambda url, timeout=15, **kw: R())
    monkeypatch.setattr(server, '_bs_prod_json', lambda host, handle: (prods[handle], True))
    monkeypatch.setattr(server, '_bs_prod_cache_save', lambda: None)
    payload, blocked = server._bs_scan('names.dk')
    assert blocked is None
    assert [p['title'] for p in payload['products']] == ['Livia', 'Maeve']   # 'other' stays
    assert payload['dropped'] == {'beauty': 1, 'home': 1}


# ── vocabulary, craft, kids, merch tags, sport, haut, junk, homonyms ───────
@pytest.mark.parametrize('title,ptype,tags,expected', [
    ('Skjorte hvid', '', '', 'top'),
    ('Trøje strib', '', '', 'top'),
    ('Chemise en lin', '', '', 'top'),
    ('Polo côtelé', '', '', 'top'),
    ('Corset top', '', '', 'top'),
    ('Sweatpants grey', '', '', 'pants'),
    ('Jeggings', '', '', 'pants'),
    ('Survêtement femme', '', '', 'pants'),
    ('Waistcoat wool', '', '', 'outerwear'),
    ('Bolero', '', '', 'outerwear'),
    ('Dungarees denim', '', '', 'jumpsuit'),
    ('Kaftan print', '', '', 'dress'),
    ('Strikkeopskrift til cardigan', '', '', 'craft'),        # yarn shop, not knitwear
    ('Knitting needles 4mm', '', '', 'craft'),
    ('Pelote de laine', '', '', 'craft'),
    ('Pull en laine', '', '', 'knitwear'),                    # wool sweater IS knitwear
    ('Crochet top', '', '', 'top'),
    ('Hæklet top', '', '', 'top'),
    ('Baby tee white', '', '', 'top'),                        # was: kids
    ('It Girl Dress', '', '', 'dress'),                       # was: kids
    ('Girls dress 4-6y', '', '', 'kids'),
    ('Little girl dress', '', '', 'kids'),
    ('Diffuser oil', '', 'New In', 'home'),                   # tag 'New In' ≠ clothing
    ('Mystery item', '', 'nyheder', 'other'),
    ('Talon haut noir', '', '', 'shoes'),                     # 'haut' in 'talon haut' ≠ a top
    ('Haut en soie', '', '', 'top'),
    ('Pointed-tip boots', '', '', 'shoes'),
    ('Storage basket rattan', '', '', 'home'),
    ('Pendant lamp brass', '', '', 'home'),
    ('Ring light 10 inch', '', '', 'home'),
    ('Oven gloves', '', '', 'home'),
    ('Coat rack oak', '', '', 'home'),
    ('Shower cap', '', '', 'home'),
])
def test_bucketer_round_two(title, ptype, tags, expected):
    assert server._bs_category(title, ptype, tags) == expected


def test_junk_regex_no_longer_eats_tip():
    assert not server._BS_JUNK_RE.search('Pointed-tip boots')
    assert not server._BS_JUNK_RE.search('Metal tip belt')
    assert server._BS_JUNK_RE.search('Tip jar')


def test_activewear_store_is_not_womenswear():
    prods = [{'title': t, 'product_type': '', 'tags': []} for t in
             ('Yoga leggings', 'Sports bra', 'Golf skirt', 'Running shorts', 'Training top',
              'Tennis dress', 'Gym leggings', 'Yoga top', 'Cycling shorts', 'Padel skirt')]
    prof = server._niche_profile(prods)
    assert prof['activewear_share'] >= 0.9
    status, reason = server._niche_verdict(prof)
    assert status == 'no' and 'activewear' in reason
    assert server._niche_kind_from_profile(prof) == 'sport'


def test_a_golf_skirt_in_a_fashion_store_is_still_a_skirt():
    prods = [{'title': t, 'product_type': '', 'tags': []} for t in
             ('Sommerkjole', 'Maxi dress', 'Blouse', 'Golf skirt', 'Jeans wide', 'Trench coat',
              'Cardigan', 'Sneakers', 'Silk top', 'Midi skirt')]
    prof = server._niche_profile(prods)
    assert prof['buckets'].get('skirt') == 2 and prof['activewear_share'] == 0.1
    assert server._niche_verdict(prof)[0] == 'yes'


# ── products.json fetch: public hosts only, redirect + size checked ───────
def test_public_host_guard(monkeypatch):
    import socket
    assert not server._public_host_ok('localhost')
    assert not server._public_host_ok('127.0.0.1')
    assert not server._public_host_ok('169.254.169.254')
    assert not server._public_host_ok('shop')
    assert not server._public_host_ok('bad_host.dk')
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *a, **k: [(None, None, None, None, ('10.0.0.5', 443))])
    assert not server._public_host_ok('internal.nip.io')
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *a, **k: [(None, None, None, None, ('93.184.216.34', 443))])
    assert server._public_host_ok('shop.dk')


def test_products_sample_refuses_private_redirect_and_huge_body(monkeypatch):
    monkeypatch.setattr(server, '_public_host_ok', lambda d: True)

    class R:
        status_code = 200
        url = 'https://elsewhere.example/products.json'
        content = b'{}'

        def json(self):
            return {'products': []}
    monkeypatch.setattr(server, '_scrape_get', lambda url, timeout=12, **kw: R())
    prods, http, err = server._gd_products_sample('shop.dk')
    assert prods is None and err.startswith('redirected to')

    class Big(R):
        url = 'https://shop.dk/products.json'
        content = b'x' * (server._GD_MAX_BODY + 1)
    monkeypatch.setattr(server, '_scrape_get', lambda url, timeout=12, **kw: Big())
    prods, http, err = server._gd_products_sample('shop.dk')
    assert prods is None and err == 'body too large'

    monkeypatch.setattr(server, '_public_host_ok', lambda d: False)
    prods, http, err = server._gd_products_sample('127.0.0.1')
    assert prods is None and http == 404 and 'private' in err


# ── accessory prompts: key 13 matches what is uploaded; garment wins ──────
def test_key_13_describes_the_product_shot():
    for tpl in (server.NANO_BANANA_PROMPTS_ACCESSORY[13], server.NANO_BANANA_PROMPTS_BAGS[13]):
        assert 'styled product shot' in tpl and 'model wearing' not in tpl and 'model carrying' not in tpl


@pytest.mark.parametrize('pt,cat', [
    ('dress with belt', 'garment'), ('coat with detachable belt', 'garment'), ('jumper with scarf', 'garment'),
    ('tie belt dress', 'garment'), ('scarf neck top', 'garment'), ('robe col bijou', 'garment'),
    ('toe cap boots', 'shoes'), ('dress shoes', 'shoes'), ('chain belt', 'accessory'), ('belt bag', 'bag'),
])
def test_garment_word_wins_over_accessory_word(pt, cat):
    assert server._nb_category(pt) == cat
