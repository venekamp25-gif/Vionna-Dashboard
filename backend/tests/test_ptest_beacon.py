"""Tests voor de ptest-teller (v1.326.0): A/B-test verzekerde verzending in de
TLS-cartlade.

De beacon-route is BEWUST ongegate (de lade post vanuit de browser), dus de
veiligheidseigenschappen zijn de tests — zelfde opzet als test_spy_shield.py:
verkeerd token, te grote body, kapotte JSON, onbekende groep/stap, kill switch en
rate-limit antwoorden allemaal 204 zonder body (geen orakel) en schrijven niets;
alleen ts/day/store/group/step/v komen in het log (nooit IP, UA of browser_key);
de rate-limit heeft eigen tellers (ptest en Spy Shield eten elkaars budget niet
op); de summary telt per dag x winkel x groep x stap, rekent afgebroken
winkelwagens uit, snoeit hooguit 1x per dag tot 120 dagen en is gegate.
"""
import datetime
import inspect
import json
import logging
import os

import pytest

import server

TOKEN = 'test-beacon-token'
POST_PATH = f'/api/ptest/{TOKEN}'
# Caddy zet het echte client-IP als LAATSTE hop; de eerste hop stuurt de poster
# zelf mee, dus de tests vervalsen er een om te bewijzen dat hij genegeerd wordt.
HDRS = {'X-Forwarded-For': '10.0.0.1, 203.0.113.9', 'User-Agent': 'Mozilla/5.0 test-ua'}
OTHER_IP = {**HDRS, 'X-Forwarded-For': '10.0.0.1, 198.51.100.7'}
UTC = datetime.timezone.utc
NOW = datetime.datetime(2026, 11, 20, 12, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _sandbox(tmp_path, monkeypatch):
    """Eigen logbestanden, open gate, verse limiters en tellers — van ptest én van
    Spy Shield, voor de test die bewijst dat ze elkaars budget niet opeten."""
    monkeypatch.setattr(server, 'PTEST_LOG_PATH', str(tmp_path / 'ptest.jsonl'))
    monkeypatch.setattr(server, 'SPY_SHIELD_LOG_PATH', str(tmp_path / 'spy_shield.jsonl'))
    monkeypatch.setattr(server, 'ENV_PATH', str(tmp_path / '.env'))
    monkeypatch.setenv('SPY_SHIELD_BEACON_TOKEN', TOKEN)
    monkeypatch.delenv('PTEST_BEACON', raising=False)
    monkeypatch.delenv('SPY_SHIELD_BEACON', raising=False)
    monkeypatch.delenv('NOTIFY_SECRET', raising=False)
    monkeypatch.delenv('PUBLIC_BASE_URL', raising=False)
    monkeypatch.setenv('DEV_LOCAL', '1')
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', '')
    monkeypatch.setattr(server, '_PT_RATE', {'ip': {}, 'ip_day': {}, 'day': '', 'day_count': 0})
    monkeypatch.setattr(server, '_SS_RATE', {'ip': {}, 'ip_day': {}, 'day': '', 'day_count': 0})
    monkeypatch.setattr(server, '_PT_PRUNED', {'day': ''})
    monkeypatch.setattr(server, '_PT_ACCEPTED', [0])
    for k in server._PT_DROPPED:
        server._PT_DROPPED[k] = 0
    for k in server._SS_DROPPED:
        server._SS_DROPPED[k] = 0
    return tmp_path


@pytest.fixture()
def client():
    server.app.config['TESTING'] = True
    with server.app.test_client() as c:
        yield c


def _beacon(**over):
    """Wat de lade stuurt: ss_store = eerste label van shop.permanent_domain."""
    rec = {'event': 'ptest', 'ss_store': 'ced027-2', 'group': 'A', 'step': 'cart', 'v': '1.0.0'}
    rec.update(over)
    return rec


def _post(client, body, path=POST_PATH, headers=None):
    # navigator.sendBeacon(url, string) stuurt precies dit Content-Type.
    data = body if isinstance(body, (bytes, str)) else json.dumps(body)
    return client.post(path, data=data, content_type='text/plain;charset=UTF-8',
                       headers=headers or HDRS)


def _lines(tmp_path, name='ptest.jsonl'):
    p = tmp_path / name
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text(encoding='utf-8').splitlines() if l.strip()]


# ── beacon-route ──────────────────────────────────────────────────────────────

def test_valid_beacon_is_one_minimal_line_and_answers_empty_204(client, _sandbox):
    r = _post(client, _beacon())
    assert r.status_code == 204 and r.data == b''
    rows = _lines(_sandbox)
    assert len(rows) == 1
    row = rows[0]
    assert list(row) == ['ts', 'day', 'store', 'group', 'step', 'v']
    assert (row['store'], row['group'], row['step'], row['v']) == ('nl', 'A', 'cart', '1.0.0')
    assert row['day'] == row['ts'][:10]
    assert server._PT_ACCEPTED[0] == 1


def test_de_store_checkout_step_and_every_group(client, _sandbox):
    for group in ('A', 'B', 'off', 'ch'):
        assert _post(client, _beacon(ss_store='5f729b-7d', group=group, step='checkout')).status_code == 204
    rows = _lines(_sandbox)
    assert [r['group'] for r in rows] == ['A', 'B', 'off', 'ch']
    assert {r['store'] for r in rows} == {'de'} and {r['step'] for r in rows} == {'checkout'}


def test_wrong_token_answers_204_and_appends_nothing(client, _sandbox):
    r = _post(client, _beacon(), path='/api/ptest/not-the-token')
    assert r.status_code == 204 and r.data == b''
    assert _lines(_sandbox) == []
    assert server._PT_DROPPED['token'] == 1 and server._PT_ACCEPTED[0] == 0


def test_missing_server_token_rejects_everything(client, _sandbox, monkeypatch):
    monkeypatch.delenv('SPY_SHIELD_BEACON_TOKEN')
    monkeypatch.setenv('SPY_SHIELD_BEACON_DERIVE', '0')
    assert _post(client, _beacon()).status_code == 204
    assert _lines(_sandbox) == [] and server._PT_DROPPED['token'] == 1


def test_same_token_as_spy_shield_including_the_derived_default(client, _sandbox, monkeypatch):
    """De lade-URL = de Spy Shield-beacon-URL met /api/ptest/ als pad — ook met
    het afgeleide standaard-token (geen expliciet token in .env)."""
    monkeypatch.delenv('SPY_SHIELD_BEACON_TOKEN')
    monkeypatch.delenv('SPY_SHIELD_BEACON_DERIVE', raising=False)
    monkeypatch.setattr(server, 'tokens', {'dk': {'shop': 'x.myshopify.com', 'token': 'shpat_testseed'}})
    derived = server.hashlib.sha256(b'spy-shield-beacon:shpat_testseed').hexdigest()[:32]
    assert server._pt_beacon_url() == f'https://188-166-11-177.nip.io/api/ptest/{derived}'
    assert server._pt_beacon_url() == server._ss_beacon_url().replace('/api/spy_shield/', '/api/ptest/')
    _post(client, _beacon(), path='/api/ptest/' + derived)
    assert len(_lines(_sandbox)) == 1


def test_kill_switch_is_its_own(client, _sandbox, monkeypatch):
    """PTEST_BEACON=0 zet alleen de ptest-teller uit; de Spy Shield-schakelaar
    raakt hem niet en andersom."""
    monkeypatch.setenv('PTEST_BEACON', '0')
    assert _post(client, _beacon()).status_code == 204
    assert _lines(_sandbox) == [] and server._PT_DROPPED['off'] == 1
    ss = {'event': 'spy_shield', 'ss_store': 'ced027-2', 'ss_action': 'monitor'}
    _post(client, ss, path=f'/api/spy_shield/{TOKEN}')
    assert len(_lines(_sandbox, 'spy_shield.jsonl')) == 1
    monkeypatch.delenv('PTEST_BEACON')
    monkeypatch.setenv('SPY_SHIELD_BEACON', '0')
    _post(client, _beacon())
    assert len(_lines(_sandbox)) == 1


def test_body_limit_is_1_kb(client, _sandbox):
    """Precies 1024 bytes mag nog, 1025 niet — ook al zou Spy Shield (2 KB) hem lezen.
    Het onbekende veld 'pad' wordt genegeerd (whitelist), de grootte beslist eerst."""
    base = len(json.dumps(_beacon(pad='')))
    exact = json.dumps(_beacon(pad='x' * (1024 - base)))
    over = json.dumps(_beacon(pad='x' * (1025 - base)))
    assert len(exact) == 1024 and len(over) == 1025
    _post(client, exact)
    _post(client, over)
    rows = _lines(_sandbox)
    assert len(rows) == 1 and 'pad' not in rows[0]
    assert server._PT_DROPPED['size'] == 1


def test_broken_json_and_unknown_values_are_dropped_before_they_cost_budget(client, _sandbox):
    for body in (b'{not json', b'{"event":"ptest","group":"A",'):
        assert _post(client, body).status_code == 204
    # Lege body: de testclient stuurt dan geen Content-Length → 'size' (anders 'json').
    assert _post(client, b'').status_code == 204
    shapes = [b'[1,2]', b'"ptest"',
              {'event': 'spy_shield', 'ss_action': 'monitor'},   # Spy Shield-record op de ptest-URL
              {'event': 'ptest', 'step': 'cart'},                # geen groep
              _beacon(group='C'), _beacon(group='a'), _beacon(group=['A']), _beacon(group=None),
              _beacon(step='purchase'), _beacon(step={'cart': 1}), _beacon(event='PTEST')]
    for body in shapes:
        assert _post(client, body).status_code == 204
    assert _lines(_sandbox) == []
    assert server._PT_DROPPED['json'] >= 2 and server._PT_DROPPED['json'] + server._PT_DROPPED['size'] == 3
    assert server._PT_DROPPED['shape'] == len(shapes) and server._PT_DROPPED['error'] == 0
    assert server._PT_RATE['day_count'] == 0


def test_lone_surrogate_is_rejected_as_shape_without_spending_budget(client, _sandbox):
    r = _post(client, b'{"event":"ptest","ss_store":"ced027-2","group":"A","step":"cart","v":"\\ud800"}')
    assert r.status_code == 204 and _lines(_sandbox) == []
    assert server._PT_DROPPED['shape'] == 1 and server._PT_DROPPED['error'] == 0
    assert server._PT_RATE['day_count'] == 0


def test_whitelist_truncation_and_no_ip_ua_or_browser_key_on_disk(client, _sandbox):
    body = _beacon(v='1.2.3-rc.4+build.567', ip='203.0.113.9', ua='Mozilla/5.0 test-ua',
                   ss_ua='Mozilla/5.0 test-ua', browser_key='abc', cookie='session=abc')
    _post(client, body)
    row = _lines(_sandbox)[0]
    assert set(row) == {'ts', 'day', 'store', 'group', 'step', 'v'}
    assert row['v'] == '1.2.3-rc.4+build'                 # afgekapt op 16 tekens
    raw = (_sandbox / 'ptest.jsonl').read_text(encoding='utf-8')
    for leak in ('203.0.113.9', '10.0.0.1', 'test-ua', 'Mozilla', 'session=abc', 'browser_key', 'ced027-2'):
        assert leak not in raw


def test_newlines_and_control_chars_never_split_the_jsonl(client, _sandbox):
    evil = 'a\nb\r\n{"x":1}\x00'
    _post(client, _beacon(v=evil))
    raw = (_sandbox / 'ptest.jsonl').read_bytes()
    assert raw.count(b'\n') == 1 and all(b < 0x80 for b in raw)   # één regel, alleen ASCII
    assert server._blog_read_jsonl(server.PTEST_LOG_PATH)[0]['v'] == evil


def test_store_mapping_known_full_domain_and_unknown(client, _sandbox):
    for store in ('zzz-99', 'ced027-2.myshopify.com', '', None, '86d3b0-76'):
        _post(client, _beacon(ss_store=store))
    assert [r['store'] for r in _lines(_sandbox)] == ['unknown', 'nl', 'unknown', 'unknown', 'dk']


def test_get_is_405_slash_token_404_and_post_on_summary_is_a_token_drop(client, _sandbox):
    assert client.get(POST_PATH).status_code == 405
    assert _post(client, _beacon(), path='/api/ptest/a/b').status_code == 404
    r = _post(client, _beacon(), path='/api/ptest/summary')
    assert r.status_code == 204 and r.data == b''
    assert server._PT_DROPPED['token'] == 1 and _lines(_sandbox) == []


def test_beacon_has_no_side_effects_beyond_the_append(client, _sandbox, monkeypatch):
    calls = []
    monkeypatch.setattr(server.req, 'post', lambda *a, **k: calls.append('post'))
    monkeypatch.setattr(server, '_shopify_call', lambda *a, **k: calls.append('shopify'))
    monkeypatch.setattr(server, '_pt_prune', lambda *a, **k: calls.append('prune') or 0)
    _post(client, _beacon(step='checkout'))
    assert len(_lines(_sandbox)) == 1 and calls == []        # ook nooit snoeien vanuit de route


def test_a_crash_inside_ingest_still_answers_an_empty_204(client, _sandbox, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError('disk on fire')
    monkeypatch.setattr(server, '_pt_rate_allow', boom)
    r = _post(client, _beacon())
    assert r.status_code == 204 and r.data == b''
    assert server._PT_DROPPED['error'] == 1 and _lines(_sandbox) == []


# ── rate-limit ────────────────────────────────────────────────────────────────

def test_per_ip_rate_limit_per_minute(client, _sandbox):
    limit = server._PT_LIMITS['per_ip_min']
    for _ in range(limit + 5):
        assert _post(client, _beacon()).status_code == 204
    assert len(_lines(_sandbox)) == limit
    assert server._PT_DROPPED['rate_ip'] == 5
    _post(client, _beacon(), headers=OTHER_IP)               # een ander IP komt er gewoon door
    assert len(_lines(_sandbox)) == limit + 1


def test_spoofed_first_xff_hop_does_not_split_the_bucket(client, _sandbox):
    limit = server._PT_LIMITS['per_ip_min']
    for i in range(limit * 2):
        _post(client, _beacon(), headers={**HDRS, 'X-Forwarded-For': f'10.0.{i}.1, 203.0.113.9'})
    assert len(_lines(_sandbox)) == limit and server._PT_DROPPED['rate_ip'] == limit


def test_per_ip_daily_cap_and_global_daily_cap_reset_with_the_utc_day(client, _sandbox, monkeypatch):
    monkeypatch.setitem(server._PT_LIMITS, 'per_ip_day', 30)
    monkeypatch.setitem(server._PT_LIMITS, 'per_day', 35)
    t = [0.0]
    monkeypatch.setattr(server.time, 'monotonic', lambda: t[0])
    for _ in range(2):
        for _ in range(20):
            _post(client, _beacon())
        t[0] += 61
    assert len(_lines(_sandbox)) == 30                       # 20 + 10, dan de dag-grens per IP
    assert server._PT_DROPPED['rate_ip'] == 10 and server._PT_DROPPED['rate_day'] == 0
    for _ in range(10):
        _post(client, _beacon(), headers=OTHER_IP)
    assert len(_lines(_sandbox)) == 35                       # globaal dagbudget op
    assert server._PT_DROPPED['rate_day'] == 5
    tomorrow = datetime.datetime.now(UTC) + datetime.timedelta(days=1)
    monkeypatch.setattr(server, '_ss_utcnow', lambda: tomorrow)
    _post(client, _beacon())
    assert len(_lines(_sandbox)) == 36                       # nieuwe UTC-dag: weer open


def test_ptest_and_spy_shield_never_eat_each_others_budget(client, _sandbox):
    limit = server._PT_LIMITS['per_ip_min']
    for _ in range(limit + 3):
        _post(client, _beacon())
    assert len(_lines(_sandbox)) == limit and server._PT_DROPPED['rate_ip'] == 3
    # Zelfde IP, zelfde minuut: de Spy Shield-beacon heeft zijn eigen emmer…
    ss = {'event': 'spy_shield', 'ss_store': 'ced027-2', 'ss_action': 'monitor'}
    assert _post(client, ss, path=f'/api/spy_shield/{TOKEN}').status_code == 204
    assert len(_lines(_sandbox, 'spy_shield.jsonl')) == 1 and server._SS_DROPPED['rate_ip'] == 0
    # …en geen van beide telt mee in het dagbudget van de ander.
    assert server._SS_RATE['day_count'] == 1 and server._PT_RATE['day_count'] == limit


def test_log_above_the_size_cap_drops_as_full_without_spending_budget(client, _sandbox, monkeypatch):
    _post(client, _beacon())
    monkeypatch.setitem(server._PT_LIMITS, 'max_bytes', 10)
    assert _post(client, _beacon()).status_code == 204
    assert len(_lines(_sandbox)) == 1 and server._PT_DROPPED['full'] == 1
    assert server._PT_RATE['day_count'] == 1


# ── summary ───────────────────────────────────────────────────────────────────

def _ts(month, day, hh=10):
    return datetime.datetime(2026, month, day, hh, 0, tzinfo=UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def _row(store, group, step, ts, v='1.0.0'):
    return {'ts': ts, 'day': ts[:10], 'store': store, 'group': group, 'step': step, 'v': v}


def _write_rows(tmp_path, rows, corrupt=True):
    text = '\n'.join(json.dumps(r) for r in rows) + '\n'
    if corrupt:
        text += '{"broken": \n'
    (tmp_path / 'ptest.jsonl').write_text(text, encoding='utf-8')


def test_summary_counts_per_day_store_group_step_and_derives_abandoned(client, _sandbox, monkeypatch):
    monkeypatch.setattr(server, '_ss_utcnow', lambda: NOW)
    _write_rows(_sandbox, [
        # NL 18 nov: A 3 winkelwagens / 1 checkout, B 2 / 2
        _row('nl', 'A', 'cart', _ts(11, 18)), _row('nl', 'A', 'cart', _ts(11, 18, 11)),
        _row('nl', 'A', 'cart', _ts(11, 18, 12)), _row('nl', 'A', 'checkout', _ts(11, 18, 13)),
        _row('nl', 'B', 'cart', _ts(11, 18)), _row('nl', 'B', 'cart', _ts(11, 18, 11)),
        _row('nl', 'B', 'checkout', _ts(11, 18, 12)), _row('nl', 'B', 'checkout', _ts(11, 18, 13)),
        _row('nl', 'A', 'cart', _ts(11, 19)),
        # DE 19 nov: een checkout zonder cart-record (cart-beacon kwam niet aan) + off/ch
        _row('de', 'B', 'checkout', _ts(11, 19), v='1.0.1'),
        _row('de', 'off', 'cart', _ts(11, 19)), _row('de', 'ch', 'cart', _ts(11, 19)),
        _row('nl', 'A', 'cart', _ts(9, 1)),                    # buiten het venster van 60 dagen
        _row('nl', 'Z', 'cart', _ts(11, 19)), _row('nl', 'A', 'paid', _ts(11, 19)),  # nooit geteld
        _row('xx', 'A', 'cart', _ts(11, 19)),                  # onbekende winkelcode → unknown
    ])
    r = client.get('/api/ptest/summary')
    assert r.status_code == 200
    s = r.get_json()
    assert s['days'] == 60 and s['groups'] == ['A', 'B', 'off', 'ch'] and s['steps'] == ['cart', 'checkout']
    assert s['daily'] == [
        {'day': '2026-11-18', 'store': 'nl', 'group': 'A', 'cart': 3, 'checkout': 1},
        {'day': '2026-11-18', 'store': 'nl', 'group': 'B', 'cart': 2, 'checkout': 2},
        {'day': '2026-11-19', 'store': 'de', 'group': 'B', 'cart': 0, 'checkout': 1},
        {'day': '2026-11-19', 'store': 'de', 'group': 'off', 'cart': 1, 'checkout': 0},
        {'day': '2026-11-19', 'store': 'de', 'group': 'ch', 'cart': 1, 'checkout': 0},
        {'day': '2026-11-19', 'store': 'nl', 'group': 'A', 'cart': 1, 'checkout': 0},
        {'day': '2026-11-19', 'store': 'unknown', 'group': 'A', 'cart': 1, 'checkout': 0},
    ]
    nl = s['totals']['nl']
    assert nl['A'] == {'cart': 4, 'checkout': 1, 'abandoned': 3, 'checkout_rate': 0.25}
    assert nl['B'] == {'cart': 2, 'checkout': 2, 'abandoned': 0, 'checkout_rate': 1.0}
    assert nl['off'] == nl['ch'] == {'cart': 0, 'checkout': 0, 'abandoned': 0, 'checkout_rate': None}
    assert s['totals']['de']['B'] == {'cart': 0, 'checkout': 1, 'abandoned': 0, 'checkout_rate': None}
    assert sorted(s['totals']) == ['de', 'nl', 'unknown']
    assert s['totals_all']['A'] == {'cart': 5, 'checkout': 1, 'abandoned': 4, 'checkout_rate': 0.2}
    assert s['totals_all']['B'] == {'cart': 2, 'checkout': 3, 'abandoned': 0, 'checkout_rate': 1.5}
    assert s['versions'] == {'de': {'1.0.0': 2, '1.0.1': 1}, 'nl': {'1.0.0': 9}, 'unknown': {'1.0.0': 1}}
    assert s['first_at'] == _ts(11, 18) and s['last_at'] == _ts(11, 19)
    assert set(s['dropped']) == set(server._PT_DROPPED) and s['log_full'] is False
    assert s['limits']['retention_days'] == 120 and 'abandoned = cart - checkout' in s['note']


def test_summary_window_default_and_clamp(client, _sandbox, monkeypatch):
    monkeypatch.setattr(server, '_ss_utcnow', lambda: NOW)
    _write_rows(_sandbox, [_row('nl', 'A', 'cart', _ts(11, 14)), _row('nl', 'A', 'cart', _ts(11, 13))],
                corrupt=False)
    cart = lambda q: client.get('/api/ptest/summary' + q).get_json()['totals']['nl']['A']['cart']
    assert cart('?days=7') == 1             # vandaag (20 nov) + 6 dagen terug = 14 t/m 20 nov
    assert cart('?days=8') == 2
    days = lambda q: client.get('/api/ptest/summary' + q).get_json()['days']
    assert days('') == 60 and days('?days=999') == 120 and days('?days=abc') == 60
    assert days('?days=0') == 60 and days('?days=-5') == 1


def test_summary_is_gated_and_notify_readers_never_get_the_write_url(client, _sandbox, monkeypatch):
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', 'a-real-secret')
    assert client.get('/api/ptest/summary').status_code == 401
    monkeypatch.setenv('NOTIFY_SECRET', 'cron-secret')
    assert client.get('/api/ptest/summary', headers={'X-Notify-Token': 'wrong'}).status_code == 401
    r = client.get('/api/ptest/summary', headers={'X-Notify-Token': 'cron-secret'})
    assert r.status_code == 200
    s = r.get_json()
    assert s['configured'] is True and s['beacon_url'] is None and TOKEN not in json.dumps(s)
    # De dashboard-sessie krijgt de lade-URL wel.
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', '')
    s2 = client.get('/api/ptest/summary').get_json()
    assert s2['beacon_url'] == f'https://188-166-11-177.nip.io/api/ptest/{TOKEN}'


def test_summary_prunes_to_120_days_at_most_once_per_utc_day(client, _sandbox, monkeypatch):
    monkeypatch.setattr(server, '_ss_utcnow', lambda: NOW)
    iso = lambda d: (NOW - datetime.timedelta(days=d)).strftime('%Y-%m-%dT%H:%M:%SZ')
    old, keep, recent = (_row('nl', 'A', 'cart', iso(120)), _row('nl', 'A', 'cart', iso(119)),
                         _row('nl', 'B', 'cart', iso(1)))
    _write_rows(_sandbox, [old, keep, recent])               # + een kapotte regel
    client.get('/api/ptest/summary')
    assert [r['ts'] for r in _lines(_sandbox)] == [keep['ts'], recent['ts']]
    assert not (_sandbox / 'ptest.jsonl.tmp').exists()
    # Dezelfde UTC-dag snoeit niet nog eens…
    with open(_sandbox / 'ptest.jsonl', 'a', encoding='utf-8') as f:
        f.write(json.dumps(old) + '\n')
    client.get('/api/ptest/summary')
    assert len(_lines(_sandbox)) == 3
    # …de volgende dag wel (en dan valt ook 'keep' uit het venster).
    monkeypatch.setattr(server, '_ss_utcnow', lambda: NOW + datetime.timedelta(days=1))
    client.get('/api/ptest/summary')
    assert [r['ts'] for r in _lines(_sandbox)] == [recent['ts']]


def test_prune_keeps_only_the_retention_window(client, _sandbox, monkeypatch):
    iso = lambda d: (NOW - datetime.timedelta(days=d)).strftime('%Y-%m-%dT%H:%M:%SZ')
    _write_rows(_sandbox, [_row('nl', 'A', 'cart', iso(130)), _row('nl', 'A', 'cart', iso(119)),
                           _row('de', 'B', 'checkout', iso(0))])
    assert server._pt_prune(NOW) == 2                         # de 130 dagen oude regel + de kapotte
    assert len(_lines(_sandbox)) == 2 and not (_sandbox / 'ptest.jsonl.tmp').exists()
    assert server._pt_prune(NOW) == 0                         # idempotent
    monkeypatch.setattr(server, 'PTEST_LOG_PATH', str(_sandbox / 'missing.jsonl'))
    assert server._pt_prune(NOW) == 0                         # geen bestand → niets te doen


# ── log, backup, gitignore ────────────────────────────────────────────────────

def test_werkzeug_access_log_filter_hides_ptest_hits_too():
    f = server._SpyShieldAccessLogFilter()

    def rec(msg, *args):
        return logging.LogRecord('werkzeug', 20, '', 0, msg, args, None)
    assert f.filter(rec('127.0.0.1 - - "POST /api/ptest/%s HTTP/1.1" 204 -', TOKEN)) is False
    assert f.filter(rec('127.0.0.1 - - "GET /api/ptest/summary?days=60 HTTP/1.1" 200 -')) is False
    assert f.filter(rec('127.0.0.1 - - "POST /api/spy_shield/%s HTTP/1.1" 204 -', TOKEN)) is False
    assert f.filter(rec('127.0.0.1 - - "GET /api/version HTTP/1.1" 200 -')) is True


def test_log_is_droplet_only_backed_up_and_never_committed():
    backend = os.path.dirname(os.path.abspath(server.__file__))
    with open(os.path.join(os.path.dirname(backend), '.gitignore'), encoding='utf-8') as f:
        ignored = {line.strip() for line in f}
    assert {'ptest.jsonl', 'backend/ptest.jsonl', 'backend/ptest.jsonl.tmp'} <= ignored
    assert "'ptest.jsonl'" in inspect.getsource(server._run_backup)
    assert "PTEST_LOG_PATH = os.path.join(_BASE_DIR, 'ptest.jsonl')" in inspect.getsource(server)
