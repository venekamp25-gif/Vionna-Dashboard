# -*- coding: utf-8 -*-
"""The bestseller bucketer must NAME non-fashion, never count it as womenswear.

Measured live on 2026-09-15: mollyogmy.dk's top-20 held hair elastics (#1-#3),
a lipstick, a self-tanner and tights — all bucketed 'other' and counted as
womenswear bestsellers. kekale.fi: 11 of 15 landed in 'top' because the generic
product_type 'Vaatteet' contains the substring 'tee', and 'naisten farkut'
(women's jeans) fell to 'other'. The old matcher had no word boundaries
('heel' in 'wheel', 'top' in 'laptop') and no non-fashion buckets at all.
"""
import pytest

import server

CASES = [
    # (title, product_type, tags, expected)
    # -- the live mollyogmy.dk / kekale.fi cases --
    ('Black Colour - Bckally Elastic 6722 - Brown', 'Hårelastikker', '', 'beauty'),
    ('Sandstone x Molly & My - Shade Shifter Lipstick', 'Læbestift', '', 'beauty'),
    ('TanCan - Valentin Beautyline', 'Selvbruner', '', 'beauty'),
    ('Lykkepose - bestillingsvare (kan ikke returneres)', 'Goodie Bags', '', 'bundle'),
    ('Oroblu - Club 15 Sheer Tights - Sun', 'Strømpebukser', '', 'hosiery'),
    ('Mellow Moon - Bogstav Ørering Forgyldt med sten', 'Øreringe', '', 'jewelry'),
    ('Dr. Martens naisten nauhalliset nilkkurit, 1460 Pascal Virginia', 'Vaatteet', '', 'shoes'),
    ('New Balance Unisex lenkkarit 530 Hopea', 'Vaatteet', '', 'men'),
    ('Mac naisten farkut Dream Wide Wonder Light', 'Vaatteet', '', 'pants'),
    ('Mac naisten farkut Dream Skinny D999', 'Farkut', '', 'pants'),
    ('Inwear naisten housut GincetteIW Pants, musta', 'Vaatteet', '', 'pants'),
    ('Marimekko huppari', 'Vaatteet', '', 'top'),            # brand contains 'mekko'
    # -- word boundaries --
    ('Laptop Stand Aluminium', '', '', 'tech'),
    ('Coffee Grinder', '', '', 'food'),
    ('Car Seatbelt Cover', '', '', 'other'),
    ('Aroma diffuser', '', '', 'home'),
    ('Wireless earbuds', '', '', 'tech'),
    ('Wine glasses set of 4', '', '', 'home'),
    ('Plaid Midi Skirt', '', '', 'skirt'),
    ('Baby Blue Satin Dress', 'Dresses', '', 'dress'),
    ('Cap sleeve blouse', 'Tops', '', 'top'),
    ('Slip dress satin', '', '', 'dress'),
    ('Silk slip', '', '', 'lingerie'),
    ('Body lotion vanilla', '', '', 'beauty'),
    # -- audiences --
    ('Pige kjole 4-6 år', '', '', 'kids'),
    ('Robe fille 8 ans', 'Robes', '', 'kids'),
    ('Chemise homme lin', '', '', 'men'),
    ('Dog sweater fleece', '', '', 'pet'),
    # -- DK / FR / FI vocabulary --
    ('Sommerkjole med blomster', 'Kjoler', 'nyheder', 'dress'),
    ('Robe midi fleurie', 'Robes', '', 'dress'),
    ('Pantalon large femme', 'Pantalons', '', 'pants'),
    ('Ceinture cuir', '', '', 'accessory'),
    ('Strik cardigan', 'Strik', '', 'knitwear'),
    ('Villapaita ruskea', '', '', 'knitwear'),
    ('Trench coat beige', '', '', 'outerwear'),
    ('Tæppe uld', '', '', 'home'),
    ('Tote bag canvas', 'Bags', '', 'accessory'),
    ('Sneakers hvid', 'Sko', '', 'shoes'),
    ('Bague dorée', 'Bijoux', '', 'jewelry'),
    ('Gold hoop earrings', '', 'jewellery, gold', 'jewelry'),
    ('Cat eye sunglasses gold', '', '', 'eyewear'),
    ('Scented candle', '', '', 'home'),
    ('Yoga mat 6mm', '', '', 'sport'),
    ('Kaulakoru hopea', 'Korut', '', 'jewelry'),
    ('Naisten takki musta', '', '', 'outerwear'),
    ('Bluse hvid', 'Dametøj', '', 'top'),
    # generic type + nothing in the title = still clothing, never 'other'
    ('Livia', 'Vaatteet', '', 'clothing'),
]


@pytest.mark.parametrize('title,ptype,tags,expected', CASES, ids=[c[0][:28] for c in CASES])
def test_bucket(title, ptype, tags, expected):
    assert server._bs_category(title, ptype, tags) == expected


def test_fashion_and_clothing_helpers():
    assert server._bs_is_fashion('dress') and server._bs_is_fashion('jewelry')
    assert server._bs_is_clothing('dress') and not server._bs_is_clothing('jewelry')
    for b in server._BS_NON_FASHION_BUCKETS + ('other',):
        assert not server._bs_is_fashion(b)


def test_chèque_cadeau_is_junk():
    assert server._BS_JUNK_RE.search('Chèque Cadeau 50€')
    assert server._BS_JUNK_RE.search('Gift voucher')
    assert not server._BS_JUNK_RE.search('Robe cadeau de Noël')


def test_scan_drops_non_fashion_and_reports_it(monkeypatch):
    handles = ['sommerkjole', 'laebestift', 'strompebukser', 'bluse', 'vase']
    html = ''.join(f'<a href="/products/{h}">x</a>' for h in handles)

    class R:
        status_code = 200
        text = html
        headers = {}

    prods = {
        'sommerkjole': {'title': 'Sommerkjole', 'product_type': 'Kjoler'},
        'laebestift': {'title': 'Shade Shifter Lipstick', 'product_type': 'Læbestift'},
        'strompebukser': {'title': 'Sheer Tights', 'product_type': 'Strømpebukser'},
        'bluse': {'title': 'Bluse hvid', 'product_type': ''},
        'vase': {'title': 'Vase', 'product_type': 'Home'},
    }
    monkeypatch.setattr(server, '_scrape_get', lambda url, timeout=15, **kw: R())
    monkeypatch.setattr(server, '_bs_prod_json', lambda host, handle: (prods[handle], True))
    monkeypatch.setattr(server, '_bs_prod_cache_save', lambda: None)
    payload, blocked = server._bs_scan('shop.dk')
    assert blocked is None
    assert [p['category'] for p in payload['products']] == ['dress', 'top']
    assert payload['count'] == 2
    assert payload['dropped'] == {'beauty': 1, 'hosiery': 1, 'home': 1}
    assert payload['fashion_share'] == 0.4
    assert 'Shade Shifter Lipstick' in payload['dropped_examples']


def test_slim_cache_keeps_tags():
    slim = server._bs_prod_slim({'title': 'x', 'tags': ['Hårelastikker', 'nyhed'], 'images': [],
                                 'variants': [{'price': '20.00'}]})
    assert slim['tags'] == 'Hårelastikker nyhed'
    assert server._bs_category(slim['title'], slim.get('product_type'), slim['tags']) == 'beauty'
