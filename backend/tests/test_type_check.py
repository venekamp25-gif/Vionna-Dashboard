# -*- coding: utf-8 -*-
"""Import type check (v1.324).

Carina, 30 Sep 2026: the competitor page (chic-parisien "Dejana") had the title
and description of a moccasin, but its own product_type "Dress Pants Women",
its tags, its XS–XL sizes and its photos all showed trousers. The import took
the title, so 24 listings went live as shoes in three languages. The type is
now decided at import from the competitor's own fields and, when those
disagree, from the photos — before keywords and copy are made.
"""
import json

import pytest

import server

# The real Dejana page (fields as its products/<handle>.json returned them).
DEJANA = {
    'title': 'Dejana | Mocassins confortables et élégants pour femmes',
    'handle': 'dejana',
    'body_html': '<p>Ces mocassins allient confort et élégance. Semelle antidérapante, '
                 'dessus souple, parfaits pour le bureau comme pour le week-end.</p>',
    'product_type': 'Dress Pants Women',
    'tags': 'pants women, womens',
    'options': [{'name': 'Couleur', 'values': ['Noir', 'Beige', 'Kaki']},
                {'name': 'Taille', 'values': ['XS', 'S', 'M', 'L', 'XL']}],
    'images': ['https://cdn.shopify.com/a.jpg', 'https://cdn.shopify.com/b.jpg', 'https://cdn.shopify.com/c.jpg'],
}


# ── one lexicon for titles, types, tags and keywords ───────────────────────
@pytest.mark.parametrize('text,cat', [
    ('Dejana | Mocassins confortables et élégants pour femmes', 'shoes'),
    ('Dress Pants Women', 'pants'),                  # "dress" is a modifier here
    ('pants women, womens', 'pants'),
    ('Jupe Bodycon', 'skirt'), ('Chemise en jean', 'top'), ('Veste en jean', 'outerwear'),
    ('Strikkjole', 'dress'), ('Short Sleeve Top', 'top'), ('Skotskternet kjole', 'dress'),
    ('Pull-on pants', 'pants'), ('Min garderobe', None), ('Pull en maille chameau', 'knitwear'),
    ('Neuletakki', 'knitwear'), ('Villapaita', 'knitwear'), ('Robe pull', 'dress'),
    ('Bæltetaske', 'accessory'), ('Robe ceinturée', 'dress'), ('Solbriller', 'accessory'),
    ('Bikini top', 'swim'), ('Buksedragt', 'dress'), ('Farkkushortsit', 'skirt'),
    ('Pantalon taille haute', 'pants'), ('Strikbukser', 'pants'), ('Strikjakke', 'knitwear'),
    ('Jeansjakke', 'outerwear'), ('Short Jacket', 'outerwear'), ('Short Faux Fur Jacket', 'outerwear'),
    ('Short en lin', 'skirt'), ('Denim Shorts', 'skirt'), ('Sweatpants', 'pants'),
    ('Jupe ballerine', 'skirt'), ('Ballerines', 'shoes'), ('Hjemmesko', 'shoes'), ('Disko top', 'top'),
    ('Pantoufles', 'shoes'), ('Sandales à talon', 'shoes'), ('Bottes à talon haut', 'shoes'),
    ('High-top sneakers', 'shoes'), ('Bootcut jeans', 'pants'), ('Kitten heel mules', 'shoes'),
    ('Combinaison', 'dress'), ('Blazer dress', 'dress'), ('Shirt jacket', 'outerwear'),
    ('Korkokengät', 'shoes'), ('Kynähame', 'skirt'), ('Housut', 'pants'), ('Mekko', 'dress'),
    ('Robe portefeuille', 'dress'), ('Doudoune à ceinture', 'outerwear'), ('Oxford shirt', 'top'),
    ('Tøj og Tilbehør > Beklædning > Kjoler', 'dress'), ('Women', None), ('Vêtements', None),
    ('summersale', None), ('Marimekko tasche', None),
    # review of v1.324 (real survey titles)
    ('Nora | Naisten talvikenkiä', 'shoes'), ('Tamaris Ballarina sort', 'shoes'), ('Mokkasiner', 'shoes'),
    ('Moccasins', 'shoes'), ('Mokassins', 'shoes'), ('Handschuhe', 'accessory'), ('handschoenen', 'accessory'),
    ('Veste jean oversize', 'outerwear'), ('Jean jacket', 'outerwear'), ('Bonnet tricoté côtelé', 'accessory'),
    ('Strikhue med ribkant', 'accessory'), ('Neulepipo', 'accessory'), ('Pull à col écharpe', 'knitwear'),
    ('gode egenskaber', None), ('garde-robe', None), ('Knit sneakers', 'shoes'),
])
def test_garment_cat(text, cat):
    assert server._garment_cat(text) == cat


# ── the deterministic signals ──────────────────────────────────────────────
def test_carina_is_a_hard_conflict():
    sig = server._type_signals(DEJANA)
    assert sig == {'title': 'shoes', 'product_type': 'pants', 'tags': 'pants',
                   'description': 'shoes', 'sizes': 'alpha'}
    assert server._type_text_verdict(sig) == ('shoes', True)


def test_moccasins_in_clothing_sizes_conflict_even_without_type_or_tags():
    p = dict(DEJANA, product_type='', tags='')
    assert server._type_text_verdict(server._type_signals(p)) == ('shoes', True)
    # the same in French clothing sizes 36/38/40/42/44
    p = dict(p, options=[{'name': 'Taille', 'values': ['36', '38', '40', '42', '44']}])
    assert server._type_text_verdict(server._type_signals(p)) == ('shoes', True)


def test_the_description_alone_never_decides():
    # "egenskaber", "garde-robe", "pendant": prose is noisy — a type only the
    # description names goes to the photos, the description only backs them
    p = {'title': 'Nora', 'body_html': 'Mukavat talvikengät arkeen', 'images': ['https://x/a.jpg']}
    assert server._type_text_verdict(server._type_signals(p)) == (None, False)
    fake, calls = _vision({'category': 'shoes', 'confidence': 'medium'})
    r = server._resolve_type(p, vision=fake)
    assert (r['category'], r['decided_by'], r['misleading']) == ('shoes', 'photos', []) and calls
    fake, _ = _vision({'category': 'dress', 'confidence': 'high'})
    assert server._resolve_type(p, vision=fake)['misleading'] == ['description']


@pytest.mark.parametrize('title,ptype,tags', [
    ('Stephanie Asymmetric Knit Mini Dress', 'Knitwear', ''),   # anything knitted may be typed Knitwear
    ('Aubin | Short cargo', 'Pants', ''),                        # shorts are "Pants" at many shops
    ('Evadne Button Down Jersey Cardigan', 'Tops', 'pants'),     # tags only vote when title or type is silent
])
def test_overlapping_types_are_not_a_conflict(title, ptype, tags):
    p = {'title': title, 'product_type': ptype, 'tags': tags,
         'options': [{'name': 'Size', 'values': ['S', 'M', 'L']}]}
    assert server._type_text_verdict(server._type_signals(p))[1] is False


def test_size_evidence():
    ev = server._size_evidence
    assert ev([{'name': 'Taille', 'values': ['XS', 'S', 'M', 'L', 'XL']}]) == 'alpha'
    assert ev([{'name': 'Pointure', 'values': ['36', '37', '38']}]) == 'shoe'
    assert ev([{'name': 'Taille', 'values': ['36', '38', '40']}]) == 'even'      # FR clothing: never shoe sizes
    assert ev([{'name': 'Taille', 'values': ['36', '37', '38', '39']}]) == 'numeric'  # shoes or jeans: no vote
    assert ev([{'name': 'Taille', 'values': ['36', '38']}]) == 'numeric'          # too short to tell
    assert ev([{'name': 'Size', 'values': ['One Size']}]) == 'one-size'
    assert ev([{'name': 'Couleur', 'values': ['Noir']}]) is None


# ── the decision ───────────────────────────────────────────────────────────
def _vision(answer=None, error=None):
    calls = []

    def fake(urls):
        calls.append(urls)
        if error:
            raise error
        return dict({'item': 'wide-leg trousers', 'evidence': 'the trousers change colour'}, **answer)
    return fake, calls


def test_carina_photos_decide_trousers_and_name_the_misleading_fields():
    fake, calls = _vision({'category': 'pants', 'confidence': 'high'})
    r = server._resolve_type(DEJANA, vision=fake)
    assert (r['category'], r['decided_by']) == ('pants', 'photos')
    assert r['misleading'] == ['title', 'description']
    assert calls == [DEJANA['images']]


def test_failed_photo_check_is_never_agreement():
    fake, _ = _vision(error=RuntimeError('429 rate limited'))
    r = server._resolve_type(DEJANA, vision=fake)
    assert r['decided_by'] == 'operator' and r['category'] is None
    assert '429' in r['vision_error']
    assert r['candidates'][0] == {'category': 'pants', 'sources': ['product_type', 'tags', 'sizes']}
    assert r['candidates'][1] == {'category': 'shoes', 'sources': ['title', 'description']}


def test_unsure_or_unbacked_photos_go_to_the_operator():
    fake, _ = _vision({'category': 'pants', 'confidence': 'low'})
    assert server._resolve_type(DEJANA, vision=fake)['decided_by'] == 'operator'
    # a sure "dress" that none of the competitor's own fields backs: ask
    fake, _ = _vision({'category': 'dress', 'confidence': 'high'})
    r = server._resolve_type(DEJANA, vision=fake)
    assert r['decided_by'] == 'operator'
    assert {'category': 'dress', 'sources': ['photos']} in r['candidates']


def test_sizes_back_sure_photos_when_every_text_field_names_shoes():
    p = dict(DEJANA, product_type='', tags='')
    fake, _ = _vision({'category': 'pants', 'confidence': 'high'})
    r = server._resolve_type(p, vision=fake)
    assert (r['category'], r['decided_by'], r['misleading']) == ('pants', 'photos', ['title', 'description'])
    fake, _ = _vision({'category': 'pants', 'confidence': 'medium'})
    assert server._resolve_type(p, vision=fake)['decided_by'] == 'operator'


def test_agreeing_text_needs_no_photo_check():
    fake, calls = _vision({'category': 'shoes', 'confidence': 'high'})
    r = server._resolve_type({'title': 'Robe longue fleurie', 'product_type': 'Robes',
                              'options': [{'name': 'Taille', 'values': ['S', 'M']}], 'images': ['https://x/a.jpg']},
                             vision=fake)
    assert (r['category'], r['decided_by'], r['conflict']) == ('dress', 'text', False)
    assert calls == []


def test_a_title_without_type_asks_the_photos_but_never_guesses():
    p = {'title': 'Dejana', 'images': ['https://x/a.jpg']}
    fake, _ = _vision({'category': 'pants', 'confidence': 'medium'})
    assert server._resolve_type(p, vision=fake)['decided_by'] == 'photos'
    fake, _ = _vision({'category': 'pants', 'confidence': 'low'})
    r = server._resolve_type(p, vision=fake)
    assert (r['category'], r['decided_by']) == (None, 'unknown')      # publish decides, as before
    fake, _ = _vision(error=TimeoutError('timeout'))
    assert server._resolve_type(p, vision=fake)['decided_by'] == 'unchecked'   # said, never silent


@pytest.mark.parametrize('cat,guess,token', [
    ('pants', '', 'trousers'), ('pants', 'shoes', 'trousers'), ('outerwear', 'coat', 'coat'),
    ('accessory', 'sunglasses', 'sunglasses'), ('accessory', 'watch', 'watch'), ('knitwear', 'cardigan', 'cardigan'),
    (None, 'dress', 'dress'), ('shoes', '', 'shoes'),
])
def test_type_token(cat, guess, token):
    assert server._type_token(cat, guess) == token


def _client(monkeypatch):
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', None)
    monkeypatch.setenv('DEV_LOCAL', '1')
    server.app.config['TESTING'] = True
    return server.app.test_client()


def test_resolve_route(monkeypatch):
    monkeypatch.setattr(server, '_type_vision', lambda urls: {'category': 'pants', 'item': 'trousers',
                                                               'confidence': 'high', 'evidence': ''})
    # _resolve_type's default argument was bound at import: call through the route
    monkeypatch.setattr(server, '_resolve_type',
                        lambda p, vision=None, _r=server._resolve_type: _r(p, vision=server._type_vision))
    with _client(monkeypatch) as c:
        body = c.post('/api/resolve_type', json=dict(DEJANA, guess='')).get_json()
    assert (body['category'], body['decided_by'], body['product_type']) == ('pants', 'photos', 'trousers')


def test_resolve_route_is_gated():
    assert server.app.view_functions['api_resolve_type'].__dict__.get('__wrapped__') is not None \
        or 'require_droplet_token' in open(server.__file__, encoding='utf-8').read().split(
            "@app.route('/api/resolve_type'")[1].split('def ')[0]


# ── everything downstream follows the decided type ─────────────────────────
def test_research_seeds_on_the_type_and_drops_other_kinds(monkeypatch):
    seen = {}

    def seeds(title, name, category, desc, stores=None):
        seen.update(title=title, category=category)
        return {'fr': ['pantalon femme']}
    monkeypatch.setattr(server, '_dfs_configured', lambda: True)
    monkeypatch.setattr(server, '_derive_seeds_llm', seeds)
    monkeypatch.setattr(server, '_dfs_keyword_suggestions', lambda seed, st, min_volume=0, limit=20: [
        {'keyword': 'mocassins femme', 'volume': 9900}, {'keyword': 'pantalon femme', 'volume': 8100},
        {'keyword': 'pantalon large femme', 'volume': 2400}, {'keyword': 'tenue bureau femme', 'volume': 900}])
    monkeypatch.setattr(server, '_dfs_clean_keywords_llm', lambda kws, st, **k: kws)
    monkeypatch.setattr(server, '_recommend_keywords', lambda kws, st, top_n=6: kws)
    with _client(monkeypatch) as c:
        body = c.post('/api/research_keywords', json={
            'stores': ['fr'], 'product_name': 'Carina', 'competitor_title': '', 'category': 'pants',
            'product_type': 'trousers', 'description': 'Dress Pants Women', 'min_volume': 100}).get_json()
    res = body['results']['fr']
    assert seen == {'title': '', 'category': 'trousers'}
    assert [k['keyword'] for k in res['keywords']] == ['pantalon femme', 'pantalon large femme', 'tenue bureau femme']
    assert res['type_dropped'] == 1 and res['product_type'] == 'pants'


def test_seed_prompt_carries_the_type_rule(monkeypatch):
    captured = {}

    class _Msg:
        content = [type('T', (), {'text': '{"fr": ["pantalon"]}'})()]

    class _Client:
        def __init__(self, api_key=None):
            self.messages = self

        def create(self, **kw):
            captured['prompt'] = kw['messages'][0]['content']
            return _Msg()
    import anthropic
    monkeypatch.setattr(anthropic, 'Anthropic', _Client)
    monkeypatch.setattr(server, 'ANTHROPIC_KEY', 'test-key')
    server._derive_seeds_llm('', 'Carina', 'trousers', '', stores=['fr'])
    assert 'The garment TYPE is "trousers"' in captured['prompt']
    server._derive_seeds_llm('Robe', 'Carina', '', '', stores=['fr'])
    assert 'garment TYPE is' not in captured['prompt']            # no type sent: the old prompt


class _Writer:
    """Fake Anthropic: answers in turn, records every prompt."""

    def __init__(self, answers):
        self.answers, self.prompts = list(answers), []

    def install(self, monkeypatch):
        writer = self

        class _Client:
            def __init__(self, api_key=None):
                self.messages = self

            def create(self, **kw):
                writer.prompts.append(kw['messages'][0]['content'])
                a = writer.answers.pop(0)
                if isinstance(a, Exception):
                    raise a
                return type('M', (), {'content': [type('T', (), {'text': json.dumps(a)})()]})()
        import anthropic
        monkeypatch.setattr(anthropic, 'Anthropic', _Client)
        monkeypatch.setattr(server, 'ANTHROPIC_KEY', 'test-key')


SHOE = {'description': 'Carina er bløde mokasiner.', 'meta_description': 'Mokasiner', 'm_title_specs': 'Bløde mokasiner til hverdag'}
PANTS = {'description': 'Carina er elegante bukser.', 'meta_description': 'Bukser', 'm_title_specs': 'Elegante bukser med høj talje'}
CARINA_GEN = {'store': 'dk', 'product_name': 'Carina', 'product_title': DEJANA['title'], 'keywords': ['bukser dame'],
              'source_text': 'Dress Pants Women pants women, womens', 'product_type': 'trousers',
              'garment_category': 'pants', 'type_source_misleading': ['title', 'description']}


def test_writer_gets_the_type_and_never_the_misleading_title(monkeypatch):
    w = _Writer([PANTS])
    w.install(monkeypatch)
    with _client(monkeypatch) as c:
        body = c.post('/api/generate', json=CARINA_GEN).get_json()
    assert 'Producttype (vastgesteld' in w.prompts[0] and 'trousers' in w.prompts[0]
    assert 'Mocassins' not in w.prompts[0] and 'per ongeluk een ANDER' in w.prompts[0]
    assert body['m_title_specs'] == PANTS['m_title_specs'] and 'type_mismatch' not in body


def test_writer_that_names_another_type_gets_one_retry(monkeypatch):
    w = _Writer([SHOE, PANTS])
    w.install(monkeypatch)
    with _client(monkeypatch) as c:
        body = c.post('/api/generate', json=CARINA_GEN).get_json()
    assert len(w.prompts) == 2 and 'LET OP' in w.prompts[1]
    assert body['m_title_specs'] == PANTS['m_title_specs'] and 'type_mismatch' not in body


@pytest.mark.parametrize('second', [SHOE, RuntimeError('429')])
def test_a_failed_retry_keeps_the_first_answer_flagged(monkeypatch, second):
    w = _Writer([SHOE, second])
    w.install(monkeypatch)
    with _client(monkeypatch) as c:
        body = c.post('/api/generate', json=CARINA_GEN).get_json()
    assert body['m_title_specs'] == SHOE['m_title_specs'] and body['type_mismatch'] == 'shoes'


def test_misleading_sources_keep_the_fabric_guard_on(monkeypatch):
    w = _Writer([PANTS])
    w.install(monkeypatch)
    with _client(monkeypatch) as c:
        c.post('/api/generate', json=dict(CARINA_GEN, source_text='', keywords=['bukser dame', 'uld bukser']))
    kw_line = w.prompts[0].split('Keywords')[1].split('\n')[0]
    assert 'uld' not in kw_line and 'bukser dame' in kw_line


def test_old_callers_without_a_type_get_the_old_prompt(monkeypatch):
    w = _Writer([SHOE])
    w.install(monkeypatch)
    with _client(monkeypatch) as c:
        body = c.post('/api/generate', json={'store': 'dk', 'product_name': 'Cecilie',
                                             'product_title': 'Mocassins', 'keywords': []}).get_json()
    assert 'Producttype (vastgesteld' not in w.prompts[0] and 'Mocassins' in w.prompts[0]
    assert len(w.prompts) == 1 and 'type_mismatch' not in body


def test_a_type_fix_gets_a_fresh_taxonomy_verdict(monkeypatch):
    calls = []

    def classify(title, description, image_url=None, category=None):
        calls.append(category)
        return {'category': category, 'sub': None}
    monkeypatch.setattr(server, '_TAXONOMY_MEMO', {})
    monkeypatch.setattr(server, '_classify_taxonomy_llm', classify)
    server._taxonomy_for_family('Carina', 'x', category='shoes')
    server._taxonomy_for_family('Carina', 'x', category='shoes')
    server._taxonomy_for_family('Carina', 'x', category='pants')
    assert calls == ['shoes', 'pants']


def test_publish_uses_the_settled_category_unless_the_operator_retyped_it():
    f = server._category_for_publish
    assert f({'category': 'pants', 'product_type': 'trousers'}, 'Carina') == 'pants'
    assert f({'category': 'pants', 'product_type': 'Wide leg'}, 'Carina') == 'pants'      # no type word
    assert f({'category': 'knitwear', 'product_type': 'cardigan top'}, 'Vera') == 'knitwear'  # overlap
    assert f({'category': 'pants', 'product_type': 'shoes'}, 'Carina') == 'shoes'          # re-typed in Review


def test_german_chart_headers_are_translated_completely():
    # Virginie (30 Sep): "Brustumfang" stayed German on the DK/FR/FI charts
    import re as _re
    chart = {'headers': ['Größe', 'Brustumfang (cm)', 'Länge (cm)', 'Ärmellänge (cm)', 'Schulterbreite (cm)'],
             'rows': [['S', '88', '60', '58', '38']]}
    for store, bust in (('dk', 'Brystomfang (cm)'), ('fr', 'Tour de poitrine (cm)'), ('fi', 'Rinnanympärys (cm)')):
        heads = _re.findall(r'<th[^>]*>(.*?)</th>', server._size_chart_html(chart, store))
        assert bust in heads, (store, heads)
        assert not any(w in ' '.join(heads) for w in ('Brust', 'Größe', 'Länge')), heads


def test_plural_only_garments_get_a_grammar_hint(monkeypatch):
    # the Carina repair came back as "Carina er en bukser" — bukser is plural
    w = _Writer([PANTS])
    w.install(monkeypatch)
    with _client(monkeypatch) as c:
        c.post('/api/generate', json=CARINA_GEN)
    assert 'et par bukser' in w.prompts[0]
    w = _Writer([PANTS])
    w.install(monkeypatch)
    with _client(monkeypatch) as c:
        c.post('/api/generate', json=dict(CARINA_GEN, store='fr'))
    assert 'et par bukser' not in w.prompts[0]          # French "pantalon" is singular



def test_photo_urls_never_reach_the_droplets_own_network(monkeypatch):
    fetched = []
    monkeypatch.setattr(server, 'ANTHROPIC_KEY', 'test-key')
    monkeypatch.setattr(server, '_scrape_get', lambda url, timeout=10: fetched.append(url))
    monkeypatch.setattr(server, '_public_host_ok', lambda h: h == 'cdn.shopify.com')
    with pytest.raises(RuntimeError, match='no usable photos'):
        server._type_vision(['http://127.0.0.1:5000/api/x', 'http://169.254.169.254/metadata/v1.json'])
    assert fetched == []


def test_a_malformed_body_is_not_a_500(monkeypatch):
    monkeypatch.setattr(server, '_type_vision', lambda urls: (_ for _ in ()).throw(RuntimeError('no photos')))
    with _client(monkeypatch) as c:
        for body in ({'options': ['Size'], 'tags': {'a': 1}, 'guess': ['x'], 'images': 'x'}, [], 'x',
                     {'title': 5, 'options': [{'name': 'Size', 'values': 'S'}]}):
            r = c.post('/api/resolve_type', json=body)
            assert r.status_code == 200, (body, r.status_code)


def test_generate_follows_a_product_type_retyped_in_review(monkeypatch):
    # the import said trousers, the operator re-typed "shoes": the writer and
    # the check both follow the new word (as publish does)
    w = _Writer([{'description': 'Carina er et par sko.', 'meta_description': 'Sko', 'm_title_specs': 'Bløde sko til hverdag'}])
    w.install(monkeypatch)
    with _client(monkeypatch) as c:
        body = c.post('/api/generate', json=dict(CARINA_GEN, product_type='shoes')).get_json()
    assert 'type_mismatch' not in body and len(w.prompts) == 1
