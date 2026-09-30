# -*- coding: utf-8 -*-
"""A taken article handle must never cost a store its blog slots again.

2026-09: DK missed 6 Tue/Fri slots in a row (11-29 Sep). The monthly
bestsellers topic sits at index 0, the writer turns its fixed keyword into
'mest-elskede-styles-lige-nu' every time, that handle belongs to the July
article, and Shopify answered 422 'handle has already been taken' on every
run. Nothing was written to disk, Slack spoke on 2 of the 6 days, and
/api/blog/status showed no error.
"""
import copy
import datetime
import inspect
import json
import os

import pytest

import server

SHOPS = {'dk': 'dk.myshopify.com', 'fr': 'fr.myshopify.com', 'fi': 'fi.myshopify.com'}
JULY_ARTICLE = {'id': 1009038950749, 'handle': 'mest-elskede-styles-lige-nu',
                'title': 'Vores 4 mest elskede styles lige nu', 'tags': 'bestsellers',
                'created_at': '2026-07-24T10:00:00+02:00'}
BESTSELLERS_DK = {'keyword': 'mest elskede styles lige nu', 'category': None, 'source': 'bestsellers',
                  'products_override': [{'title': 'Aase', 'handle': 'aase-sort', 'image': 'https://img/a.jpg'},
                                         {'title': 'Berit', 'handle': 'berit-bla', 'image': 'https://img/b.jpg'}]}


class _Resp:
    def __init__(self, status=200, data=None, link=None):
        self.status_code = status
        self._data = {} if data is None else data
        self.headers = {'Link': link} if link else {}
        self.text = json.dumps(self._data)

    def json(self):
        return self._data


class _FakeShop:
    """The DK journal blog (id 77): a fixed article list and a scripted answer
    per article POST. Anything else is an unexpected live call."""

    def __init__(self, articles=(), post_statuses=(), list_status=200):
        self.articles = list(articles)
        self.post_statuses = list(post_statuses)
        self.list_status = list_status
        self.posts, self.puts, self.redirects, self.lists = [], [], [], 0

    def __call__(self, method, url, hdrs, json=None, timeout=20, **kw):
        if method == 'get' and '/blogs/77/articles.json' in url:
            self.lists += 1
            if self.list_status != 200:
                return _Resp(self.list_status, {'errors': 'Service unavailable'})
            return _Resp(200, {'articles': self.articles})
        if method == 'post' and url.endswith('/blogs/77/articles.json'):
            a = copy.deepcopy(json['article'])
            self.posts.append(a)
            st = self.post_statuses.pop(0) if self.post_statuses else 201
            if st == 422:
                return _Resp(422, {'errors': {'handle': ['has already been taken']}})
            if st != 201:
                return _Resp(st, {'errors': 'nope'})
            return _Resp(201, {'article': {'id': 5000 + len(self.posts), 'handle': a.get('handle'),
                                           'title': a['title'],
                                           'published_at': '2026-09-29T09:05:00Z' if a['published'] else None}})
        if method == 'put' and '/blogs/77/articles/' in url:
            self.puts.append(json['article'])
            return _Resp(200, {'article': json['article']})
        if method == 'post' and url.endswith('/redirects.json'):
            self.redirects.append(json['redirect'])
            return _Resp(201, {})
        raise AssertionError(f'unexpected Shopify call: {method} {url}')


@pytest.fixture
def shops(monkeypatch):
    monkeypatch.setattr(server, 'tokens', {s: {'shop': d, 'token': 't'} for s, d in SHOPS.items()})
    monkeypatch.setattr(server, 'STORES', dict(SHOPS))
    monkeypatch.setattr(server, '_blog_ensure', lambda store, hdrs: 77)


@pytest.fixture
def pipeline(monkeypatch, shops):
    """Every paid or networked step of the writer pipeline replaced by a stub;
    handle resolution, body assembly, JSON-LD, create and history stay real."""
    seen = {'related': [], 'retired': [], 'writer': {'handle': 'mest-elskede-styles-lige-nu',
                                                       'title': 'Vores mest elskede styles lige nu'}}

    def write(store, topic, products, **kw):
        return {'title': seen['writer']['title'], 'handle': seen['writer']['handle'],
                'body_html': '<p>Tekst.</p>', 'meta_description': 'm', 'excerpt': 'e',
                'tags': ['styles'], 'faq': [], 'levers': {}}

    monkeypatch.setattr(server, '_blog_write', write)
    monkeypatch.setattr(server, '_blog_faq_questions', lambda store, kw: [])
    monkeypatch.setattr(server, '_blog_reddit_concerns', lambda store, topic: [])
    monkeypatch.setattr(server, '_blog_serp_brief', lambda store, topic: None)
    monkeypatch.setattr(server, '_blog_previous_texts', lambda store, hdrs: [])
    monkeypatch.setattr(server, '_blog_edit', lambda store, art, products=None, violations=None: art)
    monkeypatch.setattr(server, '_blog_quality_violations', lambda art, store, products=None: [])
    monkeypatch.setattr(server, '_blog_repetition_violations', lambda body, prev, **kw: [])
    monkeypatch.setattr(server, '_blog_fix_anchors', lambda body, products: body)
    monkeypatch.setattr(server, '_blog_inline_product_images', lambda body, products, **kw: body)
    monkeypatch.setattr(server, '_blog_related_links',
                        lambda store, cat, hdrs, **kw: seen['related'].append(kw) or '')
    monkeypatch.setattr(server, '_blog_cta_buttons', lambda *a, **k: '')
    monkeypatch.setattr(server, '_blog_view_beacon', lambda store: '')
    monkeypatch.setattr(server, '_blog_hero_image', lambda *a, **k: None)
    monkeypatch.setattr(server, '_blog_slack_article', lambda *a, **k: None)
    monkeypatch.setattr(server, '_blog_update_pillar_links', lambda *a, **k: None)
    monkeypatch.setattr(server, '_blog_recent_product_handles', lambda store, n_articles=2: set())
    monkeypatch.setattr(server, '_blog_retire_previous_bestsellers',
                        lambda store, hdrs, created: seen['retired'].append(created))
    return seen


def _ld_target(body):
    blocks = [json.loads(b) for b in
              __import__('re').findall(r'<script type="application/ld\+json">(.*?)</script>', body)]
    return next(b['mainEntityOfPage'] for b in blocks if b.get('@type') == 'Article')


# ── the unique handle ─────────────────────────────────────────────────────────

def test_a_free_writer_handle_is_kept():
    assert server._blog_unique_handle('stoevler-til-efteraaret', 'Støvler til efteråret',
                                      {'mest-elskede-styles-lige-nu'}) == 'stoevler-til-efteraaret'


def test_a_taken_handle_falls_back_to_the_title_re_slugged():
    taken = {'mest-elskede-styles-lige-nu'}
    assert (server._blog_unique_handle('mest-elskede-styles-lige-nu', 'Vores 4 mest elskede styles lige nu',
                                       taken) == 'vores-4-mest-elskede-styles-lige-nu')


def test_when_the_title_slug_is_taken_too_the_suffix_keeps_counting_past_nine():
    # a monthly piece converges on the same slug: a -9 cap would bring the 422 back
    base = 'mest-elskede-styles-lige-nu'
    taken = {base, 'mest-elskede-styles-lige-nu'} | {f'{base}-{n}' for n in range(2, 13)}
    assert server._blog_unique_handle(base, 'Mest elskede styles lige nu', taken) == f'{base}-13'


@pytest.mark.parametrize('title, slug', [
    ('De sko, der løfter ethvert outfit', 'de-sko-der-loefter-ethvert-outfit'),
    ('Støvler til efteråret – 5 favoritter', 'stoevler-til-efteraaret-5-favoritter'),
    ('Rakastetuimmat tyylit juuri nyt', 'rakastetuimmat-tyylit-juuri-nyt'),
    ('5 tapaa pukea saappaat tyylikkäästi tänä syksynä',
     '5-tapaa-pukea-saappaat-tyylikkaasti-tana-syksyna'),
    ('Styles préférés du moment : où ça ?', 'styles-preferes-du-moment-ou-ca'),
    ("Cœur d'été, façon Übergang", 'coeur-d-ete-facon-ubergang'),
])
def test_dk_fi_and_fr_titles_are_transliterated_not_mangled(title, slug):
    assert server._blog_slug(title) == slug
    assert server._blog_unique_handle('taken', title, {'taken'}) == slug


def test_the_handle_list_follows_pagination_and_an_unreadable_list_is_not_empty(monkeypatch, shops):
    pages = {
        'first': _Resp(200, {'articles': [{'id': 1, 'handle': 'a'}]},
                       link='<https://dk.myshopify.com/admin/api/x/blogs/77/articles.json?page_info=p2>; rel="next"'),
        'second': _Resp(200, {'articles': [{'id': 2, 'handle': 'B'}]}),
    }
    urls = []

    def call(method, url, hdrs, json=None, timeout=20):
        urls.append(url)
        return pages['second'] if 'page_info=p2' in url else pages['first']
    monkeypatch.setattr(server, '_shopify_call', call)
    got = server._blog_existing_handles('dk', 77, server.shopify_headers('dk'))
    assert set(got) == {'a', 'b'} and got['b']['id'] == 2
    assert 'published_status=any' in urls[0] and 'limit=250' in urls[0]

    monkeypatch.setattr(server, '_shopify_call', lambda *a, **k: _Resp(503))
    assert server._blog_existing_handles('dk', 77, server.shopify_headers('dk')) is None


# ── the pipeline: final handle before the body is assembled ──────────────────

def test_a_taken_handle_is_replaced_before_the_json_ld_and_related_links_are_built(monkeypatch, pipeline):
    shop = _FakeShop(articles=[JULY_ARTICLE])
    monkeypatch.setattr(server, '_shopify_call', shop)
    res = server._blog_generate_one('dk', topic=dict(BESTSELLERS_DK), published=True)
    assert not res.get('error')
    posted = shop.posts[0]
    assert len(shop.posts) == 1, 'no 422 round-trip needed'
    assert posted['handle'] == 'vores-mest-elskede-styles-lige-nu'
    assert _ld_target(posted['body_html']) == ('https://dk.myshopify.com/blogs/journal/'
                                               'vores-mest-elskede-styles-lige-nu')
    assert pipeline['related'][0]['exclude_handle'] == 'vores-mest-elskede-styles-lige-nu'
    assert pipeline['related'][0]['exclude_bestsellers'] is True
    assert server.BLOG_BESTSELLER_TAG in posted['tags'].split(', ')
    assert res['article']['handle'] == 'vores-mest-elskede-styles-lige-nu'
    assert pipeline['retired'] and pipeline['retired'][0]['handle'] == 'vores-mest-elskede-styles-lige-nu'


def test_an_unreadable_handle_list_keeps_the_writer_handle_and_the_422_retry_saves_it(monkeypatch, pipeline):
    shop = _FakeShop(articles=[JULY_ARTICLE], post_statuses=[422, 201], list_status=503)
    monkeypatch.setattr(server, '_shopify_call', shop)
    res = server._blog_generate_one('dk', topic=dict(BESTSELLERS_DK), published=True)
    assert not res.get('error')
    assert [p['handle'] for p in shop.posts] == ['mest-elskede-styles-lige-nu',
                                                'vores-mest-elskede-styles-lige-nu']
    assert _ld_target(shop.posts[1]['body_html']).endswith('/blogs/journal/vores-mest-elskede-styles-lige-nu')
    assert res['preview']['body_html'] == shop.posts[1]['body_html']


# ── the 422 retry inside the create call ─────────────────────────────────────

def _art(handle='sko-til-efteraaret'):
    return {'title': 'Sko til efteråret', 'handle': handle, 'meta_description': 'm', 'excerpt': 'e',
            'tags': ['sko'], 'body_html': '<p>x</p>' + server._blog_article_jsonld('dk', {
                'title': 'Sko til efteråret', 'handle': handle})}


def test_a_handle_422_is_retried_once_with_the_next_free_handle(monkeypatch, shops):
    shop = _FakeShop(articles=[{'id': 1, 'handle': 'sko-til-efteraaret'}], post_statuses=[422, 201])
    monkeypatch.setattr(server, '_shopify_call', shop)
    art = _art()
    created = server._blog_create_article('dk', 77, art, server.shopify_headers('dk'))
    assert [p['handle'] for p in shop.posts] == ['sko-til-efteraaret', 'sko-til-efteraaret-2']
    assert _ld_target(shop.posts[1]['body_html']).endswith('/blogs/journal/sko-til-efteraaret-2')
    assert created['handle'] == art['handle'] == 'sko-til-efteraaret-2'


def test_a_second_handle_422_is_not_retried_again(monkeypatch, shops):
    shop = _FakeShop(post_statuses=[422, 422, 201])
    monkeypatch.setattr(server, '_shopify_call', shop)
    with pytest.raises(server._BlogCreateRejected) as ei:
        server._blog_create_article('dk', 77, _art(), server.shopify_headers('dk'))
    assert len(shop.posts) == 2 and ei.value.status == 422


def test_other_create_errors_are_not_retried_and_only_content_4xx_count_as_refused(monkeypatch, shops):
    for status, refused in ((400, True), (403, False), (429, False), (502, False)):
        shop = _FakeShop(post_statuses=[status])
        monkeypatch.setattr(server, '_shopify_call', shop)
        with pytest.raises(RuntimeError) as ei:
            server._blog_create_article('dk', 77, _art(), server.shopify_headers('dk'))
        assert len(shop.posts) == 1
        assert isinstance(ei.value, server._BlogCreateRejected) is refused, status


# ── one refused topic does not block the store ───────────────────────────────

def _candidates(monkeypatch, bestsellers=True):
    fallback = {'keyword': 'strik til efteråret', 'category': 'knit', 'source': 'fallback'}
    monkeypatch.setattr(server, '_blog_hot_topics', lambda store, k=3, hdrs=None: [
        {'keyword': 'støvler', 'category': 'boots'}])
    monkeypatch.setattr(server, '_blog_fallback_topic', lambda store, hdrs=None: dict(fallback))
    monkeypatch.setattr(server, '_blog_pillar_candidate', lambda store, hdrs: None)
    monkeypatch.setattr(server, '_blog_bestsellers_topic',
                        lambda store, hdrs: dict(BESTSELLERS_DK) if bestsellers else None)
    monkeypatch.setattr(server, '_blog_recent_product_handles', lambda store, n_articles=2: set())
    monkeypatch.setattr(server, '_blog_match_products', lambda store, cat, hdrs, **kw: [
        {'handle': f'{cat}-{i}'} for i in range(6)])
    monkeypatch.setattr(server, '_blog_products_fit_topic', lambda store, cand, prods: prods)


def test_a_refused_create_falls_through_to_the_next_candidate_and_is_recorded(monkeypatch, shops):
    _candidates(monkeypatch)
    tried = []

    def run(store, topic, products, hdrs, published):
        tried.append(topic['keyword'])
        if topic['source'] == 'bestsellers':
            raise server._BlogCreateRejected('article create failed HTTP 422: {"errors":{"handle":'
                                             '["has already been taken"]}}', status=422)
        return {'store': store, 'topic': topic, 'article': {'handle': 'stoevler'}}
    monkeypatch.setattr(server, '_blog_write_and_publish', run)
    res = server._blog_generate_one('dk')
    assert tried == ['mest elskede styles lige nu', 'støvler']
    assert res['article']['handle'] == 'stoevler'
    rows = server._blog_read_jsonl(server.BLOG_FAILURES_PATH)
    assert [(r['store'], r['topic'], r['step']) for r in rows] == [('dk', 'mest elskede styles lige nu', 'create')]
    assert '422' in rows[0]['error']


def test_the_fall_through_is_bounded_and_the_last_refusal_is_raised_already_recorded(monkeypatch, shops):
    _candidates(monkeypatch)
    tried = []

    def run(store, topic, products, hdrs, published):
        tried.append(topic['keyword'])
        raise server._BlogCreateRejected('article create failed HTTP 422', status=422)
    monkeypatch.setattr(server, '_blog_write_and_publish', run)
    with pytest.raises(server._BlogCreateRejected) as ei:
        server._blog_generate_one('dk')
    assert len(tried) == 1 + server.BLOG_CREATE_FALLTHROUGH
    assert ei.value.recorded is True and ei.value.topic_keyword == tried[-1]
    assert len(server._blog_read_jsonl(server.BLOG_FAILURES_PATH)) == len(tried)


def test_a_store_level_failure_does_not_burn_a_second_topic(monkeypatch, shops):
    _candidates(monkeypatch)
    tried = []

    def run(store, topic, products, hdrs, published):
        tried.append(topic['keyword'])
        raise RuntimeError('article create failed HTTP 403: missing write_content')
    monkeypatch.setattr(server, '_blog_write_and_publish', run)
    with pytest.raises(RuntimeError):
        server._blog_generate_one('dk')
    assert tried == ['mest elskede styles lige nu']


def test_a_writer_failure_comes_back_as_that_topics_error_not_an_exception(monkeypatch, pipeline):
    # The write step only knows its own topic; moving on to another candidate is
    # the run loop's job. 30 Sep 2026 a writer fall-through merged into the write
    # step silently read the run's `candidates` there: every writer failure
    # became a NameError and the reason never reached Slack or the result.
    _candidates(monkeypatch, bestsellers=False)

    def no_shopify(*a, **k):
        raise AssertionError('a failed writer must not reach Shopify')
    monkeypatch.setattr(server, '_shopify_call', no_shopify)
    written = []
    monkeypatch.setattr(server, '_blog_write',
                        lambda store, topic, products, **kw: written.append(topic['keyword']))
    res = server._blog_generate_one('dk')
    assert written == ['støvler']                  # a regular topic does not buy a second paid run
    assert res['error'].startswith('writer failed') and res['topic']['keyword'] == 'støvler'
    assert server._blog_read_jsonl(server.BLOG_FAILURES_PATH) == []   # the scheduler records the day


def test_a_topic_refused_on_two_days_this_month_is_not_tried_first_again(monkeypatch, shops):
    _candidates(monkeypatch)
    month = datetime.datetime.utcnow().strftime('%Y-%m')
    for day in ('01', '02'):
        with open(server.BLOG_FAILURES_PATH, 'a', encoding='utf-8') as f:
            f.write(json.dumps({'ts': f'{month}-{day}T09:05:00Z', 'store': 'dk',
                                'topic': 'mest elskede styles lige nu', 'step': 'create',
                                'error': 'HTTP 422'}) + '\n')
    tried = []
    monkeypatch.setattr(server, '_blog_write_and_publish',
                        lambda store, topic, products, hdrs, published: tried.append(topic['keyword']) or
                        {'article': {'handle': 'x'}})
    server._blog_generate_one('dk')
    assert tried == ['støvler']
    assert server._blog_topics_failing_create('fr') == set()


# ── bestsellers: a durable identity ──────────────────────────────────────────

def _no_orders_call(monkeypatch):
    calls = []

    def call(method, url, hdrs, json=None, timeout=20):
        calls.append(url)
        return _Resp(200, {'orders': []})
    monkeypatch.setattr(server, '_shopify_call', call)
    return calls


def test_a_synced_bestsellers_article_counts_for_the_monthly_due_check(monkeypatch, shops):
    month_ts = datetime.datetime.utcnow().strftime('%Y-%m-02T08:00:00+02:00')
    tagged = {'id': 7, 'handle': 'vores-favoritter', 'title': 'Vores favoritter', 'body_html': '',
              'tags': 'styles, vionna-bestsellers', 'published_at': month_ts, 'created_at': month_ts}
    monkeypatch.setattr(server, '_shopify_call',
                        lambda method, url, hdrs, json=None, timeout=20: _Resp(200, {'articles': [tagged]}))
    assert server._blog_sync_history_from_shopify('dk', server.shopify_headers('dk')) == 1
    row = server._blog_read_jsonl(server.BLOG_HISTORY_PATH)[-1]
    assert row['source'] == 'shopify-sync' and 'vionna-bestsellers' in row['tags']
    calls = _no_orders_call(monkeypatch)
    assert server._blog_bestsellers_topic('dk', server.shopify_headers('dk')) is None
    assert calls == [], 'not due: no order scan at all'


def test_the_keyword_slug_in_a_synced_handle_counts_too_but_a_maintenance_row_does_not(monkeypatch, shops):
    now = datetime.datetime.utcnow()
    maint = {'ts': now.isoformat() + 'Z', 'store': 'dk', 'maint': True, 'article_id': 1,
             'article_handle': 'mest-elskede-styles-lige-nu'}
    with open(server.BLOG_HISTORY_PATH, 'w', encoding='utf-8') as f:
        f.write(json.dumps(maint) + '\n')
    calls = _no_orders_call(monkeypatch)
    server._blog_bestsellers_topic('dk', server.shopify_headers('dk'))
    assert calls, 'maintaining the July article does not make this month done'
    synced = {'ts': now.isoformat() + 'Z', 'store': 'dk', 'source': 'shopify-sync', 'article_id': 2,
              'article_handle': 'vores-mest-elskede-styles-lige-nu'}
    with open(server.BLOG_HISTORY_PATH, 'a', encoding='utf-8') as f:
        f.write(json.dumps(synced) + '\n')
    calls.clear()
    assert server._blog_bestsellers_topic('dk', server.shopify_headers('dk')) is None and calls == []
    # FR's September handle carries a suffix after the keyword slug
    assert server._blog_is_bestsellers('fr', {'handle': 'styles-preferes-du-moment-vionna'})
    assert not server._blog_is_bestsellers('dk', {'handle': 'styles-til-efteraaret'})


def test_retire_also_finds_a_bestsellers_article_that_only_shopify_knows(monkeypatch, shops):
    shop = _FakeShop(articles=[JULY_ARTICLE,
                               {'id': 22, 'handle': 'stoevler-til-efteraaret', 'tags': 'boots'},
                               {'id': 9001, 'handle': 'vores-mest-elskede-styles-lige-nu',
                                'tags': 'vionna-bestsellers'}])
    monkeypatch.setattr(server, '_shopify_call', shop)
    server._blog_retire_previous_bestsellers('dk', server.shopify_headers('dk'),
                                             {'id': 9001, 'handle': 'vores-mest-elskede-styles-lige-nu'})
    assert [p['id'] for p in shop.puts] == [JULY_ARTICLE['id']] and shop.puts[0]['published'] is False
    assert shop.redirects == [{'path': '/blogs/journal/mest-elskede-styles-lige-nu',
                               'target': '/blogs/journal/vores-mest-elskede-styles-lige-nu'}]


# ── failures on disk, cadence, alerts ────────────────────────────────────────

def test_failures_live_in_their_own_isolated_ignored_and_backed_up_file():
    backend = os.path.dirname(os.path.abspath(server.__file__))
    assert os.path.dirname(server.BLOG_FAILURES_PATH) != backend, 'conftest must isolate it'
    server._blog_record_failure('dk', 'mest elskede styles lige nu', 'create', RuntimeError('HTTP 422'))
    rows = server._blog_read_jsonl(server.BLOG_FAILURES_PATH)
    assert rows[-1]['topic'] == 'mest elskede styles lige nu' and rows[-1]['error'] == 'HTTP 422'
    # a failure is not a post: blog_history would have made the scheduler skip the store
    assert not server._blog_store_posted_on('dk', datetime.datetime.utcnow().strftime('%Y-%m-%d'))
    with open(os.path.join(os.path.dirname(backend), '.gitignore'), encoding='utf-8') as f:
        ignored = {line.strip() for line in f}
    assert {'blog_failures.jsonl', 'backend/blog_failures.jsonl'} <= ignored
    assert "'blog_failures.jsonl'" in inspect.getsource(server._run_backup)


def _rows(*articles):
    return [{'ts': ts, 'store': st, 'article_id': i + 1, 'article_handle': f'h{i}', 'title': t,
             **extra} for i, (st, ts, t, extra) in enumerate(articles)]


def test_missed_slots_count_the_empty_tue_fri_slots_since_the_last_article():
    rows = _rows(('dk', '2026-09-08T11:26:00+02:00', 'Støvler', {}),
                 ('dk', '2026-09-20T08:00:00Z', 'maint', {'maint': True}),
                 ('fr', '2026-09-29T09:10:00Z', 'fr piece', {}))
    at = datetime.datetime
    assert server._blog_missed_slots('dk', at(2026, 9, 30, 12, 0), rows) == 6
    assert server._blog_missed_slots('dk', at(2026, 9, 29, 9, 30), rows) == 5, 'slot hour not over yet'
    assert server._blog_missed_slots('dk', at(2026, 9, 29, 10, 0), rows) == 6
    assert server._blog_missed_slots('fr', at(2026, 9, 29, 10, 0), rows) == 0
    assert server._blog_missed_slots('fi', at(2026, 9, 29, 10, 0), rows) == 0, 'no history: no verdict'


def _alert_env(monkeypatch, shops, history, failures):
    with open(server.BLOG_HISTORY_PATH, 'w', encoding='utf-8') as f:
        f.writelines(json.dumps(r, ensure_ascii=False) + '\n' for r in history)
    with open(server.BLOG_FAILURES_PATH, 'w', encoding='utf-8') as f:
        f.writelines(json.dumps(r, ensure_ascii=False) + '\n' for r in failures)
    monkeypatch.setattr(server, 'BLOG_SCHED_STORES', ['dk', 'fr', 'fi'])


REFUSED = {'ts': '2026-09-29T09:07:00Z', 'store': 'dk', 'topic': 'mest elskede styles lige nu',
           'step': 'create', 'error': 'article create failed HTTP 422: handle has already been taken'}


def test_the_first_empty_slot_alerts_with_the_real_reason_and_topic(monkeypatch, shops):
    history = _rows(('dk', '2026-09-25T09:05:00Z', 'Frakker', {}),
                    ('fr', '2026-09-29T09:10:00Z', 'fr', {}), ('fi', '2026-09-29T09:20:00Z', 'fi', {}))
    _alert_env(monkeypatch, shops, history, [REFUSED])
    alerts = server._blog_slot_alerts(datetime.datetime(2026, 9, 29, 10, 10))
    assert len(alerts) == 1 and '[DK]' in alerts[0]
    assert 'HTTP 422' in alerts[0] and 'mest elskede styles lige nu' in alerts[0]


def test_two_or_more_empty_slots_escalate_with_the_count_and_the_last_article(monkeypatch, shops):
    history = _rows(('dk', '2026-09-08T09:26:00Z', 'Støvler til efteråret', {}),
                    ('fr', '2026-09-29T09:10:00Z', 'fr', {}), ('fi', '2026-09-29T09:20:00Z', 'fi', {}))
    old = dict(REFUSED, ts='2026-09-01T09:00:00Z', error='solved long ago')
    _alert_env(monkeypatch, shops, history, [old, REFUSED])
    (alert,) = server._blog_slot_alerts(datetime.datetime(2026, 9, 29, 10, 10))
    assert '6 geplande dagen zonder artikel' in alert
    assert '2026-09-08' in alert and 'Støvler til efteråret' in alert
    assert 'HTTP 422' in alert and 'mest elskede styles lige nu' in alert


def test_the_scheduler_records_each_failure_and_alerts_once_after_the_slot_hour(monkeypatch, shops):
    _alert_env(monkeypatch, shops, _rows(('dk', '2026-09-25T09:05:00Z', 'Frakker', {})), [])
    monkeypatch.setattr(server, 'BLOG_SCHED_STORES', ['dk'])
    monkeypatch.setattr(server, '_blog_sync_history_from_shopify', lambda st, hdrs=None: 0)
    monkeypatch.setattr(server, '_blog_generate_one',
                        lambda st: {'store': st, 'topic': {'keyword': 'strik'}, 'error': 'writer failed'})
    sent = []
    monkeypatch.setattr(server, '_blog_slack', lambda text, blocks=None: sent.append(text))
    tue = datetime.datetime(2026, 9, 29)
    for minute in (0, 10, 20):                       # 2 attempts max, then backoff
        server._blog_scheduled_tick(tue.replace(hour=9, minute=minute))
    rows = server._blog_read_jsonl(server.BLOG_FAILURES_PATH)
    assert [(r['topic'], r['step'], r['error']) for r in rows] == [('strik', 'scheduled', 'writer failed')] * 2
    assert sent == [], 'no ping inside the slot hour'
    server._blog_scheduled_tick(tue.replace(hour=10, minute=0))
    server._blog_scheduled_tick(tue.replace(hour=10, minute=10))
    assert len(sent) == 1 and 'writer failed' in sent[0] and 'strik' in sent[0]


def test_a_refusal_already_recorded_by_the_run_is_not_written_twice(monkeypatch, shops):
    _alert_env(monkeypatch, shops, [], [])
    monkeypatch.setattr(server, 'BLOG_SCHED_STORES', ['dk'])
    monkeypatch.setattr(server, '_blog_sync_history_from_shopify', lambda st, hdrs=None: 0)

    def gen(st):
        server._blog_record_failure(st, 'mest elskede styles lige nu', 'create', 'HTTP 422')
        e = server._BlogCreateRejected('HTTP 422', status=422)
        e.topic_keyword, e.recorded = 'mest elskede styles lige nu', True
        raise e
    monkeypatch.setattr(server, '_blog_generate_one', gen)
    server._blog_scheduled_tick(datetime.datetime(2026, 9, 29, 9, 0))
    rows = server._blog_read_jsonl(server.BLOG_FAILURES_PATH)
    assert [(r['step'], r['topic']) for r in rows] == [('create', 'mest elskede styles lige nu')]


def test_status_shows_recent_failures_and_the_cadence_per_store(monkeypatch, shops):
    now = datetime.datetime.now()
    last = (now - datetime.timedelta(days=22)).strftime('%Y-%m-%dT09:00:00Z')
    fail_ts = (now - datetime.timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%SZ')
    _alert_env(monkeypatch, shops, _rows(('dk', last, 'Støvler', {})),
               [dict(REFUSED, ts=fail_ts)] + [dict(REFUSED, store='fr', ts=fail_ts)] * 11)
    monkeypatch.setattr(server, '_blog_scope_check', lambda st, max_age=600: {})
    with server.app.test_client() as c:
        body = c.get('/api/blog/status').get_json()
    assert len(body['recent_failures']) == 10
    dk = body['per_store']['dk']
    assert dk['last_article_at'] == last and dk['missed_slots'] >= 5
    assert dk['last_error']['topic'] == 'mest elskede styles lige nu'
    assert body['per_store']['fi'] == {'last_article_at': None, 'last_article_title': None,
                                       'missed_slots': 0, 'last_error': None}
