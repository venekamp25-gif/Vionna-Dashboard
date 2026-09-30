# -*- coding: utf-8 -*-
"""The blog writer gets its article through a forced tool call, with a budget per
language and one retry, and a failed writer says WHY.

Incident 29 Sep 2026: the FI Tuesday article never appeared and Slack only said
'writer failed'. The writer returned its ~10k-char HTML article as one string in
hand-written JSON under a fixed 4,500-token cap: Finnish pillars were cut off at
the cap, and even complete answers broke on an unescaped quote inside the HTML
('"half tuck"', 'href=\\"/blogs/...">'). No retry, and the log showed only the
first 150 characters, identical for both causes.
"""
from types import SimpleNamespace

import pytest

import server

BODY = ('<p>Pusero on syksyn tärkein vaate. Tämä on "half tuck" -vinkki ilman escapea.</p>'
        '<h2>Pusero ja farkut</h2><p>Lue myös <a href="/blogs/journal/asu-tyohaastatteluun">'
        'asu työhaastatteluun</a> ja katso <a href="/products/aino">Aino</a>.</p>'
        '<h2>Usein kysytyt kysymykset</h2><h3>Miten pusero pestään?</h3><p>Pese 30 asteessa nurin päin.</p>'
        '<h3>Mikä pusero sopii töihin?</h3><p>Yksivärinen, siisti malli.</p>')
ARTICLE = {'title': 'Pusero: täydellinen opas', 'handle': 'pusero-taydellinen-opas',
           'meta_description': 'Kaikki puseroista.', 'excerpt': 'Opas puseroihin.',
           'tags': ['pusero', 'opas'], 'body_html': BODY}
PRODUCTS = [{'title': n, 'url': f'/products/{n.lower()}', 'handle': n.lower(), 'type': 'Pusero'}
            for n in ('Aino', 'Helmi', 'Kaisa', 'Liisa')]
FI_PILLAR = {'keyword': 'pusero', 'category': 'top', 'pillar': True,
             'spokes': [{'title': 'Asu työhaastatteluun', 'handle': 'asu-tyohaastatteluun'}]}
BRIEF_1400 = {'target_words': 1400, 'covered': ['fit'], 'gaps': ['care']}


def _msg(stop, data=None, text=None, out=4000, name='article'):
    blocks = []
    if text is not None:
        blocks.append(SimpleNamespace(type='text', text=text))
    if data is not None:
        blocks.append(SimpleNamespace(type='tool_use', name=name, input=data))
    return SimpleNamespace(stop_reason=stop, usage=SimpleNamespace(output_tokens=out), content=blocks)


class _FakeClient:
    answers = []
    calls = []

    def __init__(self, api_key=None):
        self.messages = self

    def create(self, **kw):
        _FakeClient.calls.append(kw)
        a = _FakeClient.answers.pop(0)
        if isinstance(a, Exception):
            raise a
        return a


class Overloaded(Exception):
    pass


@pytest.fixture()
def claude(monkeypatch):
    import anthropic
    monkeypatch.setattr(anthropic, 'Anthropic', _FakeClient)
    monkeypatch.setattr(server, 'ANTHROPIC_KEY', 'test-key')
    _FakeClient.answers, _FakeClient.calls = [], []
    return _FakeClient


def _write_fi_pillar():
    return server._blog_write('fi', dict(FI_PILLAR), PRODUCTS, serp_brief=BRIEF_1400)


# --- writer ------------------------------------------------------------------

def test_writer_takes_the_article_from_the_forced_tool_call(claude):
    claude.answers = [_msg('tool_use', dict(ARTICLE))]
    art = _write_fi_pillar()
    assert art['title'] == ARTICLE['title'] and art['body_html'] == BODY   # quotes survive untouched
    assert art['tags'] == ['pusero', 'opas'] and art['handle'] == 'pusero-taydellinen-opas'
    call = claude.calls[0]
    assert call['tool_choice'] == {'type': 'tool', 'name': 'article'}
    assert [t['name'] for t in call['tools']] == ['article']
    # no duplicate FAQ array in the schema or the prompt: the body is the source
    assert 'faq' not in call['tools'][0]['input_schema']['properties']
    prompt = call['messages'][0]['content']
    assert 'Return ONLY compact JSON' not in prompt and '"faq"' not in prompt
    assert [f['q'] for f in art['faq']] == ['Miten pusero pestään?', 'Mikä pusero sopii töihin?']
    assert art['levers']['n_faq'] == 2
    assert art['levers']['writer_retried'] is False
    assert art['levers']['writer_max_tokens'] == call['max_tokens'] == server._blog_writer_budget('fi', 1400)
    assert art['levers']['writer_output_tokens'] == 4000


def test_a_truncated_first_answer_is_retried_at_the_full_ceiling(claude):
    budget = server._blog_writer_budget('fi', 1400)
    claude.answers = [_msg('max_tokens', {'title': 'Pusero'}, out=budget),
                      _msg('tool_use', dict(ARTICLE), out=10200)]
    art = _write_fi_pillar()
    assert [c['max_tokens'] for c in claude.calls] == [budget, 16000]
    assert budget >= 9000                      # the old fixed 4,500 cut FI pillars off
    assert art['title'] and art['body_html'] == BODY
    assert art['levers']['writer_retried'] is True
    assert art['levers']['writer_max_tokens'] == 16000 and art['levers']['writer_output_tokens'] == 10200


def test_an_answer_without_a_tool_call_is_retried_too(claude):
    # not only truncation: any unusable answer gets one fresh sample
    claude.answers = [_msg('end_turn', text='```json {"title": "Pusero", "body_html": "<p>'),
                      _msg('tool_use', dict(ARTICLE))]
    art = _write_fi_pillar()
    assert len(claude.calls) == 2 and art['body_html'] == BODY


def test_a_tool_answer_with_an_empty_body_is_retried(claude):
    claude.answers = [_msg('tool_use', {**ARTICLE, 'body_html': '  '}), _msg('tool_use', dict(ARTICLE))]
    assert _write_fi_pillar()['body_html'] == BODY


def test_two_truncated_answers_return_the_reason_instead_of_none(claude):
    budget = server._blog_writer_budget('fi', 1400)
    claude.answers = [_msg('max_tokens', out=budget), _msg('max_tokens', out=16000)]
    art = _write_fi_pillar()
    assert set(art) == {'error'}
    err = art['error']
    assert 'max_tokens' in err and f'{budget} output tokens' in err and '16000 output tokens' in err
    assert 'Finnish' in err and '1400 words' in err


def test_an_api_exception_is_named_in_the_error(claude):
    claude.answers = [Overloaded('529 overloaded'), Overloaded('529 overloaded again')]
    err = _write_fi_pillar()['error']
    assert 'Overloaded' in err and '529 overloaded' in err


def test_writer_budget_covers_the_longest_target_in_every_language():
    # measured on real writer output (30 Sep 2026): FI 4.74 tokens/word; the
    # longest target is a 1,400-word SERP brief. Raising a word target without
    # the budget must fail here, not in production.
    measured = {'fi': 4.74, 'dk': 3.2, 'fr': 2.8}
    for store, tpw in measured.items():
        b = server._blog_writer_budget(store, 1400)
        assert 1400 * tpw * 1.15 <= b <= server.BLOG_WRITER_MAX_TOKENS
    assert server._blog_writer_budget('dk', 950) == 6000       # floor for short pieces


# --- editor / maintenance ----------------------------------------------------

def test_editor_reads_its_forced_tool_answer(claude):
    art = {**ARTICLE, 'faq': [], 'levers': {'editor_pass': False}, 'primary_keyword': 'pusero'}
    fixed = BODY.replace('syksyn', 'syksyn aivan')
    claude.answers = [_msg('tool_use', {**ARTICLE, 'body_html': fixed}, name='edited_article')]
    out = server._blog_edit('fi', art, PRODUCTS)
    assert claude.calls[0]['tool_choice'] == {'type': 'tool', 'name': 'edited_article'}
    assert out['body_html'] == fixed and out['levers']['editor_pass'] is True


def test_a_truncated_editor_answer_keeps_the_writer_version_and_says_why(claude, capsys):
    art = {**ARTICLE, 'faq': [], 'levers': {'editor_pass': False}, 'primary_keyword': 'pusero'}
    claude.answers = [_msg('max_tokens', out=16000)]
    assert server._blog_edit('fi', art, PRODUCTS) is art
    assert 'stop_reason=max_tokens, 16000 output tokens' in capsys.readouterr().out


# --- _blog_generate_one --------------------------------------------------------

class _Reached(Exception):
    """The writer succeeded and the pipeline moved on to the editor."""


@pytest.fixture()
def pipeline(monkeypatch):
    """Every step before the writer faked; the editor stops the run, so nothing
    after the writer (and certainly no Shopify write) is exercised."""
    def _no_shopify(*a, **k):
        raise AssertionError('no Shopify calls in this test')
    monkeypatch.setattr(server, '_shopify_call', _no_shopify)
    monkeypatch.setattr(server, 'shopify_headers', lambda store: {'X-Shopify-Access-Token': 'x'})
    monkeypatch.setattr(server, '_blog_hot_topics',
                        lambda *a, **k: [{'keyword': 'neuleet', 'category': 'knit'}])
    monkeypatch.setattr(server, '_blog_fallback_topic',
                        lambda *a, **k: {'keyword': 'asu', 'category': 'top', 'source': 'fallback'})
    monkeypatch.setattr(server, '_blog_pillar_candidate', lambda *a, **k: dict(FI_PILLAR))
    monkeypatch.setattr(server, '_blog_bestsellers_topic', lambda *a, **k: None)
    monkeypatch.setattr(server, '_blog_recent_product_handles', lambda *a, **k: set())
    monkeypatch.setattr(server, '_blog_match_products', lambda *a, **k: list(PRODUCTS))
    monkeypatch.setattr(server, '_blog_products_fit_topic', lambda store, cand, prods: prods)
    monkeypatch.setattr(server, '_blog_faq_questions', lambda *a, **k: [])
    monkeypatch.setattr(server, '_blog_reddit_concerns', lambda *a, **k: [])
    monkeypatch.setattr(server, '_blog_serp_brief', lambda *a, **k: dict(BRIEF_1400))
    monkeypatch.setattr(server, '_blog_pick_format', lambda *a, **k: None)
    monkeypatch.setattr(server, '_blog_previous_texts', lambda *a, **k: [])
    monkeypatch.setattr(server, '_blog_avoid_phrases', lambda *a, **k: [])

    def _edit(store, art, products=None, violations=None):
        raise _Reached(art)
    monkeypatch.setattr(server, '_blog_edit', _edit)

    written = []

    def fake_writer(fail):
        def _w(store, topic, products, **kw):
            written.append(topic['keyword'])
            if topic['keyword'] in fail:
                return {'error': f"output cut off at max_tokens (writing {topic['keyword']})"}
            return {**ARTICLE, 'title': topic['keyword'], 'levers': {}}
        monkeypatch.setattr(server, '_blog_write', _w)
        return written
    return fake_writer


def test_generate_one_error_carries_the_writer_reason_and_the_topic(claude, pipeline, monkeypatch):
    # the real writer against a model that is cut off twice
    monkeypatch.setattr(server, '_blog_pillar_candidate', lambda *a, **k: None)
    claude.answers = [_msg('max_tokens', out=9564), _msg('max_tokens', out=16000)]
    res = server._blog_generate_one('fi', published=False)
    assert res['error'].startswith('writer failed: output cut off at max_tokens')
    assert '16000 output tokens' in res['error'] and "topic 'neuleet'" in res['error']
    assert res['topic']['keyword'] == 'neuleet'


def test_a_failed_pillar_writer_hands_the_slot_to_the_next_candidate(pipeline):
    written = pipeline(fail={'pusero'})
    with pytest.raises(_Reached) as hit:
        server._blog_generate_one('fi', published=False)
    assert written == ['pusero', 'neuleet']
    assert hit.value.args[0]['title'] == 'neuleet'


def test_when_the_next_candidate_fails_too_both_reasons_are_reported(pipeline):
    written = pipeline(fail={'pusero', 'neuleet'})
    res = server._blog_generate_one('fi', published=False)
    assert written == ['pusero', 'neuleet']            # only a pillar falls through
    assert res['error'].startswith("writer failed: output cut off at max_tokens (writing neuleet) (topic 'neuleet')")
    assert "after pillar 'pusero' writer failed" in res['error'] and 'writing pusero' in res['error']
    assert res['pillar_writer_failed']['keyword'] == 'pusero'


def test_a_caller_supplied_pillar_has_no_other_candidate_to_fall_back_to(pipeline):
    written = pipeline(fail={'pusero'})
    res = server._blog_generate_one('fi', topic=dict(FI_PILLAR), published=False)
    assert written == ['pusero']
    assert res['error'] == "writer failed: output cut off at max_tokens (writing pusero) (topic 'pusero')"
