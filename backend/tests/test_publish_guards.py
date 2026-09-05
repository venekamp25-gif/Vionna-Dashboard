# -*- coding: utf-8 -*-
"""Guards against duplicate product names and mixed siblings collections.

Found while cleaning up 38 garments (325 products) that carried a name already in
use. Three holes, each guarded here:

1. _find_product_by_handle failed OPEN: on a timeout/429 it returned None, which
   the caller read as "does not exist" and created a Shopify-suffixed duplicate.
   Hortense got a complete second set three minutes after the first.
2. /api/names returned HTTP 200 with an EMPTY list on error; the frontend read
   that as "no names taken".
3. _ensure_siblings_collection reused an existing collection whenever the handle
   was taken -- so a second garment named Maeve landed in the Maeve blouse's
   swatch collection, on all three stores.
"""
import json

import pytest

import server


class _Resp:
    def __init__(self, status, payload):
        self.status_code = status
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


# ── 1. handle check fails closed ────────────────────────────────────────────

def test_handle_check_raises_on_transport_error(monkeypatch):
    def boom(*a, **k):
        raise TimeoutError("read timed out")
    monkeypatch.setattr(server.req, "get", boom)
    with pytest.raises(server.HandleCheckFailed):
        server._find_product_by_handle("dk", "hortense-sort", {})


def test_handle_check_raises_on_non_200(monkeypatch):
    # A 429 used to be swallowed and read as "does not exist".
    monkeypatch.setattr(server.req, "get", lambda *a, **k: _Resp(429, {"errors": "throttled"}))
    with pytest.raises(server.HandleCheckFailed):
        server._find_product_by_handle("dk", "hortense-sort", {})


def test_handle_check_finds_exact_match(monkeypatch):
    monkeypatch.setattr(server.req, "get", lambda *a, **k: _Resp(200, {
        "products": [{"id": 1, "handle": "hortense-sort-1", "status": "draft"},
                     {"id": 2, "handle": "hortense-sort", "status": "active"}]}))
    hit = server._find_product_by_handle("dk", "hortense-sort", {})
    assert hit == {"id": 2, "status": "active"}


def test_handle_check_returns_none_when_truly_absent(monkeypatch):
    monkeypatch.setattr(server.req, "get", lambda *a, **k: _Resp(200, {"products": []}))
    assert server._find_product_by_handle("dk", "cordelia-sort", {}) is None


# ── 2. garment-type classes ─────────────────────────────────────────────────

@pytest.mark.parametrize("raw,klass", [
    ("Dress", "dress"), ("Robes en maille", "dress"), ("kjole", "dress"),
    ("cardigan", "cardigan"), ("Gilet", "cardigan"),
    ("jacket", "jacket"), ("Veste en cuir", "jacket"), ("takki", "jacket"),
    ("white blouse", "blouse"), ("Knitwear", "knit"), ("Swimwear", "swimwear"),
    ("", ""),
])
def test_type_class(raw, klass):
    assert server._type_class(raw) == klass


# ── 3. name collision ───────────────────────────────────────────────────────

def _gql(collection_products, title_products):
    def fake_post(url, headers=None, json=None, timeout=None):
        return _Resp(200, {"data": {
            "collectionByHandle": {"products": {"nodes": collection_products}} if collection_products is not None else None,
            "products": {"nodes": title_products},
        }})
    return fake_post


def test_collision_when_collection_holds_a_different_garment(monkeypatch):
    # The exact Maeve case: the siblings collection already holds blouses, and
    # a jacket is about to be published under the same name.
    monkeypatch.setattr(server.req, "post", _gql(
        [{"title": "Maeve", "productType": "white blouse", "status": "ACTIVE"}] * 7, []))
    hit = server._name_collision("dk", "Maeve", "maeve-siblings", "jacket", {})
    assert hit is not None
    assert hit["existing_class"] == "blouse"
    assert hit["incoming_class"] == "jacket"
    assert hit["count"] == 7


def test_no_collision_for_a_retry_of_the_same_garment(monkeypatch):
    # Re-running a publish of the SAME jacket must still be allowed to reuse.
    monkeypatch.setattr(server.req, "post", _gql(
        [{"title": "Maeve", "productType": "jacket", "status": "DRAFT"}] * 2, []))
    assert server._name_collision("dk", "Maeve", "maeve-siblings", "Jacket", {}) is None


def test_collision_via_title_search_when_collection_is_absent(monkeypatch):
    # No collection yet, but a product with the same slug already exists.
    monkeypatch.setattr(server.req, "post", _gql(
        None, [{"title": "Adèle", "productType": "Swimwear", "status": "ACTIVE", "handle": "adele-noir"}]))
    hit = server._name_collision("fr", "Adele", "adele-siblings", "jacket", {})
    assert hit is not None and hit["existing_class"] == "swimwear"


def test_archived_products_do_not_count(monkeypatch):
    monkeypatch.setattr(server.req, "post", _gql(
        [{"title": "Maeve", "productType": "white blouse", "status": "ARCHIVED"}], []))
    assert server._name_collision("dk", "Maeve", "maeve-siblings", "jacket", {}) is None


def test_unknown_existing_type_does_not_block(monkeypatch):
    # We cannot tell what it is, so we do not call it a different garment.
    monkeypatch.setattr(server.req, "post", _gql(
        [{"title": "Maeve", "productType": "", "status": "ACTIVE"}], []))
    assert server._name_collision("dk", "Maeve", "maeve-siblings", "jacket", {}) is None


def test_collision_check_fails_closed(monkeypatch):
    # A failed lookup must not silently mean "no collision".
    monkeypatch.setattr(server.req, "post", lambda *a, **k: _Resp(502, {}))
    with pytest.raises(RuntimeError):
        server._name_collision("dk", "Maeve", "maeve-siblings", "jacket", {})


def test_empty_name_is_never_a_collision():
    assert server._name_collision("dk", "", "x", "jacket", {}) is None
