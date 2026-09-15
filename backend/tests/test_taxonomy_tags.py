# -*- coding: utf-8 -*-
"""Taxonomy tags v1 (season / occ / len / sub / pat / tx / new).

One classification per colour FAMILY, strict allow-lists, additive to cat:<x>.
Everything here runs without network: the Haiku call is either monkeypatched
(`server._classify_taxonomy_llm`) or served by a fake `anthropic` module, and
the Shopify GraphQL callers (`_sib_page` / `_sib_gql`) are replaced by recorders.
"""
import sys
import threading
import types
import datetime

import pytest

import server


# ── fixtures / helpers ───────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _fresh_memo(monkeypatch):
    """Every test starts with an empty family memo and the kill switch OFF."""
    monkeypatch.setattr(server, '_TAXONOMY_MEMO', {})
    monkeypatch.delenv('TAXONOMY_TAGS', raising=False)


def _verdict(**over):
    base = {'category': 'dress', 'sub': 'knit-dress', 'seasons': ['autumn', 'winter'],
            'occasions': ['party'], 'length': 'maxi', 'length_confidence': 'high',
            'hemline_visible': True, 'pattern': 'plain'}
    base.update(over)
    return base


def _fake_classifier(monkeypatch, verdict, calls=None):
    """Replace the Haiku call; `calls` collects (title, description, image_url, category)."""
    calls = calls if calls is not None else []

    def fake(title, description, image_url=None, category=None):
        calls.append((title, description, image_url, category))
        if callable(verdict):
            return verdict(title)
        return None if verdict is None else dict(verdict)
    monkeypatch.setattr(server, '_classify_taxonomy_llm', fake)
    return calls


def _fake_anthropic(monkeypatch, reply):
    """Fake `anthropic` module: records messages.create kwargs, answers `reply`.
    `reply` may be a list consumed call by call; an Exception entry is raised."""
    calls = []
    script = list(reply) if isinstance(reply, list) else None

    class _Messages:
        def create(self, **kw):
            calls.append(kw)
            ans = script.pop(0) if script else reply
            if isinstance(ans, Exception):
                raise ans
            return types.SimpleNamespace(content=[types.SimpleNamespace(text=ans)])

    class _Anthropic:
        def __init__(self, api_key=None):
            self.messages = _Messages()

    mod = types.ModuleType('anthropic')
    mod.Anthropic = _Anthropic
    monkeypatch.setitem(sys.modules, 'anthropic', mod)
    monkeypatch.setattr(server, 'ANTHROPIC_KEY', 'sk-test-not-real')
    return calls


def _node(pid, title, store, tags=(), desc='', image=None, created='2026-09-01T10:00:00Z'):
    return {'id': f'gid://shopify/Product/{store}-{pid}', 'handle': f'{server._norm_name(title)}-{pid}',
            'title': title, 'tags': list(tags), 'productType': '', 'status': 'ACTIVE',
            'createdAt': created, 'sib': {'value': f'{server._norm_name(title)}-siblings'},
            'featuredMedia': {'preview': {'image': {'url': image}}} if image else None,
            'description': desc}


class _Gql:
    """Recorder standing in for server._sib_gql. Answers tagsAdd/tagsRemove with
    no userErrors; anything else gets `answers` (a dict or a callable)."""

    def __init__(self, answers=None):
        self.calls = []
        self.answers = answers or {}

    def __call__(self, store, query, variables=None):
        self.calls.append((store, query, variables))
        if 'tagsAdd' in query:
            return {'tagsAdd': {'userErrors': []}}
        if 'tagsRemove' in query:
            return {'tagsRemove': {'userErrors': []}}
        if callable(self.answers):
            return self.answers(store, query, variables)
        return self.answers

    def mutations(self):
        return [c for c in self.calls if 'mutation' in c[1]]


# ── vocabulary / validation ──────────────────────────────────────────────────

def test_tags_order_is_stable_and_starts_with_cat():
    tags = server._taxonomy_tags(_verdict())
    assert tags == ['cat:dress', 'sub:knit-dress', 'season:autumn', 'season:winter', 'season:aw',
                    'occ:party', 'len:maxi', 'pat:plain', 'tx:1']
    assert tags[0].startswith('cat:')
    assert tags[-1] == server.TX_TAG
    assert len(tags) < 15


def test_invalid_values_are_dropped_never_invented():
    tags = server._taxonomy_tags(_verdict(sub='ballgown', seasons=['autumn', 'monsoon'],
                                          occasions=['party', 'funeral', 'gala'],
                                          pattern='paisley', length='knee'))
    assert 'sub:ballgown' not in ' '.join(tags)
    assert [t for t in tags if t.startswith('season:')] == ['season:autumn', 'season:aw']
    assert [t for t in tags if t.startswith('occ:')] == ['occ:party']
    assert not any(t.startswith('pat:') for t in tags)
    assert not any(t.startswith('len:') for t in tags)
    # unknown category → nothing at all (caller falls back to plain cat:)
    assert server._taxonomy_tags(_verdict(category='lingerie')) == []
    assert server._taxonomy_tags('not a dict') == []


def test_sub_is_constrained_to_its_category():
    # 'coat' is an outerwear sub-type; on a dress it must vanish
    tags = server._taxonomy_tags(_verdict(category='dress', sub='coat'))
    assert not any(t.startswith('sub:') for t in tags)
    tags = server._taxonomy_tags(_verdict(category='outerwear', sub='coat', length=None))
    assert 'sub:coat' in tags
    # a caller-supplied category wins over the model's, and sub is re-checked against it
    tags = server._taxonomy_tags(_verdict(category='dress', sub='knit-dress'), category='knitwear')
    assert tags[0] == 'cat:knitwear' and not any(t.startswith('sub:') for t in tags)
    # model wrote "Knit Dress" — normalised to the slug, not dropped
    assert 'sub:knit-dress' in server._taxonomy_tags(_verdict(sub='Knit Dress'))


def test_umbrella_seasons_are_derived():
    def seasons_of(*s):
        return [t for t in server._taxonomy_tags(_verdict(seasons=list(s))) if t.startswith('season:')]
    assert seasons_of('spring') == ['season:spring', 'season:ss']
    assert seasons_of('summer', 'spring') == ['season:spring', 'season:summer', 'season:ss']
    assert seasons_of('winter') == ['season:winter', 'season:aw']
    # at most SEASON_MAX (2) seasons survive, the model's first two (best first), emitted in allow-list order
    assert seasons_of('spring', 'summer', 'autumn', 'winter') == ['season:spring', 'season:summer', 'season:ss']
    assert seasons_of('winter', 'autumn', 'spring') == ['season:autumn', 'season:winter', 'season:aw']
    assert seasons_of('summer', 'autumn') == ['season:summer', 'season:autumn', 'season:ss', 'season:aw']
    assert seasons_of() == []
    assert 'occ:party' in server._taxonomy_tags(_verdict(occasions='party, office'))


def test_length_only_with_visible_hemline_and_high_confidence():
    def has_len(**over):
        return any(t.startswith('len:') for t in server._taxonomy_tags(_verdict(**over)))
    assert has_len()                                              # visible + high → len:maxi
    assert not has_len(length_confidence='medium')
    assert not has_len(hemline_visible=False)
    assert not has_len(length_confidence='high', hemline_visible=None)
    assert not has_len(category='knitwear', sub=None)             # dresses/skirts only
    assert has_len(category='skirt', sub='skirt', length='mini')
    # no image at all → the gate is shut even if the model claims to have seen a hem
    assert server._taxonomy_validate(_verdict(), has_image=False)['length'] is None


def test_taxonomy_occasions_capped_at_two_best_first():
    tags = server._taxonomy_tags(_verdict(occasions=['office', 'everyday', 'party', 'wedding', 'beach']))
    occ = [t for t in tags if t.startswith('occ:')]
    assert occ == ['occ:office', 'occ:everyday']          # the model's first two, allow-list order
    tags = server._taxonomy_tags(_verdict(occasions=['everyday', 'party']))
    assert [t for t in tags if t.startswith('occ:')] == ['occ:party', 'occ:everyday']


# ── the Haiku call itself (fake anthropic module, no network) ────────────────

def test_llm_call_sends_image_block_before_text_and_parses_json(monkeypatch):
    calls = _fake_anthropic(monkeypatch, 'Sure! Here you go:\n{"category":"dress","sub":"wrap-dress",'
                                         '"seasons":["summer"],"occasions":["wedding","party"],"length":"midi",'
                                         '"hemline_visible":true,"length_confidence":"high","pattern":"floral"}')
    res = server._classify_taxonomy_llm('Zoé', 'Smuk kjole', image_url='https://cdn.shopify.com/zoe.jpg')
    assert res['category'] == 'dress' and res['sub'] == 'wrap-dress'
    assert res['length'] == 'midi' and res['pattern'] == 'floral'
    assert res['occasions'] == ['party', 'wedding']    # both kept, in allow-list order
    kw = calls[0]
    assert kw['model'] == 'claude-haiku-4-5-20251001'
    assert kw['max_tokens'] <= 200
    content = kw['messages'][0]['content']
    assert content[0] == {'type': 'image', 'source': {'type': 'url', 'url': 'https://cdn.shopify.com/zoe.jpg'}}
    assert content[1]['type'] == 'text'
    assert 'PHOTO' in content[1]['text'] and 'hemline' in content[1]['text'].lower()


def test_llm_call_without_image_shuts_the_length_gate(monkeypatch):
    calls = _fake_anthropic(monkeypatch, '{"category":"dress","seasons":["summer"],"length":"maxi",'
                                         '"hemline_visible":true,"length_confidence":"high"}')
    res = server._classify_taxonomy_llm('Zoé', 'Lang kjole')
    assert res['length'] is None and res['hemline_visible'] is False
    assert isinstance(calls[0]['messages'][0]['content'], str)   # no image block at all
    assert 'no photo' in calls[0]['messages'][0]['content'].lower()


def test_llm_call_failures_return_none(monkeypatch):
    _fake_anthropic(monkeypatch, 'dress')                        # no JSON object
    assert server._classify_taxonomy_llm('Zoé', 'x') is None
    _fake_anthropic(monkeypatch, '{"category":"none"}')          # category outside the allow-list
    assert server._classify_taxonomy_llm('Zoé', 'x') is None
    _fake_anthropic(monkeypatch, '{"category":"dress", broken')  # unparsable → None, never raises
    assert server._classify_taxonomy_llm('Zoé', 'x') is None
    monkeypatch.setattr(server, 'ANTHROPIC_KEY', None)           # no key → no call
    assert server._classify_taxonomy_llm('Zoé', 'x') is None


def test_llm_call_retries_text_only_when_the_image_is_rejected(monkeypatch):
    """Anthropic fetches the URL itself; an expired Higgsfield/competitor URL or an
    oversized photo answers 400. The verdict must then come from the text (length
    gate shut) instead of falling through to the keyword classifier."""
    calls = _fake_anthropic(monkeypatch, [
        RuntimeError('400 Could not process image'),
        '{"category":"dress","sub":"wrap-dress","seasons":["summer"],"length":"maxi",'
        '"hemline_visible":true,"length_confidence":"high","pattern":"floral"}'])
    res = server._classify_taxonomy_llm('Zoé', 'Smuk kjole', image_url='https://cdn.example/expired.jpg')
    assert res['category'] == 'dress' and res['sub'] == 'wrap-dress' and res['pattern'] == 'floral'
    assert res['length'] is None and res['hemline_visible'] is False, 'no photo → no length'
    assert len(calls) == 2
    assert isinstance(calls[0]['messages'][0]['content'], list), 'first attempt carried the image'
    assert isinstance(calls[1]['messages'][0]['content'], str), 'retry is text-only'
    assert 'no photo' in calls[1]['messages'][0]['content'].lower()
    # a text-only call that fails is NOT retried (nothing to strip), still returns None
    calls = _fake_anthropic(monkeypatch, [RuntimeError('boom'), '{"category":"dress"}'])
    assert server._classify_taxonomy_llm('Zoé', 'x') is None
    assert len(calls) == 1
    # and the publish category resolver now gets the LLM category, not the keyword tier
    _fake_anthropic(monkeypatch, [RuntimeError('400 image'), '{"category":"knitwear","seasons":["winter"]}'])
    assert server._category_for_publish({'description': 'Smuk kjole'}, 'Zoé',
                                        image_url='https://cdn.example/expired.jpg') == 'knitwear'


def test_json_extractor_falls_back_when_the_model_echoes_a_second_brace_pair():
    good = '{"category":"dress","seasons":["summer"]}'
    assert server._taxonomy_extract_json(good) == {'category': 'dress', 'seasons': ['summer']}
    echoed = good + '\nJSON shape: {"category":"...","sub":"..."}'
    assert server._taxonomy_extract_json(echoed) == {'category': 'dress', 'seasons': ['summer']}
    assert server._taxonomy_extract_json('no braces here') is None
    assert server._taxonomy_extract_json('{"category":"dress", broken') is None
    assert server._taxonomy_extract_json('[1, 2] {"a":') is None
    assert server._taxonomy_extract_json('') is None and server._taxonomy_extract_json(None) is None


def test_classifier_survives_an_echoed_prompt_shape(monkeypatch):
    _fake_anthropic(monkeypatch, '{"category":"dress","seasons":["summer"]}\n'
                                 'JSON shape: {"category":"...","sub":"..."}')
    res = server._classify_taxonomy_llm('Zoé', 'x')
    assert res and res['category'] == 'dress' and res['seasons'] == ['summer']


def test_category_wrapper_keeps_working(monkeypatch):
    _fake_anthropic(monkeypatch, '{"category":"knitwear","sub":"cardigan","seasons":["winter"]}')
    assert server._classify_category_llm('Zoé', 'x') == 'knitwear'
    _fake_anthropic(monkeypatch, 'garbage')
    assert server._classify_category_llm('Zoé', 'x') is None


# ── family memo + publish wiring ─────────────────────────────────────────────

def test_memo_gives_identical_tags_to_every_colour_and_store(monkeypatch):
    calls = _fake_classifier(monkeypatch, _verdict())
    out = []
    for store, desc in (('dk', 'Smuk strikkjole'), ('fr', 'Belle robe'), ('fi', 'Kaunis mekko')):
        for color in ('Sort', 'Hvid', 'Beige'):
            data = {'description': desc, 'color': color, 'images': ['https://x/%s.jpg' % color]}
            cat = server._category_for_publish(data, 'Zoé', image_url='https://x/%s.jpg' % color)
            tags, tax = server._publish_tags_for(data, 'Zoé', cat, images=data['images'])
            out.append(tags)
    assert len(calls) == 1, 'one Haiku call per family, not per colour/store'
    assert all(t == out[0] for t in out)
    assert out[0] == ['cat:dress', 'sub:knit-dress', 'season:autumn', 'season:winter', 'season:aw',
                      'occ:party', 'len:maxi', 'pat:plain', 'tx:1', 'new']
    # accent-insensitive family key: 'Zoe' on another store is the same family
    server._publish_tags_for({'description': 'x'}, 'ZOE', 'dress')
    assert len(calls) == 1
    # a different family is a new call
    server._publish_tags_for({'description': 'x'}, 'Amélie', 'dress')
    assert len(calls) == 2


def test_memo_expires_and_does_not_cache_failures(monkeypatch):
    calls = _fake_classifier(monkeypatch, None)
    server._publish_tags_for({'description': 'x'}, 'Zoé', 'dress')
    server._publish_tags_for({'description': 'x'}, 'Zoé', 'dress')
    assert len(calls) == 2, 'a failed verdict is retried on the next colour, not memoised'
    calls = _fake_classifier(monkeypatch, _verdict())
    server._publish_tags_for({'description': 'x'}, 'Zoé', 'dress')
    key = server._norm_name('Zoé')
    res, ts = server._TAXONOMY_MEMO[key]
    server._TAXONOMY_MEMO[key] = (res, ts - server._TAXONOMY_MEMO_TTL - 1)
    server._publish_tags_for({'description': 'x'}, 'Zoé', 'dress')
    assert len(calls) == 2


def test_publish_falls_back_to_plain_cat_and_new_on_failure(monkeypatch):
    _fake_classifier(monkeypatch, None)
    assert server._publish_tags_for({'description': 'x'}, 'Zoé', 'dress') == (['cat:dress', 'new'], None)

    def boom(*a, **k):
        raise RuntimeError('haiku down')
    monkeypatch.setattr(server, '_classify_taxonomy_llm', boom)
    assert server._publish_tags_for({'description': 'x'}, 'Zoé', 'dress') == (['cat:dress', 'new'], None)
    # and the category itself still resolves through the deterministic keyword tier
    assert server._category_for_publish({'description': 'Smuk kjole til fest'}, 'Zoé') == 'dress'


def test_publish_cat_tag_always_equals_resolved_category(monkeypatch):
    # size guard / product_type / size charts read `category`; the cat: tag must agree with it
    _fake_classifier(monkeypatch, _verdict(category='dress', sub='knit-dress'))
    tags, tax = server._publish_tags_for({'description': 'x'}, 'Zoé', 'top')
    assert tags[0] == 'cat:top' and 'cat:dress' not in tags
    assert not any(t.startswith('sub:') for t in tags)   # knit-dress is not a top sub-type
    assert tax['category'] == 'top' and tax['sub'] is None
    assert tax['seasons'] == ['autumn', 'winter'] and tax['occasions'] == ['party']


def test_publish_uses_dk_description_and_first_image(monkeypatch):
    calls = _fake_classifier(monkeypatch, _verdict())
    data = {'description': 'Belle robe', 'description_dk': 'Smuk kjole',
            'images': [{'src': 'not-a-url'}, {'src': 'https://cdn/a.jpg'}, 'https://cdn/b.jpg']}
    server._publish_tags_for(data, 'Zoé', 'dress')
    assert calls[0][1] == 'Smuk kjole'
    assert calls[0][2] == 'https://cdn/a.jpg'
    assert calls[0][3] == 'dress'
    assert server._first_image_url([]) is None
    assert server._first_image_url(['//cdn/x.jpg', {'url': 'https://cdn/y.jpg'}]) == 'https://cdn/y.jpg'


def test_kill_switch_restores_todays_tag_list(monkeypatch):
    monkeypatch.setenv('TAXONOMY_TAGS', '0')
    calls = _fake_classifier(monkeypatch, _verdict())
    assert server._publish_tags_for({'description': 'x'}, 'Zoé', 'dress') == (['cat:dress'], None)
    assert server._publish_tags_for({'description': 'x'}, 'Zoé', None) == ([], None)
    assert calls == []
    # the category path then uses the plain wrapper exactly as before
    monkeypatch.setattr(server, '_classify_category_llm', lambda t, d: 'knitwear')
    assert server._category_for_publish({'description': 'x'}, 'Zoé') == 'knitwear'
    assert server._TAXONOMY_MEMO == {}


# ── backfill ────────────────────────────────────────────────────────────────

def _catalogue():
    zoe_dk = [_node(1, 'Zoé', 'dk', ['cat:dress'], 'Smuk kjole', 'https://cdn/zoe-dk.jpg'),
              _node(2, 'Zoé', 'dk', ['cat:dress', 'len:midi'], '', None)]
    zoe_fr = [_node(3, 'Zoe', 'fr', ['cat:dress', 'Women'], 'Belle robe', 'https://cdn/zoe-fr.jpg')]
    zoe_fi = [_node(4, 'Zoé', 'fi', ['cat:dress'], 'Kaunis mekko')]
    amelie = [_node(5, 'Amélie', 'dk', ['cat:knitwear'], 'Blød cardigan')]
    done = [_node(6, 'Chloé', 'dk', ['cat:top', 'sub:blouse', 'tx:1'], 'x'),
            _node(7, 'Chloé', 'fr', ['cat:top', 'sub:blouse', 'tx:1'], 'x')]
    return {'dk': zoe_dk + amelie + [done[0]], 'fr': zoe_fr + [done[1]], 'fi': zoe_fi}


def _install_catalogue(monkeypatch, gql=None):
    cat = _catalogue()
    monkeypatch.setattr(server, 'tokens', {'dk': {}, 'fr': {}, 'fi': {}})
    monkeypatch.setattr(server, '_sib_page', lambda store, query, key: list(cat.get(store) or []))
    gql = gql or _Gql()
    monkeypatch.setattr(server, '_sib_gql', gql)
    monkeypatch.setattr(server.time, 'sleep', lambda s: None)
    return cat, gql


def test_backfill_groups_by_family_and_classifies_once(monkeypatch, tmp_path):
    _install_catalogue(monkeypatch)
    verdicts = {'zoe': _verdict(), 'amelie': _verdict(category='knitwear', sub='cardigan', length=None)}
    calls = _fake_classifier(monkeypatch, lambda title: dict(verdicts[server._norm_name(title)]))
    state = server._taxonomy_backfill_run(['dk', 'fr', 'fi'], dry_run=False, only_missing=True,
                                          state_path=str(tmp_path / 'tx.json'))
    assert state['status'] == 'done'
    assert sorted(server._norm_name(c[0]) for c in calls) == ['amelie', 'zoe'], 'one call per family'
    assert state['families_total'] == 2 and state['families_done'] == 2
    assert state['families_skipped'] == 1, 'Chloé already carries tx:1 on every member'
    assert state['products_tagged'] == {'dk': 3, 'fr': 1, 'fi': 1}
    # DK description + DK image were the inputs for the Zoé family, with the cat: hint
    zoe_call = next(c for c in calls if server._norm_name(c[0]) == 'zoe')
    assert zoe_call[1] == 'Smuk kjole' and zoe_call[2] == 'https://cdn/zoe-dk.jpg' and zoe_call[3] == 'dress'
    assert state['histogram']['tx:1'] == 5 and state['histogram']['sub:knit-dress'] == 4
    assert (tmp_path / 'tx.json').exists()


def test_backfill_tags_every_member_in_every_store(monkeypatch):
    _, gql = _install_catalogue(monkeypatch)
    _fake_classifier(monkeypatch, _verdict())
    server._taxonomy_backfill_run(['dk', 'fr', 'fi'], dry_run=False, only_missing=True,
                                  families=['Zoé'])
    adds = {(s, v['id']): v['t'] for s, q, v in gql.calls if 'tagsAdd' in q}
    removes = {(s, v['id']): v['t'] for s, q, v in gql.calls if 'tagsRemove' in q}
    expected = ['sub:knit-dress', 'season:autumn', 'season:winter', 'season:aw', 'occ:party',
                'len:maxi', 'pat:plain', 'tx:1']
    assert adds == {('dk', 'gid://shopify/Product/dk-1'): expected,
                    ('dk', 'gid://shopify/Product/dk-2'): expected,
                    ('fr', 'gid://shopify/Product/fr-3'): expected,
                    ('fi', 'gid://shopify/Product/fi-4'): expected}
    # never re-adds cat:, removes ONLY the conflicting len:midi on the one product that had it
    assert not any('cat:dress' in t for t in adds.values())
    assert removes == {('dk', 'gid://shopify/Product/dk-2'): ['len:midi']}
    # tagsRemove ran before tagsAdd on that product
    order = ['tagsRemove' if 'tagsRemove' in q else 'tagsAdd'
             for s, q, v in gql.calls if v and v.get('id') == 'gid://shopify/Product/dk-2']
    assert order == ['tagsRemove', 'tagsAdd']
    # FR legacy tag 'Women' is not ours → untouched
    assert all('Women' not in t for t in removes.values())


def test_member_plan_never_writes_cat_even_when_the_member_has_none():
    """The backfill is additive to cat:<x>; an uncategorised member is left to
    api_apply_category_tags instead of receiving the family majority category."""
    tags = server._taxonomy_tags(_verdict())
    add, remove = server._taxonomy_member_plan({'tags': []}, tags)
    assert add and not any(t.startswith('cat:') for t in add)
    assert 'tx:1' in add and remove == []
    add, remove = server._taxonomy_member_plan({'tags': ['cat:top', 'CAT:Dress']}, tags)
    assert not any(t.lower().startswith('cat:') for t in add + remove)
    # idempotent: a fully tagged member plans nothing
    add, remove = server._taxonomy_member_plan({'tags': ['cat:dress'] + tags[1:]}, tags)
    assert add == [] and remove == []


def test_throttled_shopify_answers_wait_longer_before_the_retry(monkeypatch):
    assert server._taxonomy_retry_delay(RuntimeError('[{"message": "Throttled"}]'), 0) == 5.0
    assert server._taxonomy_retry_delay(RuntimeError('THROTTLED'), 1) == 10.0
    assert server._taxonomy_retry_delay(RuntimeError('userErrors'), 0) == 1.5
    assert server._taxonomy_retry_delay(None, 1) == 3.0
    sleeps = []
    monkeypatch.setattr(server.time, 'sleep', lambda s: sleeps.append(s))
    seen = []

    def gql(store, query, variables=None):
        seen.append(query)
        if len(seen) < 3:
            raise RuntimeError('Throttled')
        return {'tagsAdd': {'userErrors': []}}
    monkeypatch.setattr(server, '_sib_gql', gql)
    assert server._taxonomy_apply_member('dk', 'gid://shopify/Product/1', ['tx:1'], []) is None
    assert sleeps == [5.0, 10.0]


def test_backfill_dry_run_makes_no_shopify_writes(monkeypatch, tmp_path):
    _, gql = _install_catalogue(monkeypatch)
    calls = _fake_classifier(monkeypatch, _verdict())
    state = server._taxonomy_backfill_run(['dk', 'fr', 'fi'], dry_run=True, only_missing=False,
                                          state_path=str(tmp_path / 'tx.json'))
    assert gql.calls == [], 'dry run must not touch Shopify'
    assert state['dry_run'] is True and state['status'] == 'done'
    assert state['limit'] == server.TAXONOMY_DRY_RUN_DEFAULT_LIMIT
    assert state['products_tagged'] == {'dk': 0, 'fr': 0, 'fi': 0}
    assert len(calls) == 3 and state['families_total'] == 3     # only_missing=False → Chloé too
    fams = {e['family'] for e in state['sample']}
    assert {server._norm_name(f) for f in fams} == {'zoe', 'amelie', 'chloe'}
    zoe = next(e for e in state['sample'] if server._norm_name(e['family']) == 'zoe')
    assert zoe['members'] == {'dk': 2, 'fr': 1, 'fi': 1} and zoe['writes'] == 4 and zoe['removes'] == 1
    assert state['histogram']['tx:1'] == 7


def test_backfill_limit_and_family_filter(monkeypatch):
    _install_catalogue(monkeypatch)
    calls = _fake_classifier(monkeypatch, _verdict())
    state = server._taxonomy_backfill_run(['dk'], dry_run=True, only_missing=False, limit=1)
    assert len(calls) == 1 and state['families_total'] == 1
    server._TAXONOMY_MEMO.clear()          # the first run memoised Amélie; start clean
    calls = _fake_classifier(monkeypatch, _verdict())
    state = server._taxonomy_backfill_run(['dk', 'fr'], dry_run=True, only_missing=False, families=['AMÉLIE'])
    assert [server._norm_name(c[0]) for c in calls] == ['amelie']
    assert state['families_total'] == 1
    # and a family already in the memo costs no Haiku call at all
    calls = _fake_classifier(monkeypatch, _verdict())
    state = server._taxonomy_backfill_run(['dk', 'fr'], dry_run=True, only_missing=False, families=['Amélie'])
    assert calls == [] and state['llm_calls'] == 0 and state['families_done'] == 1


def test_backfill_defers_previously_failed_families_and_caps_errors(monkeypatch):
    """A family that never classifies must not sit at the head of the alphabetical
    queue and eat the daily slot forever: `defer` pushes it behind the others."""
    _install_catalogue(monkeypatch)
    # Amélie (alphabetically first) fails, Zoé succeeds
    calls = _fake_classifier(monkeypatch, lambda t: None if server._norm_name(t) == 'amelie' else _verdict())
    state = server._taxonomy_backfill_run(['dk', 'fr', 'fi'], dry_run=False, only_missing=True)
    assert state['failed_families'] == ['amelie'] and state['families_failed'] == 1
    assert state['families_deferred'] == 0
    # next daily run with limit=1 and the previous failures deferred → Zoé gets the slot
    server._TAXONOMY_MEMO.clear()
    calls = _fake_classifier(monkeypatch, lambda t: None if server._norm_name(t) == 'amelie' else _verdict())
    state = server._taxonomy_backfill_run(['dk', 'fr', 'fi'], dry_run=False, only_missing=True, limit=1,
                                          defer=['amelie'])
    assert [server._norm_name(c[0]) for c in calls] == ['zoe']
    assert state['families_deferred'] == 1 and state['failed_families'] == []
    # without `defer` the same limit would have picked Amélie again
    server._TAXONOMY_MEMO.clear()
    calls = _fake_classifier(monkeypatch, lambda t: None if server._norm_name(t) == 'amelie' else _verdict())
    server._taxonomy_backfill_run(['dk', 'fr', 'fi'], dry_run=False, only_missing=True, limit=1)
    assert [server._norm_name(c[0]) for c in calls] == ['amelie']
    # the 'no classification' branch respects the 50-entry cap like the others
    many = {'dk': [_node(i, 'Fam%03d' % i, 'dk', ['cat:dress']) for i in range(70)]}
    monkeypatch.setattr(server, '_sib_page', lambda store, query, key: list(many.get(store) or []))
    _fake_classifier(monkeypatch, None)
    state = server._taxonomy_backfill_run(['dk'], dry_run=False, only_missing=True, limit=None)
    assert state['families_total'] == 70 and state['families_failed'] == 70
    assert len(state['failed_families']) == 70
    assert len(state['errors']) == 50, 'the no-classification branch respects the cap'


def test_backfill_family_key_falls_back_to_siblings_value():
    n = _node(1, '', 'dk')
    n['sib'] = {'value': 'Zoe-Siblings'}
    assert server._taxonomy_family_key(n) == 'zoe-siblings'
    assert server._taxonomy_family_key(_node(2, 'Zoé', 'dk')) == 'zoe'
    assert server._taxonomy_family_key({'title': '', 'sib': None}) == ''


def test_backfill_only_touches_fashion_tokens_never_light(monkeypatch):
    _install_catalogue(monkeypatch)
    monkeypatch.setattr(server, 'LIGHT_TOKENS', {'nl': {}})
    _fake_classifier(monkeypatch, _verdict())
    state = server._taxonomy_backfill_run(['dk', 'nl'], dry_run=True)
    assert state['stores'] == ['dk']


def test_new_tag_expires_after_45_days_exact_tag_only(monkeypatch):
    now = datetime.datetime(2026, 9, 15, 12, 0, 0)
    prods = [_node(1, 'Old', 'dk', ['new', 'cat:dress'], created='2026-07-01T10:00:00Z'),
             _node(2, 'Fresh', 'dk', ['new'], created='2026-09-10T10:00:00Z'),
             _node(3, 'Legacy', 'dk', ['NEW IN', 'New Arrivals'], created='2025-01-01T10:00:00Z'),
             _node(4, 'Edge', 'dk', ['new'], created='2026-08-01T12:00:01Z'),   # 44d 23h 59m 59s
             _node(5, 'Broken', 'dk', ['new'], created='')]
    # 42 legacy DK drafts (2024-12) carry the exact tag 'new' that we never wrote
    draft = _node(6, 'LegacyDraft', 'dk', ['new'], created='2024-12-01T10:00:00Z')
    draft['status'] = 'DRAFT'
    prods.append(draft)
    queries = []

    def page(store, query, key):
        queries.append(query)
        return prods
    monkeypatch.setattr(server, '_sib_page', page)
    gql = _Gql()
    monkeypatch.setattr(server, '_sib_gql', gql)
    rep = server._taxonomy_expire_new('dk', now=now)
    removed = [(v['id'], v['t']) for s, q, v in gql.calls if 'tagsRemove' in q]
    assert removed == [('gid://shopify/Product/dk-1', ['new'])]
    assert rep == {'checked': 6, 'expired': 1, 'errors': []}
    assert not any('tagsAdd' in q for s, q, v in gql.calls)
    assert 'status:active' in queries[0] and 'tag:new' in queries[0]


def test_daily_loop_is_not_started_under_pytest_and_state_files_are_backed_up():
    assert not any(t.name == 'taxonomy-fill' for t in threading.enumerate())
    import inspect
    src = inspect.getsource(server._run_backup)
    assert 'taxonomy_backfill.json' in src and 'taxonomy_fill.json' in src


def test_daily_loop_skips_dev_local_and_waits_for_a_live_backfill(monkeypatch, tmp_path):
    # the start guard mirrors the self-updater: TAXONOMY_FILL=0, DEV_LOCAL=1 and pytest all skip it
    with open(server.__file__, encoding='utf-8') as f:
        src = f.read()
    guard = next(l for l in src.splitlines() if 'target=_taxonomy_fill_loop' in l)
    cond = src.splitlines()[src.splitlines().index(guard) - 1]
    assert "os.getenv('TAXONOMY_FILL') != '0'" in cond
    assert "os.getenv('DEV_LOCAL') != '1'" in cond and "'pytest' not in sys.modules" in cond
    # the write phase waits for a completed NON-dry-run backfill
    import json
    path = str(tmp_path / 'b.json')
    monkeypatch.setattr(server, 'TAXONOMY_BACKFILL_STATE_PATH', path)
    assert server._taxonomy_live_backfill_done() is False, 'no state file yet'
    for st, ok in (({'status': 'done', 'dry_run': True}, False),
                   ({'status': 'running', 'dry_run': False}, False),
                   ({'status': 'error', 'dry_run': False}, False),
                   ({'status': 'done', 'dry_run': False}, True)):
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(st, f)
        assert server._taxonomy_live_backfill_done() is ok, st
    import inspect
    loop_src = inspect.getsource(server._taxonomy_fill_loop)
    assert 'if not _taxonomy_live_backfill_done()' in loop_src
    assert 'defer=defer' in loop_src, 'previous failures are queued last'


# ── collections ──────────────────────────────────────────────────────────────

def test_rule_sets_and_count_queries():
    rs = server._taxonomy_rule_set({'all': ['cat:dress', 'occ:party']})
    assert rs['appliedDisjunctively'] is False
    assert rs['rules'] == [{'column': 'TAG', 'relation': 'EQUALS', 'condition': 'cat:dress'},
                           {'column': 'TAG', 'relation': 'EQUALS', 'condition': 'occ:party'}]
    rs = server._taxonomy_rule_set({'any': ['season:autumn', 'season:winter']})
    assert rs['appliedDisjunctively'] is True and len(rs['rules']) == 2
    assert server._taxonomy_count_query({'all': ['cat:dress', 'len:maxi']}) == \
        "status:active AND tag:'cat:dress' AND tag:'len:maxi'"
    assert server._taxonomy_count_query({'any': ['season:autumn', 'season:winter']}) == \
        "status:active AND (tag:'season:autumn' OR tag:'season:winter')"


def test_collection_table_is_localised_and_uses_only_known_tags():
    vocab = {'cat:%s' % c for c in server.CATEGORY_TAGS}
    vocab |= {'season:%s' % s for s in server.SEASON_TAGS + ['aw', 'ss']}
    vocab |= {'occ:%s' % o for o in server.OCCASION_TAGS}
    vocab |= {'len:%s' % l for l in server.LENGTH_TAGS}
    vocab |= {'pat:%s' % p for p in server.PATTERN_TAGS}
    vocab |= {'sub:%s' % s for subs in server.SUB_TAGS_BY_CAT.values() for s in subs}
    keys, handles = set(), {'dk': set(), 'fr': set(), 'fi': set()}
    for row in server.TAXONOMY_COLLECTIONS:
        assert row['key'] not in keys
        keys.add(row['key'])
        rules = row['rules']
        assert bool(rules.get('all')) != bool(rules.get('any'))
        assert set(rules.get('all') or rules.get('any')) <= vocab, row['key']
        for st in ('dk', 'fr', 'fi'):
            loc = row[st]
            assert loc['handle'] not in handles[st]
            handles[st].add(loc['handle'])
            assert loc['handle'].isascii() and loc['handle'] == loc['handle'].lower()
            assert ' ' not in loc['handle']
            assert loc['title'] and loc['description'] and loc['seo_title'] and loc['seo_description']
    # spec anchors
    by_key = {r['key']: r for r in server.TAXONOMY_COLLECTIONS}
    assert by_key['aw-2026']['dk']['handle'] == 'efteraar-vinter-2026'
    assert by_key['aw-2026']['fr']['handle'] == 'automne-hiver-2026'
    assert by_key['aw-2026']['fi']['handle'] == 'syksyn-uutuudet'
    assert by_key['party']['dk']['title'] == 'FESTTØJ'
    assert by_key['season-knits']['rules'] == {'all': ['cat:knitwear', 'season:aw']}
    assert by_key['maxi-dresses']['fr']['handle'] == 'robes-longues'
    assert server.TAXONOMY_ONLINE_STORE_PUBLICATION['dk'].startswith('gid://shopify/Publication/')


def _collections_gql(counts, existing, new_active=0):
    """productsCount aliases from `counts` {key: n}; collectionByHandle from `existing`."""
    def answer(store, query, variables):
        if 'productsCount' in query:
            return {'c%d' % i: {'count': counts.get(row['key'], 0)}
                    for i, row in enumerate(server.TAXONOMY_COLLECTIONS)}
        if 'collectionByHandle' in query:
            return {'collectionByHandle': existing.get((variables or {}).get('h'))}
        if 'collectionCreate' in query:
            return {'collectionCreate': {'collection': {'id': 'gid://shopify/Collection/new-%s' % variables['input']['handle'],
                                                        'handle': variables['input']['handle']},
                                         'userErrors': []}}
        if 'collectionUpdate' in query:
            return {'collectionUpdate': {'collection': {'id': 'x'}, 'userErrors': []}}
        if 'publishablePublish' in query:
            return {'publishablePublish': {'publishable': {'id': variables['id']}, 'userErrors': []}}
        return {}
    return _Gql(answer)


def test_manage_collections_dry_run_reports_without_writing(monkeypatch):
    existing = {'festtoj': {'id': 'gid://shopify/Collection/1', 'handle': 'festtoj', 'title': 'FEST',
                            'ruleSet': {'appliedDisjunctively': False, 'rules': []}},
                'nye-ankomster': {'id': 'gid://shopify/Collection/9', 'handle': 'nye-ankomster',
                                  'ruleSet': {'rules': [{'column': 'VARIANT_PRICE', 'relation': 'GREATER_THAN',
                                                         'condition': '0'}]}}}
    gql = _collections_gql({'aw-2026': 40, 'party': 12, 'wedding': 3}, existing)
    monkeypatch.setattr(server, 'tokens', {'dk': {}})
    monkeypatch.setattr(server, '_sib_gql', gql)
    monkeypatch.setattr(server, '_sib_page', lambda store, q, k: [_node(i, 'x', 'dk', ['new']) for i in range(5)])
    rep = server._manage_taxonomy_collections('dk', dry_run=True, min_products=8)
    assert gql.mutations() == [], 'dry run must not write'
    by = {e['handle']: e for e in rep['report']}
    assert by['efteraar-vinter-2026']['action'] == 'would_create' and by['efteraar-vinter-2026']['active_count'] == 40
    assert by['festtoj']['action'] == 'would_update'
    assert by['bryllupsgaest']['action'] == 'skip_below_min' and by['bryllupsgaest']['active_count'] == 3
    assert by['maxikjoler']['action'] == 'skip_below_min'
    assert by['nye-ankomster']['action'].startswith('left_price_rule') and by['nye-ankomster']['active_count'] == 5
    assert by['nye-ankomster']['old_rules'] == ['VARIANT_PRICE GREATER_THAN 0']


def test_manage_collections_creates_publishes_and_repoints(monkeypatch):
    existing = {'tenues-de-fete': {'id': 'gid://shopify/Collection/1', 'handle': 'tenues-de-fete',
                                   'ruleSet': {'appliedDisjunctively': False, 'rules': []}},
                'nouvelles': {'id': 'gid://shopify/Collection/9', 'handle': 'nouvelles',
                              'ruleSet': {'rules': [{'column': 'VARIANT_PRICE', 'relation': 'GREATER_THAN',
                                                     'condition': '0'}]}}}
    gql = _collections_gql({'aw-2026': 40, 'party': 12}, existing)
    monkeypatch.setattr(server, 'tokens', {'fr': {}})
    monkeypatch.setattr(server, '_sib_gql', gql)
    monkeypatch.setattr(server, '_sib_page', lambda store, q, k: [_node(i, 'x', 'fr', ['new']) for i in range(30)])
    rep = server._manage_taxonomy_collections('fr', dry_run=False, min_products=8)
    by = {e['handle']: e for e in rep['report']}
    assert by['automne-hiver-2026']['action'] == 'created' and by['automne-hiver-2026']['published'] is True
    assert by['tenues-de-fete']['action'] == 'updated'
    assert by['nouvelles']['action'] == 'repointed_to_tag_new'
    creates = [v['input'] for s, q, v in gql.calls if 'collectionCreate' in q]
    assert len(creates) == 1
    c = creates[0]
    assert c['handle'] == 'automne-hiver-2026' and c['title'] == 'AUTOMNE-HIVER 2026'
    assert c['sortOrder'] == 'BEST_SELLING' and c['seo']['title'] and c['descriptionHtml'].startswith('<p>')
    assert c['ruleSet']['appliedDisjunctively'] is True
    pubs = [v for s, q, v in gql.calls if 'publishablePublish' in q]
    assert pubs == [{'id': 'gid://shopify/Collection/new-automne-hiver-2026',
                     'input': [{'publicationId': server.TAXONOMY_ONLINE_STORE_PUBLICATION['fr']}]}]
    # the creation happened BEFORE the publish, and the publish targets the created id
    order = ['create' if 'collectionCreate' in q else 'publish'
             for s, q, v in gql.calls if 'collectionCreate' in q or 'publishablePublish' in q]
    assert order == ['create', 'publish']
    updates = [v['input'] for s, q, v in gql.calls if 'collectionUpdate' in q]
    new_rule = next(u for u in updates if u['id'] == 'gid://shopify/Collection/9')
    assert new_rule['ruleSet']['rules'] == [{'column': 'TAG', 'relation': 'EQUALS', 'condition': 'new'}]
    fete = next(u for u in updates if u['id'] == 'gid://shopify/Collection/1')
    assert fete['title'] == 'TENUES DE FÊTE' and fete['ruleSet']['rules'][0]['condition'] == 'occ:party'


def test_manage_collections_leaves_manual_collections_alone(monkeypatch):
    existing = {'festtoj': {'id': 'gid://shopify/Collection/1', 'handle': 'festtoj', 'ruleSet': None}}
    gql = _collections_gql({'party': 50}, existing)
    monkeypatch.setattr(server, 'tokens', {'dk': {}})
    monkeypatch.setattr(server, '_sib_gql', gql)
    monkeypatch.setattr(server, '_sib_page', lambda store, q, k: [])
    rep = server._manage_taxonomy_collections('dk', dry_run=False, min_products=8)
    by = {e['handle']: e for e in rep['report']}
    assert by['festtoj']['action'] == 'skip_manual'
    assert by['nye-ankomster']['action'] == 'MISSING'
    assert not any('collectionUpdate' in q and v['input']['id'] == 'gid://shopify/Collection/1'
                   for s, q, v in gql.calls)


# ── HTTP layer ───────────────────────────────────────────────────────────────

def test_backfill_route_is_gated_and_status_is_open(monkeypatch, tmp_path):
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', 'unit-secret', raising=False)
    monkeypatch.delenv('DEV_LOCAL', raising=False)
    monkeypatch.setattr(server, 'TAXONOMY_BACKFILL_STATE_PATH', str(tmp_path / 'b.json'))
    monkeypatch.setattr(server, 'TAXONOMY_FILL_STATE_PATH', str(tmp_path / 'f.json'))
    client = server.app.test_client()
    r = client.post('/api/backfill_taxonomy', json={'stores': ['dk']})
    assert r.status_code in (401, 403)
    r = client.post('/api/manage_taxonomy_collections', json={'store': 'dk'})
    assert r.status_code in (401, 403)
    r = client.get('/api/taxonomy_backfill_status')
    assert r.status_code == 200 and r.get_json()['status'] == 'not run yet'
    assert r.get_json()['daily_fill'] is None
    # catalogue-shaped parts (sample titles+tags, raw error strings) only with a valid token
    import json
    with open(str(tmp_path / 'b.json'), 'w', encoding='utf-8') as f:
        json.dump({'status': 'done', 'dry_run': True, 'families_done': 1,
                   'sample': [{'family': 'Zoé', 'tags': ['cat:dress']}],
                   'errors': [{'family': 'Amélie', 'error': 'boom'}], 'failed_families': ['amelie']}, f)
    with open(str(tmp_path / 'f.json'), 'w', encoding='utf-8') as f:
        json.dump({'at': 'x', 'fill': {'families_done': 2, 'errors': [{'error': 'e'}],
                                       'failed_families': ['k']}}, f)
    anon = client.get('/api/taxonomy_backfill_status').get_json()
    assert anon['redacted'] is True and anon['families_done'] == 1
    assert anon['sample'] == 1 and anon['errors'] == 1 and anon['failed_families'] == 1
    assert anon['daily_fill']['fill']['errors'] == 1 and anon['daily_fill']['fill']['families_done'] == 2
    assert 'Zoé' not in json.dumps(anon, ensure_ascii=False) and 'boom' not in json.dumps(anon)
    full = client.get('/api/taxonomy_backfill_status',
                      headers={'X-Droplet-Token': server._mint_droplet_token()}).get_json()
    assert 'redacted' not in full
    assert full['sample'] == [{'family': 'Zoé', 'tags': ['cat:dress']}]
    assert full['daily_fill']['fill']['failed_families'] == ['k']


# ── v1.301: daily loop unlocks on live evidence, new-arrivals repoint is automatic ──

def test_live_backfill_done_accepts_live_tx_evidence(monkeypatch, tmp_path):
    monkeypatch.setattr(server, 'TAXONOMY_BACKFILL_STATE_PATH', str(tmp_path / 'absent.json'))
    monkeypatch.setattr(server, 'tokens', {'dk': {}, 'fr': {}, 'fi': {}})
    counts = {'dk': 0, 'fr': 0, 'fi': 0}
    monkeypatch.setattr(server, '_taxonomy_count_tx_active', lambda store: counts[store])
    assert server._taxonomy_live_backfill_done() is False
    counts['fr'] = server.TAXONOMY_LIVE_MIN_TAGGED
    assert server._taxonomy_live_backfill_done() is True
    # a broken count on one store never blocks the others
    def boom(store):
        if store == 'dk':
            raise RuntimeError('THROTTLED')
        return counts[store]
    monkeypatch.setattr(server, '_taxonomy_count_tx_active', boom)
    assert server._taxonomy_live_backfill_done() is True


def test_count_tx_active_uses_one_products_count_query(monkeypatch):
    seen = []
    monkeypatch.setattr(server, '_sib_gql', lambda store, q, v=None: seen.append(q) or {'c': {'count': 2693}})
    assert server._taxonomy_count_tx_active('dk') == 2693
    assert len(seen) == 1 and 'productsCount' in seen[0] and server.TX_TAG in seen[0] and 'status:active' in seen[0]


def test_repoint_new_arrivals_only_above_min(monkeypatch):
    calls = []
    node = {'id': 'gid://shopify/Collection/1',
            'ruleSet': {'rules': [{'column': 'VARIANT_PRICE', 'relation': 'GREATER_THAN', 'condition': '50'}]}}

    def gql(store, query, variables=None):
        calls.append(query)
        if 'collectionByHandle' in query:
            return {'collectionByHandle': node}
        if 'collectionUpdate' in query:
            return {'collectionUpdate': {'userErrors': []}}
        return {}
    monkeypatch.setattr(server, '_sib_gql', gql)
    monkeypatch.setattr(server, '_taxonomy_count_new_active', lambda store: server.NEW_ARRIVALS_MIN - 1)
    ent = server._taxonomy_repoint_new_arrivals('dk', dry_run=False)
    assert ent['action'].startswith('left_price_rule') and not any('collectionUpdate' in q for q in calls)
    monkeypatch.setattr(server, '_taxonomy_count_new_active', lambda store: server.NEW_ARRIVALS_MIN)
    ent = server._taxonomy_repoint_new_arrivals('dk', dry_run=True)
    assert ent['action'] == 'would_repoint_to_tag_new' and not any('collectionUpdate' in q for q in calls)
    ent = server._taxonomy_repoint_new_arrivals('dk', dry_run=False)
    assert ent['action'] == 'repointed_to_tag_new' and any('collectionUpdate' in q for q in calls)
    # already repointed → no second write
    node['ruleSet'] = {'rules': [{'column': 'TAG', 'relation': 'EQUALS', 'condition': server.NEW_TAG}]}
    n = len(calls)
    assert server._taxonomy_repoint_new_arrivals('dk', dry_run=False)['action'] == 'already_tag_new'
    assert not any('collectionUpdate' in q for q in calls[n:])
