"""Regression tests for the shipping-policy classifier (shipping_check).

These lock in the behaviour we verified by hand across real stores: unit-aware
parsing (days/weeks/hours), processing+delivery summing, the proc-only and
double-count guards, return-window rejection, and JSON-LD shippingDetails.

Pure parsing only — no network, no LLM (those layers are exercised live).
"""
import pytest
import shipping_check as sc


# (policy text, expected label, expected lo, expected hi)  — lo/hi ignored for Onbekend
PARSE_CASES = [
    ("De gemiddelde levertijd is 7-14 werkdagen.",                     "Dropshipper",    7, 14),
    ("Verwerkingstijd 1-2 dagen. Levertijd 3-5 werkdagen.",            "Dropshipper",    4, 7),
    ("De levertijd is 2-4 weken.",                                     "Dropshipper",   14, 28),
    ("levertijd: 2-4 weeks",                                           "Dropshipper",   14, 28),
    ("delivery time: 24-48 hours",                                     "Eigen voorraad", 1, 2),
    ("Bezorging binnen 2-4 werkdagen.",                                "Eigen voorraad", 2, 4),
    ("Shipping time: 10-20 business days.",                            "Dropshipper",   10, 20),
    ("dispatch within 24 hours and delivery in 3-5 business days",     "Dropshipper",    4, 6),
    # section-header split: first number after the trigger is processing, not transit
    ("leveranstid: vi forbereder och packar inom 3 arbetsdagar. "
     "standardleverans tar 5-9 arbetsdagar",                          "Dropshipper",    8, 12),
    ("vi packar inom 1-2 arbetsdagar. leveranstid 10 arbetsdagar",     "Dropshipper",   11, 12),
    # same range matched by both proc + delivery trigger -> must NOT double-count
    ("levertijd 3-5 werkdagen. we verzenden binnen 3-5 werkdagen.",    "Dropshipper",    3, 5),
]

ONBEKEND_CASES = [
    "Je kunt het artikel binnen 30 dagen retourneren voor terugbetaling.",  # return window
    "Bearbeitungszeit: 2-4 Werktage.",                                      # processing only
    "Welkom in onze winkel, bekijk onze nieuwe collectie.",                 # no shipping info
    "Onze klantenservice is 24/7 bereikbaar. Snelle verzending.",           # 24/7 must not parse
]


@pytest.mark.parametrize("text,label,lo,hi", PARSE_CASES)
def test_parse_labels(text, label, lo, hi):
    r = sc._parse_shipping(text)
    assert r["label"] == label, f"{text!r} -> {r}"
    assert (r["lo"], r["hi"]) == (lo, hi), f"{text!r} -> {r}"
    assert r["lo"] <= r["hi"]  # never lo>hi


@pytest.mark.parametrize("text", ONBEKEND_CASES)
def test_parse_onbekend(text):
    assert sc._parse_shipping(text)["label"] == "Onbekend", text


def test_empty_and_none_do_not_crash():
    assert sc._parse_shipping("")["label"] == "Onbekend"
    assert sc._parse_shipping(None)["label"] == "Onbekend"


def test_unit_conversion():
    assert sc._to_days(2, 4, "weken") == (14, 28)
    assert sc._to_days(24, 48, "uur") == (1, 2)
    assert sc._to_days(3, 5, "werkdagen") == (3, 5)
    # hours never round to 0
    assert sc._to_days(2, 6, "hours")[0] >= 1


def test_jsonld_handling_plus_transit():
    html = ('<script type="application/ld+json">{"shippingDetails":{"deliveryTime":'
            '{"handlingTime":{"minValue":1,"maxValue":2,"unitCode":"DAY"},'
            '"transitTime":{"minValue":5,"maxValue":10,"unitCode":"DAY"}}}}</script>')
    assert sc._jsonld_shipping_days(html) == (6, 12)


def test_jsonld_handling_only_is_ignored():
    # handlingTime alone is processing, not total delivery -> must not be trusted
    html = ('<script type="application/ld+json">{"shippingDetails":{"deliveryTime":'
            '{"handlingTime":{"minValue":1,"maxValue":2,"unitCode":"DAY"}}}}</script>')
    assert sc._jsonld_shipping_days(html) is None


def test_jsonld_weeks_unitcode():
    html = ('<script type="application/ld+json">{"transitTime":'
            '{"minValue":1,"maxValue":2,"unitCode":"WEEK"}}</script>')
    assert sc._jsonld_shipping_days(html) == (7, 14)


def test_jsonld_malformed_does_not_crash():
    assert sc._jsonld_shipping_days("<script type='application/ld+json'>{not json}</script>") is None
    assert sc._jsonld_shipping_days("no script tags here") is None
