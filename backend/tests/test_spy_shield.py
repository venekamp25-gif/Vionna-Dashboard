"""Tests for the Spy Shield beacon (v1.314.0).

The beacon route is ungated BY DESIGN — storefront browsers post to it — so the
security properties are the tests: a wrong token, an oversized body, broken JSON
and a tripped rate limit all answer 204 (no oracle) and append nothing; only the
whitelisted fields are stored, truncated; the raw IP and user-agent never reach
the log (a day-salted hash does); the summary aggregates tolerant of corrupt
lines; the buyer join matches path + a ±60-minute window; setup is gated.
"""
import datetime
import json
import os

import pytest

import server

TOKEN = 'test-beacon-token'
POST_PATH = f'/api/spy_shield/{TOKEN}'
# Caddy appends the real client as the LAST hop; the first hop is whatever the
# poster sent along, so the tests spoof one to prove it is ignored.
HDRS = {'X-Forwarded-For': '10.0.0.1, 203.0.113.9', 'User-Agent': 'Mozilla/5.0 test-ua'}


@pytest.fixture(autouse=True)
def _sandbox(tmp_path, monkeypatch):
    """Fresh log file, .env sandbox, open gate for the gated routes, reset limiter."""
    monkeypatch.setattr(server, 'SPY_SHIELD_LOG_PATH', str(tmp_path / 'spy_shield.jsonl'))
    monkeypatch.setattr(server, 'ENV_PATH', str(tmp_path / '.env'))
    monkeypatch.setenv('SPY_SHIELD_BEACON_TOKEN', TOKEN)
    monkeypatch.delenv('SPY_SHIELD_BEACON', raising=False)
    monkeypatch.delenv('NOTIFY_SECRET', raising=False)
    monkeypatch.setenv('DEV_LOCAL', '1')
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', '')
    monkeypatch.setattr(server, '_SS_RATE', {'ip': {}, 'ip_day': {}, 'day': '', 'day_count': 0})
    monkeypatch.setattr(server, 'SPY_SHIELD_DIGEST_STATE', str(tmp_path / 'spy_shield_digest.json'))
    monkeypatch.setattr(server, '_SS_ORDERS_CACHE', {})
    for k in server._SS_DROPPED:
        server._SS_DROPPED[k] = 0
    return tmp_path


@pytest.fixture()
def client():
    server.app.config['TESTING'] = True
    with server.app.test_client() as c:
        yield c


def _record(**over):
    rec = {'event': 'spy_shield', 'ss_v': '2.0.0', 'ss_store': '86d3b0-76', 'ss_mode': 'monitor',
           'ss_pt': 0, 'ss_action': 'monitor', 'ss_tier': 'block', 'ss_reason': 'ref:app.ppspy.com',
           'ss_signals': 'ref', 'ss_info': '', 'ss_phase': 'head', 'ss_ref_host': 'app.ppspy.com',
           'ss_clickid': 0, 'ss_utm': 0, 'ss_repeat': 0, 'ss_path': '/products/berit-kjole',
           'ss_ua': 'Mozilla/5.0 test-ua'}
    rec.update(over)
    return rec


def _post(client, body, path=POST_PATH, headers=None):
    data = body if isinstance(body, (bytes, str)) else json.dumps(body)
    return client.post(path, data=data, content_type='text/plain', headers=headers or HDRS)


def _lines(tmp_path):
    p = tmp_path / 'spy_shield.jsonl'
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text(encoding='utf-8').splitlines() if l.strip()]


# ── beacon route ──────────────────────────────────────────────────────────────

def test_valid_record_is_appended_and_answers_204(client, _sandbox):
    r = _post(client, _record())
    assert r.status_code == 204 and r.data == b''
    rows = _lines(_sandbox)
    assert len(rows) == 1
    row = rows[0]
    assert row['store'] == 'dk' and row['ss_action'] == 'monitor'
    assert row['ss_path'] == '/products/berit-kjole' and row['day'] == row['ts'][:10]


def test_wrong_token_answers_204_and_appends_nothing(client, _sandbox):
    r = _post(client, _record(), path='/api/spy_shield/not-the-token')
    assert r.status_code == 204 and r.data == b''
    assert _lines(_sandbox) == []
    assert server._SS_DROPPED['token'] == 1


def test_missing_server_token_rejects_everything(client, _sandbox, monkeypatch):
    monkeypatch.delenv('SPY_SHIELD_BEACON_TOKEN')
    r = _post(client, _record())
    assert r.status_code == 204
    assert _lines(_sandbox) == []


def test_kill_switch_drops_silently(client, _sandbox, monkeypatch):
    monkeypatch.setenv('SPY_SHIELD_BEACON', '0')
    assert _post(client, _record()).status_code == 204
    assert _lines(_sandbox) == []
    assert server._SS_DROPPED['off'] == 1


def test_oversized_body_is_dropped(client, _sandbox):
    big = _record(ss_info='x' * 3000)
    assert len(json.dumps(big)) > 2048
    r = _post(client, big)
    assert r.status_code == 204
    assert _lines(_sandbox) == []
    assert server._SS_DROPPED['size'] == 1


def test_broken_json_and_wrong_shape_are_dropped(client, _sandbox):
    assert _post(client, b'{not json').status_code == 204
    assert _post(client, {'event': 'other', 'ss_action': 'monitor'}).status_code == 204
    assert _post(client, _record(ss_action='nuke')).status_code == 204
    assert _post(client, b'[1,2]').status_code == 204
    assert _lines(_sandbox) == []
    assert server._SS_DROPPED['json'] == 1 and server._SS_DROPPED['shape'] == 3


def test_get_never_serves_the_log(client, _sandbox):
    # POST only; nothing in the response can reveal whether the token was right.
    assert client.get(POST_PATH).status_code == 405


def test_field_whitelist_and_truncation(client, _sandbox):
    body = _record(ss_reason='r' * 500, ss_pt='1', ss_utm=True, ss_repeat='nope',
                   evil_field='drop me', cookie='session=abc')
    _post(client, body)
    row = _lines(_sandbox)[0]
    assert 'evil_field' not in row and 'cookie' not in row
    assert len(row['ss_reason']) == 200
    assert row['ss_pt'] == 1 and row['ss_utm'] == 1 and row['ss_repeat'] == 0
    assert set(row) == {'ts', 'day', 'store', 'browser_key', *server._SS_FIELDS}


def test_unknown_store_maps_to_unknown(client, _sandbox):
    _post(client, _record(ss_store='zzz-99'))
    assert _lines(_sandbox)[0]['store'] == 'unknown'


def test_browser_key_holds_no_ip_or_ua_and_rotates_daily(client, _sandbox, monkeypatch):
    _post(client, _record())
    row = _lines(_sandbox)[0]
    text = json.dumps(row)
    assert '203.0.113.9' not in text and 'test-ua' not in text and 'ss_ua' not in row
    assert len(row['browser_key']) == 64
    # Same browser, same day → same key (unique-browser counting works)…
    _post(client, _record(ss_path='/products/other'))
    assert _lines(_sandbox)[1]['browser_key'] == row['browser_key']
    # …different day → different key (the salt rotates).
    tomorrow = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1)
    monkeypatch.setattr(server, '_ss_utcnow', lambda: tomorrow)
    _post(client, _record())
    assert _lines(_sandbox)[2]['browser_key'] != row['browser_key']
    # A different IP behind the same UA is a different browser.
    _post(client, _record(), headers={**HDRS, 'X-Forwarded-For': '198.51.100.7'})
    assert _lines(_sandbox)[3]['browser_key'] != _lines(_sandbox)[2]['browser_key']


def test_per_ip_rate_limit_trips_at_30_per_minute(client, _sandbox):
    for _ in range(35):
        assert _post(client, _record()).status_code == 204
    assert len(_lines(_sandbox)) == 30
    assert server._SS_DROPPED['rate_ip'] == 5
    # Another IP still gets through.
    _post(client, _record(), headers={**HDRS, 'X-Forwarded-For': '198.51.100.7'})
    assert len(_lines(_sandbox)) == 31


def test_global_daily_cap_drops_silently(client, _sandbox, monkeypatch):
    monkeypatch.setitem(server._SS_LIMITS, 'per_day', 2)
    for _ in range(4):
        assert _post(client, _record()).status_code == 204
    assert len(_lines(_sandbox)) == 2
    assert server._SS_DROPPED['rate_day'] == 2


def test_beacon_has_no_side_effects_beyond_the_append(client, _sandbox, monkeypatch):
    calls = []
    monkeypatch.setattr(server.req, 'post', lambda *a, **k: calls.append(a) or None)
    monkeypatch.setattr(server, '_shopify_call', lambda *a, **k: calls.append(a) or None)
    _post(client, _record(ss_action='block'))
    assert len(_lines(_sandbox)) == 1
    assert calls == []


# ── summary ───────────────────────────────────────────────────────────────────

def _write_rows(tmp_path, rows, corrupt=True):
    p = tmp_path / 'spy_shield.jsonl'
    text = '\n'.join(json.dumps(r) for r in rows) + '\n'
    if corrupt:
        text += '{"broken": \n'
    p.write_text(text, encoding='utf-8')


def _row(store, action, ts, **over):
    r = {'ts': ts, 'day': ts[:10], 'store': store, 'browser_key': 'k' + store, 'ss_v': '2.0.0',
         'ss_store': 'x', 'ss_mode': 'monitor', 'ss_pt': 0, 'ss_action': action,
         'ss_tier': 'block' if action != 'allow' else '', 'ss_reason': 'ref:app.ppspy.com',
         'ss_signals': '', 'ss_info': '', 'ss_phase': 'head', 'ss_ref_host': '', 'ss_clickid': 0,
         'ss_utm': 0, 'ss_repeat': 0, 'ss_path': '/products/a'}
    r.update(over)
    return r


def _iso(delta_hours=0, delta_days=0):
    t = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=delta_hours, days=delta_days)
    return t.strftime('%Y-%m-%dT%H:%M:%SZ')


def test_summary_aggregates_and_tolerates_corrupt_lines(client, _sandbox, monkeypatch):
    monkeypatch.setattr(server, '_spy_shield_orders', lambda store, days: [])
    _write_rows(_sandbox, [
        _row('dk', 'monitor', _iso(1)),
        _row('dk', 'monitor', _iso(2), browser_key='k2', ss_repeat=1, ss_reason='ext:ppspy'),
        _row('dk', 'block', _iso(3), ss_pt=1),
        _row('fr', 'allow', _iso(4), ss_tier=''),
        _row('fr', 'monitor', _iso(0, delta_days=40)),      # outside the window
    ])
    r = client.get('/api/spy_shield/summary?days=14')
    assert r.status_code == 200
    s = r.get_json()
    assert s['configured'] is True
    assert s['beacon_url'] == f'https://188-166-11-177.nip.io/api/spy_shield/{TOKEN}'
    dk = s['stores']['dk']
    assert dk['name'] == 'Vionna DK' and dk['total'] == 3
    assert dk['by_action'] == {'allow': 0, 'monitor': 2, 'block': 1}
    assert dk['by_reason'][0] == ['ref:app.ppspy.com', 2]
    assert dk['unique_browsers'] == 2 and dk['repeat_hits'] == 1
    assert dk['pt_alarm'] == 1 and dk['block_tier_hits'] == 3
    assert sum(d['monitor'] + d['block'] for d in dk['daily']) == 3
    assert len(dk['last_hits']) == 3 and all('browser_key' not in h for h in dk['last_hits'])
    assert s['stores']['fr']['total'] == 1           # the 40-day-old row is excluded
    assert s['totals']['total'] == 4 and s['totals']['unique_browsers'] == 3
    assert s['buyers_flagged']['count'] == 0
    assert 'Vionna DK/FR/FI only' in s['buyers_flagged']['note']


def test_summary_store_filter_and_unconfigured(client, _sandbox, monkeypatch):
    monkeypatch.delenv('SPY_SHIELD_BEACON_TOKEN')
    monkeypatch.setattr(server, '_spy_shield_orders', lambda store, days: [])
    _write_rows(_sandbox, [_row('dk', 'monitor', _iso(1)), _row('fr', 'monitor', _iso(1))])
    s = client.get('/api/spy_shield/summary?days=7&store=fr').get_json()
    assert s['configured'] is False and s['beacon_url'] is None
    assert list(s['stores']) == ['fr'] and s['totals']['total'] == 1
    assert client.get('/api/spy_shield/summary?store=xx').status_code == 400


def test_buyers_join_matches_path_within_60_minutes(client, _sandbox, monkeypatch):
    hit_at = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=5)
    hit_ts = hit_at.strftime('%Y-%m-%dT%H:%M:%SZ')
    _write_rows(_sandbox, [
        _row('dk', 'block', hit_ts, ss_path='/products/berit-kjole', ss_reason='ext:ppspy'),
        _row('fr', 'monitor', hit_ts, ss_path='/products/berit-robe', ss_tier='monitor'),  # monitor-tier: never joins
    ])
    fake_orders = {
        'dk': [
            {'order_name': '#1001', 'created_at': (hit_at + datetime.timedelta(minutes=30)).isoformat(),
             'landing_site': '/products/berit-kjole'},                         # match
            {'order_name': '#1002', 'created_at': (hit_at + datetime.timedelta(minutes=90)).isoformat(),
             'landing_site': '/products/berit-kjole'},                         # outside the window
            {'order_name': '#1003', 'created_at': (hit_at - datetime.timedelta(minutes=10)).isoformat(),
             'landing_site': '/products/other'},                               # other path
        ],
        'fr': [
            {'order_name': '#2001', 'created_at': hit_at.isoformat(), 'landing_site': '/products/berit-robe'},
        ],
        'fi': [],
    }
    monkeypatch.setattr(server, '_spy_shield_orders', lambda store, days: fake_orders[store])
    s = client.get('/api/spy_shield/summary?days=14').get_json()
    b = s['buyers_flagged']
    assert b['count'] == 1
    assert b['orders'][0]['order_name'] == '#1001' and b['orders'][0]['store'] == 'dk'
    assert b['orders'][0]['matched_reason'] == 'ext:ppspy'
    assert b['supported_stores'] == ['dk', 'fr', 'fi']


def test_buyers_count_is_null_when_orders_unreadable(client, _sandbox, monkeypatch):
    _write_rows(_sandbox, [_row('dk', 'block', _iso(1))])
    monkeypatch.setattr(server, '_spy_shield_orders', lambda store, days: None)
    b = client.get('/api/spy_shield/summary?days=14').get_json()['buyers_flagged']
    assert b['count'] is None
    assert 'DK' in b['note'] and 'not proof' in b['note']


def test_orders_helper_strips_query_and_caches(client, _sandbox, monkeypatch):
    class _R:
        status_code = 200
        headers = {}

        def json(self):
            return {'orders': [{'id': 1, 'name': '#5', 'created_at': '2026-09-25T10:00:00+02:00',
                                'landing_site': '/products/berit?utm_source=x&email=a@b.c'}]}
    calls = []
    monkeypatch.setattr(server, '_shopify_call', lambda *a, **k: calls.append(a) or _R())
    monkeypatch.setattr(server, 'shopify_headers', lambda st: {'X-Shopify-Access-Token': 't'})
    monkeypatch.setitem(server.STORES, 'dk', 'x.myshopify.com')
    rows = server._spy_shield_orders('dk', 14)
    assert rows == [{'order_name': '#5', 'created_at': '2026-09-25T10:00:00+02:00',
                     'landing_site': '/products/berit'}]
    server._spy_shield_orders('dk', 14)
    assert len(calls) == 1                     # second call served from the cache


def test_orders_helper_returns_none_without_token(client, _sandbox, monkeypatch):
    monkeypatch.setattr(server, 'shopify_headers', lambda st: {'X-Shopify-Access-Token': ''})
    assert server._spy_shield_orders('fi', 14) is None


# ── digest line ───────────────────────────────────────────────────────────────

def test_digest_line_is_silent_without_data_and_counts_with(client, _sandbox, monkeypatch):
    monkeypatch.setattr(server, '_spy_shield_orders', lambda store, days: [])
    assert server._spy_shield_digest_line(14) is None
    _write_rows(_sandbox, [_row('dk', 'monitor', _iso(1)), _row('dk', 'monitor', _iso(2), browser_key='q'),
                           _row('fr', 'block', _iso(3), ss_pt=1)])
    line = server._spy_shield_digest_line(14)
    # Same vocabulary as the tab tiles: would-be blocks (block-tier), 502s shown, buyers in flagged sessions.
    assert line.startswith('🛡️ Spy Shield (14d): 3 would-be blocks, 1 502s getoond, 0 buyers in flagged sessions, 3 browser-dagen')
    assert 'DK 2 / FR 1' in line
    # 1 of 3 records from a preview theme, 3 hours old → above 5 % and recent → the warning fires.
    assert 'ss_pt=1' in line and '33%' in line


# ── setup + gates ─────────────────────────────────────────────────────────────

def test_setup_mints_persists_and_applies_live(client, _sandbox, monkeypatch):
    monkeypatch.delenv('SPY_SHIELD_BEACON_TOKEN')
    r = client.post('/api/spy_shield/setup', json={})
    assert r.status_code == 200
    body = r.get_json()
    assert body['ok'] and body['configured'] and body['rotated'] is False
    tok = os.environ['SPY_SHIELD_BEACON_TOKEN']
    assert len(tok) >= 24 and body['beacon_url'].endswith('/api/spy_shield/' + tok)
    env = (_sandbox / '.env').read_text(encoding='utf-8')
    assert f'SPY_SHIELD_BEACON_TOKEN={tok}\n' in env
    # The freshly minted token is accepted by the beacon right away (no restart).
    _post(client, _record(), path='/api/spy_shield/' + tok)
    assert len(_lines(_sandbox)) == 1
    # Without rotate the same URL comes back; with rotate a new one.
    assert client.post('/api/spy_shield/setup', json={}).get_json()['beacon_url'] == body['beacon_url']
    r2 = client.post('/api/spy_shield/setup', json={'rotate': True}).get_json()
    assert r2['rotated'] is True and r2['beacon_url'] != body['beacon_url']
    assert os.environ['SPY_SHIELD_BEACON_TOKEN'] != tok


def test_setup_and_summary_require_the_gate(client, _sandbox, monkeypatch):
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', 'a-real-secret')
    assert client.post('/api/spy_shield/setup', json={}).status_code == 401
    assert client.get('/api/spy_shield/summary').status_code == 401
    # The shared cron secret opens the summary (master-dashboard), never setup.
    monkeypatch.setenv('NOTIFY_SECRET', 'cron-secret')
    assert client.get('/api/spy_shield/summary', headers={'X-Notify-Token': 'cron-secret'}).status_code == 200
    assert client.get('/api/spy_shield/summary', headers={'X-Notify-Token': 'wrong'}).status_code == 401
    assert client.post('/api/spy_shield/setup', json={}, headers={'X-Notify-Token': 'cron-secret'}).status_code == 401


def test_beacon_token_is_on_the_env_allowlist_and_log_is_backed_up():
    assert 'SPY_SHIELD_BEACON_TOKEN' in server._ENV_ALLOWED_KEYS
    assert server.SPY_SHIELD_LOG_PATH.endswith('spy_shield.jsonl')
