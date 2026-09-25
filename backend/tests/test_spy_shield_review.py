"""Review follow-ups for the Spy Shield beacon (v1.315.0).

Each test started life as an adversarial probe in the v1.314 review (abuse /
privacy / correctness lens); the assertions now state the FIXED behaviour, so
a failing test here means a regression of a reviewed finding:

- client IP = LAST X-Forwarded-For hop (Caddy's), never the poster's first hop
- per-IP daily cap (300) next to the per-minute one: one source cannot eat the
  20 000/day global budget
- browser_key salt never falls back to the public beacon token
- X-Notify-Token readers get the numbers, never the write token (beacon_url)
- a lone-surrogate JSON escape is rejected as `shape` BEFORE it costs rate budget
- the orders cache is keyed per (store, window); None is only held 60 s
- period window = today + days-1 (days=7 → 7 calendar days)
- the log is bounded: daily prune to 90 days + hard size cap (drop as `full`)
- digest tick posts once per day across restarts (state on disk), prunes daily
- ss_pt alarm needs share (> 5 % or > 10) AND recency (< 2 days)
- summary carries first_hit_at / active_days / utm_hits / matched_browsers
"""
import datetime
import json
import os

import pytest

import server

TOKEN = 'test-beacon-token'
POST_PATH = f'/api/spy_shield/{TOKEN}'
HDRS = {'X-Forwarded-For': '10.0.0.1, 203.0.113.9', 'User-Agent': 'Mozilla/5.0 test-ua'}


@pytest.fixture(autouse=True)
def _sandbox(tmp_path, monkeypatch):
    monkeypatch.setattr(server, 'SPY_SHIELD_LOG_PATH', str(tmp_path / 'spy_shield.jsonl'))
    monkeypatch.setattr(server, 'SPY_SHIELD_DIGEST_STATE', str(tmp_path / 'spy_shield_digest.json'))
    monkeypatch.setattr(server, 'ENV_PATH', str(tmp_path / '.env'))
    monkeypatch.setenv('SPY_SHIELD_BEACON_TOKEN', TOKEN)
    monkeypatch.delenv('SPY_SHIELD_BEACON', raising=False)
    monkeypatch.delenv('NOTIFY_SECRET', raising=False)
    monkeypatch.setenv('DEV_LOCAL', '1')
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', '')
    monkeypatch.setattr(server, '_SS_RATE', {'ip': {}, 'ip_day': {}, 'day': '', 'day_count': 0})
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


def _raw_lines(tmp_path):
    p = tmp_path / 'spy_shield.jsonl'
    return p.read_bytes().split(b'\n') if p.exists() else []


def _rows(tmp_path):
    return [json.loads(l) for l in _raw_lines(tmp_path) if l.strip()]


def _iso(delta_hours=0, delta_days=0):
    t = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=delta_hours, days=delta_days)
    return t.strftime('%Y-%m-%dT%H:%M:%SZ')


def _row(store, action, ts, **over):
    r = {'ts': ts, 'day': ts[:10], 'store': store, 'browser_key': 'k' + store, 'ss_v': '2.0.0',
         'ss_store': 'x', 'ss_mode': 'monitor', 'ss_pt': 0, 'ss_action': action,
         'ss_tier': 'block' if action != 'allow' else '', 'ss_reason': 'ref:app.ppspy.com',
         'ss_signals': '', 'ss_info': '', 'ss_phase': 'head', 'ss_ref_host': '', 'ss_clickid': 0,
         'ss_utm': 0, 'ss_repeat': 0, 'ss_path': '/products/a'}
    r.update(over)
    return r


def _write_rows(tmp_path, rows):
    (tmp_path / 'spy_shield.jsonl').write_text('\n'.join(json.dumps(r) for r in rows) + '\n', encoding='utf-8')


# ── log injection ────────────────────────────────────────────────────────────

def test_newline_crlf_and_control_chars_never_split_the_jsonl(client, _sandbox):
    evil = 'a\nb\r\nc\x00d\x1e{"fake":1} {"ts":"x"}z é'
    _post(client, _record(ss_reason=evil, ss_path=evil, ss_info=evil))
    raw = _raw_lines(_sandbox)
    assert len([l for l in raw if l.strip()]) == 1           # exactly one physical line
    assert all(b < 0x80 for b in raw[0])                     # ASCII-only on disk
    rows = server._blog_read_jsonl(server.SPY_SHIELD_LOG_PATH)  # same reader the summary uses
    assert len(rows) == 1 and rows[0]['ss_reason'] == evil


def test_lone_surrogate_escape_is_rejected_before_it_costs_budget(client, _sandbox):
    # "\ud800" is valid JSON but not encodable as UTF-8: rejected as `shape`,
    # nothing written, no rate budget spent, no ingest error.
    r = _post(client, b'{"event":"spy_shield","ss_action":"monitor","ss_reason":"\\ud800"}')
    assert r.status_code == 204
    assert _rows(_sandbox) == []
    assert server._SS_DROPPED['shape'] == 1 and server._SS_DROPPED['error'] == 0
    assert server._SS_RATE['day_count'] == 0


def test_deeply_nested_json_bomb_is_dropped(client, _sandbox):
    bomb = b'[' * 1000 + b']' * 1000
    assert len(bomb) <= 2048
    r = _post(client, bomb)
    assert r.status_code == 204
    assert _rows(_sandbox) == []
    assert server._SS_DROPPED['json'] + server._SS_DROPPED['shape'] + server._SS_DROPPED['error'] == 1


def test_slash_in_token_is_404_not_204(client, _sandbox):
    # Flask's default converter refuses '/', so a path-shaped token answers 404 —
    # the only status other than 204 an unauthenticated poster can obtain.
    r = _post(client, _record(), path='/api/spy_shield/a/b')
    assert r.status_code == 404


def test_post_to_summary_path_hits_the_beacon_not_405(client, _sandbox):
    r = _post(client, _record(), path='/api/spy_shield/summary')
    assert r.status_code == 204 and server._SS_DROPPED['token'] == 1


# ── rate-limit keying ────────────────────────────────────────────────────────

def test_client_ip_is_the_last_xff_hop_via_loopback_only(client, _sandbox):
    """Caddy (loopback) appends the real client LAST. A spoofed first hop must
    not split the per-IP bucket: 60 posts with 60 different first hops from ONE
    real client trip the 30/min limit."""
    for i in range(60):
        _post(client, _record(), headers={**HDRS, 'X-Forwarded-For': f'10.0.{i}.1, 203.0.113.9'})
    assert len(_rows(_sandbox)) == 30
    assert server._SS_DROPPED['rate_ip'] == 30
    # A real different client (different last hop) has its own bucket.
    _post(client, _record(), headers={**HDRS, 'X-Forwarded-For': '10.0.0.1, 198.51.100.7'})
    assert len(_rows(_sandbox)) == 31


def test_xff_is_ignored_when_the_request_did_not_come_through_the_proxy(client, _sandbox):
    """Reached directly (remote_addr not loopback) the header is untrusted: the
    key is remote_addr, so spoofed XFF values collapse into one bucket."""
    with server.app.test_request_context('/', headers={'X-Forwarded-For': '1.2.3.4, 5.6.7.8'},
                                         environ_base={'REMOTE_ADDR': '203.0.113.50'}):
        assert server._ss_client_ip() == '203.0.113.50'
    with server.app.test_request_context('/', headers={'X-Forwarded-For': '1.2.3.4, 5.6.7.8'},
                                         environ_base={'REMOTE_ADDR': '127.0.0.1'}):
        assert server._ss_client_ip() == '5.6.7.8'
    with server.app.test_request_context('/', environ_base={'REMOTE_ADDR': '127.0.0.1'}):
        assert server._ss_client_ip() == '127.0.0.1'


def test_one_ip_cannot_exhaust_the_global_daily_cap(client, _sandbox, monkeypatch):
    """30/min × 24 h = 43 200 > 20 000/day: without a per-IP daily cap one source
    blinds the pipeline for the rest of the UTC day. Now: 300/day per IP."""
    monkeypatch.setitem(server._SS_LIMITS, 'per_ip_day', 40)
    monkeypatch.setitem(server._SS_LIMITS, 'per_day', 1000)
    t = [0.0]
    monkeypatch.setattr(server.time, 'monotonic', lambda: t[0])
    for _ in range(30):
        _post(client, _record())
    t[0] += 61
    for _ in range(30):
        _post(client, _record())
    assert len(_rows(_sandbox)) == 40                  # 30 + 10, then the daily per-IP cap
    assert server._SS_DROPPED['rate_ip'] == 20 and server._SS_DROPPED['rate_day'] == 0
    # A legitimate store hit from another IP still gets through.
    _post(client, _record(), headers={**HDRS, 'X-Forwarded-For': '10.0.0.1, 198.51.100.7'})
    assert len(_rows(_sandbox)) == 41
    # The per-IP day counter resets with the UTC day.
    tomorrow = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1)
    monkeypatch.setattr(server, '_ss_utcnow', lambda: tomorrow)
    _post(client, _record())
    assert len(_rows(_sandbox)) == 42


def test_bind_host_defaults_to_loopback():
    """The 30/min-per-IP promise only holds when every request passes Caddy:
    Flask must not listen on 0.0.0.0 (was reachable on :5000 from the internet)."""
    src = open(server.__file__, encoding='utf-8').read()
    assert "host = os.environ.get('BIND_HOST', '127.0.0.1')" in src
    assert "app.run(debug=False, host=host, port=port)" in src
    assert "host='0.0.0.0'" not in src


# ── privacy ──────────────────────────────────────────────────────────────────

def test_salt_never_falls_back_to_the_public_beacon_token(client, _sandbox):
    """DROPLET_TOKEN_SECRET unset → a random per-process salt, so browser_key is
    not sha256(public token + day + ip + ua)."""
    _post(client, _record())
    row = _rows(_sandbox)[0]
    salt = server.hashlib.sha256((TOKEN + row['day']).encode()).hexdigest()
    guess = server.hashlib.sha256((salt + '203.0.113.9' + 'Mozilla/5.0 test-ua').encode()).hexdigest()
    assert guess != row['browser_key']
    assert len(server._SS_PROCESS_SALT) == 64


def test_notify_token_holder_gets_numbers_but_not_the_write_token(client, _sandbox, monkeypatch):
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', 'a-real-secret')
    monkeypatch.setenv('NOTIFY_SECRET', 'cron-secret')
    monkeypatch.setattr(server, '_spy_shield_orders', lambda store, days: [])
    s = client.get('/api/spy_shield/summary', headers={'X-Notify-Token': 'cron-secret'}).get_json()
    assert s['configured'] is True and s['beacon_url'] is None
    assert TOKEN not in json.dumps(s)
    # The dashboard session still receives it.
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', '')
    s2 = client.get('/api/spy_shield/summary').get_json()
    assert s2['beacon_url'] and TOKEN in s2['beacon_url']


# ── poisoning the summary / stop-criterion ───────────────────────────────────

def test_forged_buyer_flag_shows_its_browser_concentration(client, _sandbox, monkeypatch):
    """The token is public, so one POST can still forge a red buyer row — the
    summary now says how many browsers are behind it so the operator checks the
    order instead of trusting the tile."""
    now = datetime.datetime.now(datetime.timezone.utc)
    monkeypatch.setattr(server, '_spy_shield_orders', lambda store, days: [
        {'order_name': '#9001', 'created_at': now.isoformat(), 'landing_site': '/products/berit-kjole'}])
    _post(client, _record(ss_tier='block', ss_action='monitor', ss_path='/products/berit-kjole', ss_pt=1))
    s = server._spy_shield_summary(days=14)
    b = s['buyers_flagged']
    assert b['count'] == 1 and b['matched_browsers'] == 1 and b['block_tier_browsers'] == 1
    assert b['orders'][0]['matched_mode'] == 'monitor'
    assert 'by page and time, not by cookie' in b['note']
    # One preview-theme record out of one is 100 % and recent → alarm active…
    assert s['totals']['pt_alarm'] == 1 and s['totals']['pt_alarm_active'] is True


def test_pt_alarm_needs_share_and_recency(client, _sandbox, monkeypatch):
    monkeypatch.setattr(server, '_spy_shield_orders', lambda store, days: [])
    # 2 preview records among 100 (2 %, ≤ 10) → venek testing the duplicate, not an alarm.
    rows = [_row('dk', 'monitor', _iso(h)) for h in range(1, 99)]
    rows += [_row('dk', 'monitor', _iso(1), ss_pt=1), _row('dk', 'monitor', _iso(2), ss_pt=1)]
    _write_rows(_sandbox, rows)
    s = server._spy_shield_summary(days=14)
    assert s['totals']['pt_alarm'] == 2 and s['totals']['pt_alarm_active'] is False
    assert 'ss_pt' not in server._spy_shield_digest_line(14)
    # 12 preview records (> 10) but all 5 days old → the testing is over, not an alarm.
    _write_rows(_sandbox, [_row('dk', 'monitor', _iso(0, 5), ss_pt=1) for _ in range(12)]
                + [_row('dk', 'monitor', _iso(1))])
    s = server._spy_shield_summary(days=14)
    assert s['totals']['pt_alarm'] == 12 and s['totals']['pt_alarm_active'] is False
    # 12 recent preview records → alarm (share AND recency).
    _write_rows(_sandbox, [_row('dk', 'monitor', _iso(1), ss_pt=1) for _ in range(12)]
                + [_row('dk', 'monitor', _iso(1))])
    s = server._spy_shield_summary(days=14)
    assert s['totals']['pt_alarm_active'] is True and s['stores']['dk']['pt_alarm_active'] is True
    assert '92%' in server._spy_shield_digest_line(14)


def test_digest_line_contains_no_poster_controlled_text(client, _sandbox, monkeypatch):
    monkeypatch.setattr(server, '_spy_shield_orders', lambda store, days: [])
    _post(client, _record(ss_reason='<@channel>\nEVIL', ss_store='<@here>', ss_path='\r\nX'))
    line = server._spy_shield_digest_line(14)
    assert 'EVIL' not in line and '@here' not in line and '\n' not in line and '\r' not in line
    assert 'UNKNOWN 1' in line


def test_digest_line_warns_when_records_were_dropped(client, _sandbox, monkeypatch):
    monkeypatch.setattr(server, '_spy_shield_orders', lambda store, days: [])
    _post(client, _record())
    server._SS_DROPPED['rate_day'] = 3
    server._SS_DROPPED['token'] = 7
    line = server._spy_shield_digest_line(14)
    assert 'log kan onvolledig zijn' in line and '7 beacons met oude/verkeerde URL' in line


# ── summary shape for the tab ────────────────────────────────────────────────

def test_summary_carries_first_hit_active_days_and_utm(client, _sandbox, monkeypatch):
    monkeypatch.setattr(server, '_spy_shield_orders', lambda store, days: [])
    first = _iso(0, 9)
    _write_rows(_sandbox, [_row('dk', 'monitor', first), _row('dk', 'monitor', _iso(0, 3), ss_utm=1),
                           _row('dk', 'monitor', _iso(1), ss_utm=1), _row('dk', 'monitor', _iso(2))])
    dk = server._spy_shield_summary(days=14)['stores']['dk']
    assert dk['first_hit_at'] == first and dk['active_days'] == 3 and dk['utm_hits'] == 2
    assert server._spy_shield_summary(days=14)['totals']['utm_hits'] == 2


def test_period_window_is_today_plus_days_minus_one(client, _sandbox, monkeypatch):
    monkeypatch.setattr(server, '_spy_shield_orders', lambda store, days: [])
    _write_rows(_sandbox, [_row('dk', 'monitor', _iso(0, 6)), _row('fr', 'monitor', _iso(0, 7))])
    s = server._spy_shield_summary(days=7)
    assert list(s['stores']) == ['dk']            # 7 days old = the 8th calendar day → out
    assert server._spy_shield_summary(days=8)['totals']['total'] == 2


def test_summary_exposes_limits_and_log_full_flag(client, _sandbox, monkeypatch):
    monkeypatch.setattr(server, '_spy_shield_orders', lambda store, days: [])
    s = server._spy_shield_summary(days=14)
    assert s['log_full'] is False and s['limits']['per_ip_day'] == 300 and s['limits']['retention_days'] == 90


# ── orders cache ─────────────────────────────────────────────────────────────

def test_orders_cache_is_keyed_per_window_and_none_is_short_lived(client, _sandbox, monkeypatch):
    class _R:
        status_code = 200
        headers = {}

        def json(self):
            return {'orders': []}
    calls = []
    monkeypatch.setattr(server, '_shopify_call', lambda *a, **k: calls.append(a[1]) or _R())
    monkeypatch.setattr(server, 'shopify_headers', lambda st: {'X-Shopify-Access-Token': 't'})
    monkeypatch.setitem(server.STORES, 'dk', 'x.myshopify.com')
    server._spy_shield_orders('dk', 7)
    server._spy_shield_orders('dk', 30)
    assert len(calls) == 2 and calls[0] != calls[1]       # a wider window is a new fetch
    server._spy_shield_orders('dk', 30)
    assert len(calls) == 2                                 # …and then cached
    # None (no token) is remembered for 60 s only, not 30 min.
    monkeypatch.setattr(server, 'shopify_headers', lambda st: {'X-Shopify-Access-Token': ''})
    assert server._spy_shield_orders('fr', 14) is None
    t = [1000.0]
    monkeypatch.setattr(server.time, 'monotonic', lambda: t[0])
    server._SS_ORDERS_CACHE[('fr', 14)] = (t[0], None)
    monkeypatch.setattr(server, 'shopify_headers', lambda st: {'X-Shopify-Access-Token': 't'})
    monkeypatch.setitem(server.STORES, 'fr', 'y.myshopify.com')
    assert server._spy_shield_orders('fr', 14) is None     # still within 60 s
    t[0] += 61
    assert server._spy_shield_orders('fr', 14) == []       # refetched after the short TTL


# ── retention / size cap ─────────────────────────────────────────────────────

def test_prune_keeps_only_the_retention_window(client, _sandbox, monkeypatch):
    _write_rows(_sandbox, [_row('dk', 'monitor', _iso(0, 100)), _row('dk', 'monitor', _iso(0, 89)),
                           _row('dk', 'monitor', _iso(1))])
    (_sandbox / 'spy_shield.jsonl').open('a', encoding='utf-8').write('{"broken": \n')
    removed = server._ss_prune()
    assert removed == 2                                    # the 100-day-old row + the broken line
    rows = _rows(_sandbox)
    assert len(rows) == 2 and not (_sandbox / 'spy_shield.jsonl.tmp').exists()
    assert server._ss_prune() == 0                         # idempotent
    monkeypatch.setattr(server, 'SPY_SHIELD_LOG_PATH', str(_sandbox / 'missing.jsonl'))
    assert server._ss_prune() == 0                         # no file → no-op


def test_log_above_the_size_cap_drops_as_full(client, _sandbox, monkeypatch):
    _post(client, _record())
    assert len(_rows(_sandbox)) == 1
    monkeypatch.setitem(server._SS_LIMITS, 'max_bytes', 10)
    assert _post(client, _record()).status_code == 204
    assert len(_rows(_sandbox)) == 1 and server._SS_DROPPED['full'] == 1
    assert server._SS_RATE['day_count'] == 1               # no budget spent on the drop


def test_digest_tick_posts_once_per_day_across_restarts_and_prunes(client, _sandbox, monkeypatch):
    monkeypatch.setattr(server, '_spy_shield_orders', lambda store, days: [])
    monkeypatch.setattr(server, '_slack_webhook_url', lambda: 'https://hooks.example/x')
    _write_rows(_sandbox, [_row('dk', 'monitor', _iso(1)), _row('dk', 'monitor', _iso(0, 200))])
    posts = []
    post = lambda url, text: posts.append(text)
    at_0905 = datetime.datetime(2026, 9, 25, 9, 6)
    assert server._spy_shield_digest_tick(at_0905, post) == ['pruned 1', 'posted']
    assert len(posts) == 1 and posts[0].startswith('🛡️ Spy Shield (14d)')
    # A "restart" (fresh loop state) the same morning must not post again: the day is on disk.
    assert server._spy_shield_digest_tick(at_0905 + datetime.timedelta(minutes=10), post) == []
    assert len(posts) == 1
    state = json.loads((_sandbox / 'spy_shield_digest.json').read_text(encoding='utf-8'))
    assert state == {'pruned_day': '2026-09-25', 'posted_day': '2026-09-25'}
    # Next day, outside the 09:05 slot: prune only.
    assert server._spy_shield_digest_tick(datetime.datetime(2026, 9, 26, 3, 0), post) == ['pruned 0']
    assert server._spy_shield_digest_tick(datetime.datetime(2026, 9, 26, 9, 30), post) == ['posted']


# ── setup / .env ─────────────────────────────────────────────────────────────

def test_setup_token_is_env_safe_and_never_printed(client, _sandbox, capsys, monkeypatch):
    monkeypatch.delenv('SPY_SHIELD_BEACON_TOKEN')
    body = client.post('/api/spy_shield/setup', json={'rotate': 'yes'}).get_json()
    tok = body['beacon_url'].rsplit('/', 1)[1]
    assert server.re.fullmatch(r'[A-Za-z0-9_-]{32}', tok)
    out = capsys.readouterr().out
    assert tok not in out
    env = (_sandbox / '.env').read_text(encoding='utf-8')
    assert env.count('SPY_SHIELD_BEACON_TOKEN=') == 1


def test_env_write_still_refuses_other_keys():
    with pytest.raises(ValueError):
        server._env_write({'ANTHROPIC_API_KEY': 'x'})


def test_werkzeug_access_log_filter_hides_beacon_hits():
    import logging
    f = server._SpyShieldAccessLogFilter()
    hit = logging.LogRecord('werkzeug', 20, '', 0, '127.0.0.1 - - "POST /api/spy_shield/%s HTTP/1.1" 204 -', (TOKEN,), None)
    other = logging.LogRecord('werkzeug', 20, '', 0, '127.0.0.1 - - "GET /api/version HTTP/1.1" 200 -', (), None)
    assert f.filter(hit) is False and f.filter(other) is True
