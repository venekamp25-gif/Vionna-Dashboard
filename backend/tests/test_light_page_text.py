# -*- coding: utf-8 -*-
"""v1.310: the competitor's description is read from the product PAGE when the
.json has none, and power/sensor claims are verified like specs.

venek, 2026-09-25: aorabrand.co's Aoraglow has an EMPTY body_html — the whole
story (plugs into any outlet, dusk-to-dawn sensor, two watts) lives in theme
sections on the page. The copy then called a plug-in lamp "oplaadbaar en
draadloos" (from the style example) and nothing caught it.
"""
import json

import pytest

import server

PAGE = """<html><head>
<meta name="description" content="Aoraglow turns any outlet into a warm wall sconce. Dusk-to-dawn sensor, no wiring.">
<script type="application/ld+json">{"@type":"Product","name":"Aoraglow","description":"Plug-in wall light with sensor."}</script>
</head><body>
<header><nav>Skip to content Menu Cart Log in</nav></header>
<main id="MainContent">
  <h1>Aoraglow</h1>
  <p>Designer wall light, no wiring, no electrician</p>
  <div class="product__text">Plug it in and a clean beam climbs the wall while a soft pool settles beneath it.</div>
  <ul><li>Two watts, cool to the touch</li><li>On at dusk, off at dawn</li></ul>
  <button>Add to cart</button>
  <section class="related-products"><a href="/products/cashmere-throw">Cashmere throw, 100% wool</a></section>
  <div class="card"><a href="/products/other-lamp"><span>Other lamp, rechargeable and cordless</span></a></div>
  <a href="/products/glow?variant=2">Aoraglow in Soft White</a>
</main>
<footer>© 2026 Aora. Privacy policy</footer>
<script>var x = "rechargeable script text";</script>
</body></html>"""


def test_page_text_keeps_the_product_and_drops_nav_footer_scripts_and_other_products():
    t = server._page_text_from_html(PAGE, handle='glow')
    assert t.startswith('Aoraglow turns any outlet into a warm wall sconce.')
    assert 'Plug-in wall light with sensor.' in t
    assert 'Plug it in and a clean beam' in t and 'Two watts' in t and 'On at dusk' in t
    assert 'Aoraglow in Soft White' in t                     # a link to THIS product stays
    for noise in ('Skip to content', 'Add to cart', 'Privacy policy', 'rechargeable script text',
                  'Cashmere', 'Other lamp', 'wool'):
        assert noise not in t, noise
    assert server._page_text_from_html('', handle='x') == ''
    assert server._page_text_from_html('<html><body><main></main></body></html>') == ''


def test_page_text_only_when_the_json_body_is_thin():
    thin = {'body_html': '<p>Aoraglow</p>', 'handle': 'glow'}
    txt, status = server._page_text_for(thin, PAGE, None)
    assert status == 'page' and 'Two watts' in txt
    full = {'body_html': '<p>' + 'A real description with plenty of words. ' * 10 + '</p>', 'handle': 'glow'}
    assert server._page_text_for(full, PAGE, None) == (None, 'json')
    assert server._page_text_for(thin, None, None) == (None, 'unavailable')


def test_page_text_fetch_status_when_the_shop_refuses_us(monkeypatch):
    class R:
        status_code = 429
        text = ''
    monkeypatch.setattr(server, '_scrape_get', lambda url, timeout=10, **kw: R())
    assert server._page_text_for({'body_html': '', 'handle': 'glow'}, None, 'https://x/products/glow') == (None, 'rate_limited')


def test_scrape_manual_reads_the_page_html_from_the_browser(monkeypatch):
    monkeypatch.setenv('DEV_LOCAL', '1')
    product = {'product': {'title': 'Aoraglow', 'handle': 'glow', 'body_html': '',
                           'options': [{'name': 'Color', 'values': ['Black']}],
                           'variants': [{'id': 1, 'option1': 'Black', 'price': '39.00'}],
                           'images': [{'id': 1, 'src': 'https://cdn.shopify.com/x.jpg'}]}}
    body = server.app.test_client().post('/api/scrape_manual', json={
        'json': json.dumps(product), 'source': 'browser', 'html': PAGE}).get_json()
    assert body['page_text_status'] == 'page' and 'Two watts' in body['page_text']
    body = server.app.test_client().post('/api/scrape_manual', json={
        'json': json.dumps(product), 'source': 'browser'}).get_json()
    assert body['page_text_status'] == 'unavailable' and body['page_text'] is None


# ── power claims ───────────────────────────────────────────────────────────
def test_power_and_sensor_words_are_claims():
    c = server._light_spec_claims('De PLUGIFY Aora is een oplaadbare draadloze lamp met schemersensor.')
    assert {'oplaadbaar', 'draadloos', 'sensor'} <= c
    assert 'stopcontact' in server._light_spec_claims('Plug it in: turns any outlet into a sconce.')
    assert 'oplaadbaar' in server._light_spec_claims('Wiederaufladbare Akku-Lampe, kabellos.')
    assert 'draadloos' in server._light_spec_claims('Wiederaufladbare Akku-Lampe, kabellos.')
    # "no wiring / ohne Kabel" is about the electrician, not a cordless claim
    assert 'draadloos' not in server._light_spec_claims('No wiring, no electrician. Ohne Kabel.')


def test_unverified_power_claim_against_a_plug_in_source():
    src = 'Aoraglow turns any outlet into a warm wall sconce. Plug it in. Dusk-to-dawn sensor.'
    ours = 'De Aora is een oplaadbare draadloze lamp met sensor voor in het stopcontact.'
    assert server._light_unverified_claims(ours, src) == ['draadloos', 'oplaadbaar']


def test_power_conflict_for_keywords():
    assert server._light_power_conflict('oplaadbare lamp', 'socket') is True
    assert server._light_power_conflict('draadloze lamp', 'socket') is True
    assert server._light_power_conflict('stekkerlamp warm licht', 'socket') is False
    assert server._light_power_conflict('stekkerlamp', 'rechargeable') is True
    assert server._light_power_conflict('oplaadbare lamp', 'rechargeable') is False
    assert server._light_power_conflict('oplaadbare lamp', '') is False      # unknown never blocks


def test_research_drops_keywords_claiming_the_wrong_power(monkeypatch):
    monkeypatch.setattr(server, '_dfs_configured', lambda: True)
    monkeypatch.setattr(server, '_dfs_keyword_suggestions', lambda seed, st, min_volume=0, limit=20: [
        {'keyword': 'stekkerlamp', 'volume': 900}, {'keyword': 'oplaadbare lamp', 'volume': 5000},
        {'keyword': 'draadloze lamp', 'volume': 4000}])
    monkeypatch.setattr(server, '_dfs_clean_keywords_llm', lambda kws, st, **k: kws)
    monkeypatch.setattr(server, '_recommend_keywords', lambda kws, st, top_n=6: kws)
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', None)
    monkeypatch.setenv('DEV_LOCAL', '1')
    server.app.config['TESTING'] = True
    with server.app.test_client() as c:
        body = c.post('/api/research_keywords', json={
            'stores': ['nl'], 'product_name': 'X', 'competitor_title': 'Aoraglow', 'category': 'Stekkerlamp',
            'min_volume': 100, 'seed_terms': {'nl': ['stekkerlamp']}, 'power': 'socket'}).get_json()
    r = body['results']['nl']
    assert [k['keyword'] for k in r['keywords']] == ['stekkerlamp']
    assert r['type_dropped'] == 2


# ── copy: a power claim the source never made gets the retry and the flag ──
class _FakeClient:
    answers = []
    prompts = []
    systems = []

    def __init__(self, api_key=None):
        self.messages = self

    def create(self, **kw):
        _FakeClient.prompts.append(kw['messages'][0]['content'])
        _FakeClient.systems.append(kw.get('system'))
        a = _FakeClient.answers.pop(0)
        return type('M', (), {'content': [type('T', (), {'text': a if isinstance(a, str) else json.dumps(a)})()]})()


@pytest.fixture()
def gen(monkeypatch):
    import anthropic
    monkeypatch.setattr(anthropic, 'Anthropic', _FakeClient)
    monkeypatch.setattr(server, 'ANTHROPIC_KEY', 'test-key')
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', None)
    monkeypatch.setenv('DEV_LOCAL', '1')
    _FakeClient.answers, _FakeClient.prompts, _FakeClient.systems = [], [], []
    server.app.config['TESTING'] = True

    def run(store='de', source_text='Aoraglow turns any outlet into a warm wall sconce. Plug it in. Dusk-to-dawn sensor.',
            brief=None, product_type='Stekkerlamp'):
        with server.app.test_client() as c:
            return c.post('/api/lighting/generate', json={
                'store': store, 'product_name': 'PLUGIFY Aora', 'product_title': 'Aoraglow',
                'product_type': product_type, 'source_text': source_text, 'keywords': [],
                'brief': brief if brief is not None else {
                    'family': 'plugin', 'type': {'nl': 'stekkerlamp', 'de': 'Steckdosenlampe', 'com': 'plug-in light'},
                    'what': 'Een lamp die je in het stopcontact steekt.', 'power': 'socket',
                    'placement': 'stopcontact', 'features': ['schemersensor']}}).get_json()
    return run


RECHARGEABLE_DE = ('Die PLUGIFY Aora ist eine wiederaufladbare kabellose Akku-Lampe, die du überall hinstellst: '
                   'auf die Kommode, neben das Bett oder auf den Esstisch. Einfach aufstellen und einschalten.')
PLUGIN_DE = ('Die PLUGIFY Aora ist eine Steckdosenlampe, die du direkt in die Steckdose steckst. Ein Lichtstrahl '
             'nach oben, ein Lichtkegel nach unten. Sie schaltet sich bei Dämmerung selbst ein und morgens wieder aus.')


def test_rechargeable_claim_for_a_plug_in_lamp_is_retried_and_corrected(gen):
    _FakeClient.answers = [
        {'description': RECHARGEABLE_DE, 'meta_description': 'a', 'm_title_specs': 'b'},
        {'description': PLUGIN_DE, 'meta_description': 'Steckdosenlampe mit Sensor', 'm_title_specs': 'b'},
    ]
    body = gen('de')
    assert len(_FakeClient.prompts) == 2
    assert "je beweert 'draadloos, oplaadbaar'" in _FakeClient.prompts[1]
    assert body['description'] == PLUGIN_DE and not body.get('claim_mismatch')
    assert _FakeClient.systems[0].startswith('Du bist Texter') and 'AUSSCHLIESSLICH auf Deutsch' in _FakeClient.systems[0]


def test_claim_that_survives_the_retry_is_flagged(gen):
    _FakeClient.answers = [
        {'description': RECHARGEABLE_DE, 'meta_description': 'a', 'm_title_specs': 'b'},
        {'description': RECHARGEABLE_DE, 'meta_description': 'a', 'm_title_specs': 'b'},
    ]
    body = gen('de')
    assert body['claim_mismatch'] == ['draadloos', 'oplaadbaar']
    assert 'oplaadbaar' in body['unverified_claims']


def test_a_rechargeable_lamp_may_say_rechargeable_and_cordless(gen):
    _FakeClient.answers = [{'description': RECHARGEABLE_DE, 'meta_description': 'a', 'm_title_specs': 'b'}]
    body = gen('de', source_text='Oplaadbare lamp, 8 uur licht per lading.',
               brief={'family': 'table', 'type': {'nl': 'oplaadbare tafellamp', 'de': 'Akku-Tischlampe', 'com': 'x'},
                      'what': 'Een oplaadbare lamp.', 'power': 'rechargeable', 'placement': 'tafel', 'features': []})
    assert len(_FakeClient.prompts) == 1 and not body.get('claim_mismatch')


def test_thin_source_gets_the_no_invention_rule(gen):
    _FakeClient.answers = [{'description': PLUGIN_DE, 'meta_description': 'a', 'm_title_specs': 'b'}]
    gen('de', source_text='Aoraglow')
    assert 'GEEN beschrijving' in _FakeClient.prompts[0] and 'Verzin dan ook GEEN eigenschappen' in _FakeClient.prompts[0]
    _FakeClient.answers, _FakeClient.prompts = [{'description': PLUGIN_DE, 'meta_description': 'a', 'm_title_specs': 'b'}], []
    gen('de')
    assert 'GEEN beschrijving' not in _FakeClient.prompts[0] and 'alleen over als de bron ze noemt' in _FakeClient.prompts[0]


def test_no_socket_needed_for_a_plug_in_lamp_is_a_contradiction(gen):
    """The user's own screenshot: 'Geen stopcontact nodig' for a lamp the source plugs in."""
    contra = ('Die PLUGIFY Aora ist eine Lampe, die du überall hinstellst: auf die Kommode, neben das Bett oder auf '
              'den Esstisch. Keine Steckdose nötig, einfach aufstellen und einschalten, jeden Abend aufs Neue.')
    _FakeClient.answers = [
        {'description': contra, 'meta_description': 'a', 'm_title_specs': 'b'},
        {'description': contra, 'meta_description': 'a', 'm_title_specs': 'b'},
    ]
    body = gen('de')
    assert "je beweert 'geen stopcontact'" in _FakeClient.prompts[1]
    assert body['claim_mismatch'] == ['geen stopcontact']
    assert 'not:stopcontact' in server._light_spec_claims('Geen stopcontact nodig, gewoon neerzetten en aan.')


def test_wattage_written_in_words_is_a_spec():
    assert 'w2' in server._light_spec_claims('Two watts, cool to the touch.')
    assert 'w7' in server._light_spec_claims('Verbruikt zeven watt.')
    assert 'w2' in server._light_spec_claims('Nur zwei Watt Verbrauch.')
    assert server._light_unverified_claims('Nur 2 Watt Verbrauch.', 'Two watts, cool to the touch.') == []


def test_a_plug_in_wall_light_keeps_both_families_without_an_operator_type():
    raw = {'family': 'plugin', 'type': {'nl': 'stekkerlamp', 'de': 'Steckdosenlicht', 'com': 'plug-in wall light'},
           'search_terms': {'nl': ['stekkerlamp', 'wandlamp stopcontact', 'hanglamp'],
                            'com': ['plug-in wall light', 'outlet wall sconce', 'table lamp']}}
    b = server._light_brief_guard(raw, '')
    assert b['family'] == 'plugin' and b['family_source'] == 'model'
    assert b['search_terms'] == {'nl': ['stekkerlamp', 'wandlamp stopcontact'],
                                 'com': ['plug-in wall light', 'outlet wall sconce']}
    assert b['terms_dropped'] == ['hanglamp', 'table lamp']
    # The operator's own word narrows it again: typed 'Stekkerlamp' → wall terms go
    b2 = server._light_brief_guard(raw, 'Stekkerlamp')
    assert 'wandlamp stopcontact' in b2['terms_dropped']


# ── v1.311: review of PR #68 ───────────────────────────────────────────────
def test_negation_covers_the_power_and_sensor_words():
    c = server._light_spec_claims
    assert c('Niet oplaadbaar, werkt op netstroom.') == {'not:oplaadbaar', 'stopcontact'}
    assert 'not:oplaadbaar' in c('Nicht wiederaufladbar.') and 'oplaadbaar' not in c('Nicht wiederaufladbar.')
    assert c('Geen sensor, gewoon een schakelaar.') == {'not:sensor'}
    assert c('Geen batterijen nodig.') == {'not:oplaadbaar'}
    assert c('Not cordless.') == {'not:draadloos'}


def test_socket_negation_needs_an_absence_word_and_never_a_second_socket():
    c = server._light_spec_claims
    assert c('Blockiert nicht die Steckdose daneben.') == {'stopcontact'}
    assert 'not:stopcontact' not in c('Passt in jede Steckdose, blockiert keine zweite Steckdose.')
    assert 'not:stopcontact' not in c('Nicht nur eine Steckdosenlampe, sondern auch ein Nachtlicht.')
    assert c('Geen stopcontact nodig, gewoon neerzetten.') == {'not:stopcontact'}
    assert c('Ohne Steckdose, einfach aufstellen.') == {'not:stopcontact'}
    assert c('No outlet needed.') == {'not:stopcontact'}


def test_power_words_ignore_remotes_chargers_and_lookalikes():
    c = server._light_spec_claims
    for txt in ('Met draadloze afstandsbediening.', 'Wireless remote included.', 'Mit kabelloser Fernbedienung.',
                'Bluetooth wireless speaker built in.', 'Akkurat gefertigt.', 'Die Solaris Lampe.',
                'Visit our outlet store.', 'Solarium'):
        assert not (c(txt) & server._LIGHT_POWER_CLAIMS), txt
    assert server._light_power_conflict('lamp met draadloze afstandsbediening', 'socket') is False


def test_power_words_catch_the_common_phrasings():
    c = server._light_spec_claims
    assert 'oplaadbaar' in c('Lamp met ingebouwde accu, 8 uur licht.')
    assert 'oplaadbaar' in c('Opladen via USB-C.') and 'oplaadbaar' in c('Ladezeit 2 Stunden.')
    assert 'oplaadbaar' in c('Lithium-ion 2000mAh.') and 'oplaadbaar' in c('USB-C charging, 10h runtime.')
    assert 'stopcontact' in c('Plug it in.') and 'stopcontact' in c('Plugs into any socket.')
    assert 'stopcontact' in c('Netzbetrieb mit Stecker.') and 'stopcontact' in c('Mains powered.')
    assert 'sensor' in c('Gaat vanzelf aan bij schemering.') and 'sensor' in c('Met twee sensoren.')


def test_number_words_only_become_watts_when_they_are_watts():
    c = server._light_spec_claims
    assert 'w1' not in c('Ein W-LAN Modul.') and 'w1' not in c('Phase one w/ light.')
    assert 'w2' not in c('Afmetingen: twee W x drie H cm.')
    assert 'w2' in c('Two watts, cool to the touch.')


def test_page_text_keeps_forms_and_headers_inside_main_and_drops_review_widgets():
    html = ('<html><body><header><nav>Menu</nav></header><main>'
            '<header class="section-header"><h1>Aoraglow</h1></header>'
            '<form action="/cart/add"><div class="description">Plugs into any outlet, dusk-to-dawn sensor.</div>'
            '<button>Add to cart</button></form>'
            '<div class="jdgm-widget jdgm-review-widget"><span>4.8 stars</span> Write a review, rechargeable is great</div>'
            '<div id="looxReviews">Loox rechargeable review text</div>'
            '<a href="/products/aora%C3%A9glow?variant=1">Aoraéglow in white</a>'
            '</main><footer>Privacy policy</footer></body></html>')
    t = server._page_text_from_html(html, handle='aoraéglow')
    assert 'Plugs into any outlet' in t and 'Aoraglow' in t
    assert 'Aoraéglow in white' in t                          # own link, percent-encoded href
    for noise in ('Write a review', 'Loox', 'rechargeable', 'Menu', 'Privacy'):
        assert noise not in t, noise


def test_page_text_for_does_not_ask_a_refusing_host_twice(monkeypatch):
    monkeypatch.setattr(server, '_scrape_get',
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError('fetched again')))
    assert server._page_text_for({'body_html': '', 'handle': 'x'}, None, 'https://x/products/x',
                                 prior_status=429) == (None, 'rate_limited')
    assert server._page_text_for({'body_html': '', 'handle': 'x'}, None, 'https://x/products/x',
                                 prior_status='error') == (None, 'unreachable')
    assert server._page_text_for({'body_html': '', 'handle': 'x'}, None, 'https://x/products/x',
                                 prior_status=403) == (None, 'http_403')


def test_the_product_type_itself_is_never_an_unverified_socket_claim(gen):
    """Thin source, no brief: the prompt orders 'Stekkerlamp', so 'Steckdose' in
    the copy must not trigger a paid retry or a red flag."""
    plain = ('Die PLUGIFY Aora ist eine Steckdosenlampe, die du direkt in die Steckdose steckst. Ein Lichtstrahl '
             'nach oben, ein Lichtkegel nach unten, warm und ruhig, jeden Abend im Flur oder im Schlafzimmer.')
    _FakeClient.answers = [{'description': plain, 'meta_description': 'a', 'm_title_specs': 'b'}]
    body = gen('de', source_text='Aoraglow', brief={})
    assert len(_FakeClient.prompts) == 1 and not body.get('claim_mismatch')
    # …but a sensor the thin source never mentions IS still an unverified claim
    _FakeClient.answers = [{'description': PLUGIN_DE, 'meta_description': 'a', 'm_title_specs': 'b'},
                           {'description': PLUGIN_DE, 'meta_description': 'a', 'm_title_specs': 'b'}]
    _FakeClient.prompts = []
    body = gen('de', source_text='Aoraglow', brief={})
    assert body['claim_mismatch'] == ['sensor']


def test_a_rechargeable_lamp_may_say_no_socket_needed(gen):
    """The style example says it; the source names the outlet only for charging."""
    text = ('Die PLUGIFY Aora ist eine Akku-Lampe, die du überall hinstellst: auf die Kommode, neben das Bett, '
            'auf den Esstisch. Keine Steckdose nötig, einfach aufstellen und einschalten, jeden Abend aufs Neue.')
    _FakeClient.answers = [{'description': text, 'meta_description': 'a', 'm_title_specs': 'b'}]
    body = gen('de', source_text='Oplaadbare lamp. Aufladen an jeder Steckdose, 8 Stunden Licht.',
               brief={'family': 'table', 'type': {'nl': 'oplaadbare tafellamp', 'de': 'Akku-Tischlampe', 'com': 'x'},
                      'what': 'Een oplaadbare lamp.', 'power': 'rechargeable', 'placement': 'tafel', 'features': []},
               product_type='Oplaadbare tafellamp')
    assert len(_FakeClient.prompts) == 1 and not body.get('claim_mismatch')


def test_a_model_power_guess_does_not_verify_a_model_claim(gen):
    """Source says nothing about power; the brief guessed 'rechargeable'; the
    copy claims rechargeable → still unverified (retry + flag)."""
    _FakeClient.answers = [
        {'description': RECHARGEABLE_DE, 'meta_description': 'a', 'm_title_specs': 'b'},
        {'description': RECHARGEABLE_DE, 'meta_description': 'a', 'm_title_specs': 'b'},
    ]
    body = gen('de', source_text='Een mooie lamp voor op tafel, warm licht, mat zwart.',
               brief={'family': 'table', 'type': {'nl': 'tafellamp', 'de': 'Tischlampe', 'com': 'table lamp'},
                      'what': 'Een tafellamp.', 'power': 'rechargeable', 'placement': 'tafel', 'features': []})
    assert body['claim_mismatch'] == ['draadloos', 'oplaadbaar']


def test_wrong_language_still_loses_to_a_type_word_plus_a_claim(gen):
    german_two_problems = GERMAN_LIKE = ('Die PLUGIFY Aora ist eine wiederaufladbare Tischlampe, die du direkt in '
                                          'die Steckdose steckst. Warmes Licht im Flur, Schlafzimmer oder in der Küche.')
    dutch = ('De PLUGIFY Aora is een stekkerlamp die je in het stopcontact steekt. Warm licht in de gang, de '
             'slaapkamer of de keuken, elke avond opnieuw, zonder er nog aan te denken.')
    _FakeClient.answers = [
        {'description': german_two_problems, 'meta_description': 'a', 'm_title_specs': 'b'},
        {'description': dutch, 'meta_description': 'a', 'm_title_specs': 'b'},
    ]
    body = gen('de')
    assert body['description'] == german_two_problems and not body.get('language_mismatch')
