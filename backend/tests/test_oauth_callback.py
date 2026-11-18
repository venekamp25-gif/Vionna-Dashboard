"""Regression tests for the Shopify OAuth /callback hardening (v1.327.0).

The security audits of 31 Aug, 15 Sep, 10 Nov and 16 Nov 2026 rated this CRITICAL:
/callback trusted the `shop` query value. /auth/dk followed by
/callback?shop=<attacker host>&state=<own state> made the droplet POST the DK
client_secret to that host and write the host plus a fake token into tokens.json.

These tests fail if the shop check, the Shopify HMAC or the state check is ever
loosened again. No network: requests.post is replaced by a recorder.
"""
import hashlib
import hmac
import urllib.parse

import pytest
from werkzeug.datastructures import ImmutableMultiDict

import server

DK_SECRET = 'test-dk-secret'
FR_SECRET = 'test-fr-secret'
DK = 'vionna-test-dk.myshopify.com'
FR = 'vionna-test-fr.myshopify.com'


def sign(params, secret=DK_SECRET):
    """Shopify's signature for simple (no % or &) parameter values."""
    msg = '&'.join(sorted(f'{k}={v}' for k, v in params.items()))
    return hmac.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest()


@pytest.fixture
def posts(monkeypatch):
    """Configured test stores, empty tokens, and a recorder instead of requests.post."""
    monkeypatch.setattr(server, 'STORES', {'dk': DK, 'fr': FR, 'fi': None})
    monkeypatch.setattr(server, 'APP_CREDENTIALS', {
        'dk': {'client_id': 'id-dk', 'client_secret': DK_SECRET},
        'fr': {'client_id': 'id-fr', 'client_secret': FR_SECRET},
        'fi': {'client_id': None, 'client_secret': None}})
    monkeypatch.setattr(server, 'tokens', {})
    monkeypatch.setattr(server, 'save_tokens', lambda: None)
    seen = []

    class Answer:
        status_code = 200
        text = '{"access_token": "shpat_new"}'

        def json(self):
            return {'access_token': 'shpat_new'}

    def fake_post(url, json=None, **kw):
        seen.append((url, json))
        return Answer()

    monkeypatch.setattr(server.req, 'post', fake_post)
    return seen


def start_auth(client, store='dk'):
    """GET /auth/<store> like the 'Authorize DK' link does; returns the state it set."""
    r = client.get(f'/auth/{store}')
    assert r.status_code == 302
    q = urllib.parse.parse_qs(urllib.parse.urlparse(r.headers['Location']).query)
    return q['state'][0]


def callback(client, params, extra=''):
    return client.get('/callback?' + urllib.parse.urlencode(params) + extra)


def signed(secret=DK_SECRET, **params):
    params = dict(params)
    params['hmac'] = sign(params, secret)
    return params


# --------------------------------------------------------------------------- the audited attack
@pytest.mark.parametrize('evil', ['attacker.example', 'evil.myshopify.com', DK + '.attacker.example',
                                  'attacker.example/x', DK + '/../attacker.example', '',
                                  # look-alikes: an ends-with / prefix match would let these through
                                  'evil' + DK, DK.replace('.myshopify.com', '-x.myshopify.com')])
def test_the_audited_attack_never_posts_the_secret(posts, evil):
    """/auth/dk then /callback with another host: no POST anywhere, tokens.json untouched.
    Even a correct-looking HMAC over the forged query does not help."""
    c = server.app.test_client()
    state = start_auth(c)
    r = callback(c, signed(code='x', shop=evil, state=state, timestamp='1'))
    assert r.status_code == 400
    assert posts == [] and server.tokens == {}


def test_other_configured_store_than_the_session_is_refused(posts):
    c = server.app.test_client()
    state = start_auth(c, 'dk')
    r = callback(c, signed(FR_SECRET, code='x', shop=FR, state=state, timestamp='1'))
    assert r.status_code == 400 and posts == []


def test_unknown_shop_is_not_echoed_back(posts):
    """The old 400 page echoed the query value as HTML (reflected XSS on the droplet origin)."""
    c = server.app.test_client()
    r = callback(c, {'code': 'x', 'shop': '<script>alert(1)</script>', 'timestamp': '1'})
    assert r.status_code == 400 and b'<script>' not in r.data and posts == []


# --------------------------------------------------------------------------- Shopify HMAC
@pytest.mark.parametrize('bad', ['', '0' * 64, 'not-hex-ü'])
def test_missing_or_wrong_hmac_is_refused(posts, bad):
    c = server.app.test_client()
    state = start_auth(c)
    r = callback(c, {'code': 'x', 'shop': DK, 'state': state, 'timestamp': '1', 'hmac': bad})
    assert r.status_code == 403 and posts == []


def test_hmac_made_with_another_stores_secret_is_refused(posts):
    c = server.app.test_client()
    state = start_auth(c)
    r = callback(c, signed(FR_SECRET, code='x', shop=DK, state=state, timestamp='1'))
    assert r.status_code == 403 and posts == []


def test_tampered_parameter_breaks_the_hmac(posts):
    c = server.app.test_client()
    state = start_auth(c)
    p = signed(code='x', shop=DK, state=state, timestamp='1')
    p['code'] = 'other'
    assert callback(c, p).status_code == 403 and posts == []


def test_duplicate_parameter_is_refused(posts):
    """A second `shop` must never slip past the signature check."""
    c = server.app.test_client()
    p = signed(code='x', shop=DK, timestamp='1')
    r = callback(c, p, extra='&shop=attacker.example')
    assert r.status_code in (400, 403) and posts == []


def test_store_without_a_secret_never_accepts_a_callback(posts, monkeypatch):
    """A configured store whose client secret is missing: even an HMAC made with an empty key fails."""
    fi = 'vionna-test-fi.myshopify.com'
    monkeypatch.setitem(server.STORES, 'fi', fi)
    c = server.app.test_client()
    p = {'code': 'x', 'shop': fi, 'timestamp': '1'}
    p['hmac'] = sign(p, '')
    assert callback(c, p).status_code == 403 and posts == []


def test_hmac_matches_shopifys_documented_example():
    """Known-answer test: the example from Shopify's OAuth documentation (secret 'hush')."""
    args = ImmutableMultiDict([
        ('code', '0907a61c0c8d55e99db179b68161bc00'),
        ('hmac', '700e2dadb827fcc8609e9d5ce208b2e9cdaab9df07390d2cbca10d7c328fc4bf'),
        ('shop', 'some-shop.myshopify.com'),
        ('state', '0.6784241404160823'),
        ('timestamp', '1337178173')])
    assert server._shopify_hmac_ok(args, 'hush')
    assert not server._shopify_hmac_ok(args, 'other-secret')
    assert not server._shopify_hmac_ok(args, None)


def test_hmac_message_escapes_and_array_params():
    args = ImmutableMultiDict([('a%b', 'c&d'), ('e=f', 'g'), ('ids[]', '1'), ('ids[]', '2'), ('hmac', 'x')])
    assert server._shopify_hmac_message(args) == 'a%25b=c%26d&e%3Df=g&ids=["1", "2"]'


# --------------------------------------------------------------------------- state
def test_wrong_state_is_refused(posts):
    c = server.app.test_client()
    start_auth(c)
    r = callback(c, signed(code='x', shop=DK, state='forged', timestamp='1'))
    assert r.status_code == 403 and posts == []


def test_missing_state_is_refused_when_auth_set_one(posts):
    c = server.app.test_client()
    start_auth(c)
    r = callback(c, signed(code='x', shop=DK, timestamp='1'))
    assert r.status_code == 403 and posts == []


def test_replayed_callback_only_reaches_the_configured_shop(posts):
    """The session is a signed cookie, so a replay is possible; the one-time guarantee is
    Shopify's single-use code. What matters: a replay can only ever talk to our own shop."""
    c = server.app.test_client()
    state = start_auth(c)
    assert callback(c, signed(code='a', shop=DK, state=state, timestamp='1')).status_code == 302
    callback(c, signed(code='a', shop=DK, state=state, timestamp='1'))
    assert posts and all(url == f'https://{DK}/admin/oauth/access_token' for url, _ in posts)


# --------------------------------------------------------------------------- the real flow still works
def test_valid_callback_exchanges_at_the_configured_domain(posts):
    c = server.app.test_client()
    state = start_auth(c)
    r = callback(c, signed(code='abc', shop=DK, state=state, timestamp='1',
                           host='YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUveA=='))
    assert r.status_code == 302 and 'auth=success' in r.headers['Location']
    assert posts == [(f'https://{DK}/admin/oauth/access_token',
                      {'client_id': 'id-dk', 'client_secret': DK_SECRET, 'code': 'abc'})]
    assert server.tokens == {'dk': {'shop': DK, 'token': 'shpat_new'}}


def test_shop_in_capitals_still_maps_to_the_configured_domain(posts):
    c = server.app.test_client()
    state = start_auth(c)
    r = callback(c, signed(code='abc', shop=DK.upper(), state=state, timestamp='1'))
    assert r.status_code == 302
    assert posts[0][0] == f'https://{DK}/admin/oauth/access_token'
    assert server.tokens['dk']['shop'] == DK


def test_flow_started_on_the_shopify_side_needs_the_hmac(posts):
    """No /auth first, so no session state: allowed only with a valid Shopify HMAC."""
    c = server.app.test_client()
    assert callback(c, signed(code='abc', shop=DK, timestamp='1')).status_code == 302
    assert len(posts) == 1 and server.tokens['dk']['shop'] == DK
    c2 = server.app.test_client()
    assert callback(c2, {'code': 'abc', 'shop': DK, 'timestamp': '1'}).status_code == 403


def test_failed_exchange_writes_nothing(posts, monkeypatch):
    class Refused:
        status_code = 400
        text = 'invalid_request'

        def json(self):
            return {}

    monkeypatch.setattr(server.req, 'post', lambda url, json=None, **kw: Refused())
    c = server.app.test_client()
    state = start_auth(c)
    r = callback(c, signed(code='abc', shop=DK, state=state, timestamp='1'))
    assert r.status_code == 400 and server.tokens == {}


def test_shopify_not_answering_is_a_clean_502(posts, monkeypatch):
    def timeout(url, json=None, **kw):
        raise server.req.Timeout('read timed out')

    monkeypatch.setattr(server.req, 'post', timeout)
    c = server.app.test_client()
    state = start_auth(c)
    r = callback(c, signed(code='abc', shop=DK, state=state, timestamp='1'))
    assert r.status_code == 502 and server.tokens == {}


@pytest.mark.parametrize('body', [[1], 'x', None])
def test_odd_token_answer_is_a_clean_400(posts, monkeypatch, body):
    class Odd:
        status_code = 200
        text = 'odd'

        def json(self):
            return body

    monkeypatch.setattr(server.req, 'post', lambda url, json=None, **kw: Odd())
    c = server.app.test_client()
    state = start_auth(c)
    r = callback(c, signed(code='abc', shop=DK, state=state, timestamp='1'))
    assert r.status_code == 400 and server.tokens == {}
