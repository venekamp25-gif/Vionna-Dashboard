# -*- coding: utf-8 -*-
"""The siblings audit must check MEMBERSHIP, not just emptiness.

Found on 2026-08-31: `chloe-siblings` is a smart collection with rule
TITLE EQUALS 'chloe'. It held 3 stale 2025 drafts named 'Chloe', so the audit
called it healthy -- while the 20 LIVE dresses named 'Chloé' that point at it via
theme.siblings were not members (the rule does not match the accent). Empty
colour swatches for months, and the nightly heal reported broken_smart: 0.

Same shape on DK for Céleste (10), Clémentine (6), Cécile (2) and on FI for
Céleste (10). The heal already knows how to fix it (TITLE EQUALS the real
title); it only had to see it.
"""
import server


def _fake_pages(collections, products):
    def fake(store, query, kind):
        return collections if kind == 'collections' else products
    return fake


def _prod(pid, title, sib, member_of):
    return {'id': f'gid://shopify/Product/{pid}', 'handle': f'{title.lower()}-{pid}',
            'title': title, 'sib': {'value': sib},
            'collections': {'nodes': [{'handle': h} for h in member_of]}}


def _smart(handle, count, condition):
    return {'id': f'gid://shopify/Collection/{handle}', 'handle': handle,
            'productsCount': {'count': count},
            'ruleSet': {'rules': [{'column': 'TITLE', 'relation': 'EQUALS', 'condition': condition}]}}


def _manual(handle, count):
    return {'id': f'gid://shopify/Collection/{handle}', 'handle': handle,
            'productsCount': {'count': count}, 'ruleSet': None}


def test_non_empty_smart_collection_with_wrong_members_is_flagged(monkeypatch):
    # The exact Chloé case: collection is NOT empty (3 stale drafts), yet the
    # products pointing at it are not members.
    monkeypatch.setattr(server, '_sib_page', _fake_pages(
        [_smart('chloe-siblings', 3, 'chloe')],
        [_prod(i, 'Chloé', 'chloe-siblings', ['nye-ankomster']) for i in range(20)]))
    rep = server._siblings_audit('dk')
    assert rep['broken_smart'] == 1
    assert rep['plan_rule'][0]['handle'] == 'chloe-siblings'
    assert rep['plan_rule'][0]['title'] == 'Chloé'
    assert rep['plan_rule'][0]['missing'] == 20


def test_smart_collection_whose_rule_already_matches_is_not_churned(monkeypatch):
    # Rule already says the right title but Shopify has not recomputed yet (or
    # something else is off): do not queue the same "fix" every night.
    monkeypatch.setattr(server, '_sib_page', _fake_pages(
        [_smart('chloe-siblings', 0, 'Chloé')],
        [_prod(1, 'Chloé', 'chloe-siblings', [])]))
    rep = server._siblings_audit('dk')
    assert rep['broken_smart'] == 0


def test_healthy_smart_collection_is_left_alone(monkeypatch):
    monkeypatch.setattr(server, '_sib_page', _fake_pages(
        [_smart('chloe-siblings', 20, 'Chloé')],
        [_prod(i, 'Chloé', 'chloe-siblings', ['chloe-siblings', 'nye-ankomster']) for i in range(20)]))
    rep = server._siblings_audit('dk')
    assert rep['broken_smart'] == 0 and rep['broken_manual'] == 0


def test_manual_collection_adds_only_the_missing_products(monkeypatch):
    # 7 blouses point at maeve-siblings; 5 are members, 2 fell out. Add the 2,
    # not all 7 (collectionAddProducts on an existing member is noise + calls).
    prods = [_prod(i, 'Maeve', 'maeve-siblings', ['maeve-siblings']) for i in range(5)]
    prods += [_prod(i, 'Maeve', 'maeve-siblings', []) for i in (5, 6)]
    monkeypatch.setattr(server, '_sib_page', _fake_pages([_manual('maeve-siblings', 5)], prods))
    rep = server._siblings_audit('dk')
    assert rep['broken_manual'] == 1
    assert sorted(rep['plan_add'][0]['pids']) == ['gid://shopify/Product/5', 'gid://shopify/Product/6']
    assert rep['products_affected'] == 2


def test_smart_collection_with_mixed_titles_is_not_auto_ruled(monkeypatch):
    # Two different names point at one smart collection: we cannot pick a title
    # rule that is right for both. Report, do not guess.
    monkeypatch.setattr(server, '_sib_page', _fake_pages(
        [_smart('daphne-siblings', 1, 'daphne')],
        [_prod(1, 'Daphne', 'daphne-siblings', []), _prod(2, 'Daphné', 'daphne-siblings', [])]))
    rep = server._siblings_audit('dk')
    assert rep['broken_smart'] == 0


def test_missing_and_case_paths_still_work(monkeypatch):
    # The pre-existing checks (absent collection, upper-case metafield) must
    # keep behaving; membership is an addition, not a replacement.
    monkeypatch.setattr(server, '_sib_page', _fake_pages(
        [_manual('vartia-siblings', 3)],
        [_prod(1, 'Razer', 'Razer-siblings', []), _prod(2, 'Vartia', 'Vartia-siblings', [])]))
    rep = server._siblings_audit('fr')
    assert rep['missing_handles'] == ['Razer-siblings']
    assert rep['broken_case'] == 1
