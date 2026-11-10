"""Tests voor de ptest-teller (v1.326.0): A/B-test verzekerde verzending in de
TLS-cartlade.

De beacon-route is BEWUST ongegate (de lade post vanuit de browser), dus de
veiligheidseigenschappen zijn de tests — zelfde opzet als test_spy_shield.py:
verkeerd token, te grote body, kapotte JSON, onbekende groep/stap, kill switch en
rate-limit antwoorden allemaal 204 zonder body (geen orakel) en schrijven niets;
alleen ts/day/store/group/step/v komen in het log (nooit IP, UA of browser_key,
en v alleen als versie-tekst); de rate-limit heeft eigen tellers (ptest en Spy
Shield eten elkaars budget niet op) en is zo strak dat één IP geen hele dag kan
vervalsen. De summary telt in een venster in Amsterdamse tijd (since / aa_until /
until zoals ptest/analyse.py), zegt welke groep aantoonbaar meer winkelwagens laat
liggen (90%-marge), onthoudt drops over een herstart heen en noemt een venster
alleen compleet als er niets wegviel; hij snoeit hooguit 1x per dag tot 120
dagen, herstelt een vol log zelf en is gegate.
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
NOW = datetime.datetime(2026, 11, 20, 12, 0, tzinfo=UTC)     # 13:00 in Amsterdam


@pytest.fixture(autouse=True)
def _sandbox(tmp_path, monkeypatch):
    """Eigen logbestanden, open gate, verse limiters en tellers — van ptest én van
    Spy Shield, voor de test die bewijst dat ze elkaars budget niet opeten."""
    monkeypatch.setattr(server, 'PTEST_LOG_PATH', str(tmp_path / 'ptest.jsonl'))
    monkeypatch.setattr(server, 'PTEST_DROPS_PATH', str(tmp_path / 'ptest_drops.json'))
    monkeypatch.setattr(server, 'SPY_SHIELD_LOG_PATH', str(tmp_path / 'spy_shield.jsonl'))
    monkeypatch.setattr(server, 'ENV_PATH', str(tmp_path / '.env'))
    monkeypatch.setenv('SPY_SHIELD_BEACON_TOKEN', TOKEN)
    for name in ('PTEST_BEACON', 'SPY_SHIELD_BEACON', 'NOTIFY_SECRET', 'PUBLIC_BASE_URL',
                 'PTEST_SINCE', 'PTEST_AA_UNTIL', 'PTEST_UNTIL'):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv('DEV_LOCAL', '1')
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', '')
    monkeypatch.setattr(server, '_PTEST_RATE', {'ip': {}, 'ip_day': {}, 'day': '', 'day_count': 0})
    monkeypatch.setattr(server, '_SS_RATE', {'ip': {}, 'ip_day': {}, 'day': '', 'day_count': 0})
    monkeypatch.setattr(server, '_PTEST_PRUNED', {'day': ''})
    monkeypatch.setattr(server, '_PTEST_ACCEPTED', [0])
    # Het proces "startte" op NOW: een nieuwe drop-historie begint daar.
    monkeypatch.setattr(server, '_PTEST_STARTED_AT', NOW.strftime('%Y-%m-%dT%H:%M:%SZ'))
    _restart_drop_history(monkeypatch)
    for k in server._SS_DROPPED:
        server._SS_DROPPED[k] = 0
    return tmp_path


def _restart_drop_history(monkeypatch):
    """Wat een herstart doet: alles wat in het geheugen stond is weg."""
    monkeypatch.setattr(server, '_PTEST_DROPS', {'data': None, 'dirty': False, 'flushed': None})
    for k in server._PTEST_DROPPED:
        server._PTEST_DROPPED[k] = 0


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


def _drops_file(tmp_path):
    p = tmp_path / 'ptest_drops.json'
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else None


def _old_history(tmp_path, days=None, since='2026-01-01T00:00:00Z', through=''):
    """Een drop-historie die al lang bestaat (dus elk venster in de tests dekt)."""
    (tmp_path / 'ptest_drops.json').write_text(
        json.dumps({'since': since, 'days': days or {}, 'trimmed_through': through}), encoding='utf-8')


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
    assert server._PTEST_ACCEPTED[0] == 1


def test_de_store_checkout_step_and_every_group(client, _sandbox):
    for group in ('A', 'B', 'off', 'ch'):
        assert _post(client, _beacon(ss_store='5f729b-7d', group=group, step='checkout')).status_code == 204
    rows = _lines(_sandbox)
    assert [r['group'] for r in rows] == ['A', 'B', 'off', 'ch']
    assert {r['store'] for r in rows} == {'de'} and {r['step'] for r in rows} == {'checkout'}


def test_wrong_token_answers_204_appends_nothing_and_is_remembered(client, _sandbox, monkeypatch):
    monkeypatch.setattr(server, '_ss_utcnow', lambda: NOW)
    r = _post(client, _beacon(), path='/api/ptest/not-the-token')
    assert r.status_code == 204 and r.data == b''
    assert _lines(_sandbox) == []
    assert server._PTEST_DROPPED['token'] == 1 and server._PTEST_ACCEPTED[0] == 0
    assert _drops_file(_sandbox)['days'] == {'2026-11-20': {'token': 1}}


def test_missing_server_token_rejects_everything(client, _sandbox, monkeypatch):
    monkeypatch.delenv('SPY_SHIELD_BEACON_TOKEN')
    monkeypatch.setenv('SPY_SHIELD_BEACON_DERIVE', '0')
    assert _post(client, _beacon()).status_code == 204
    assert _lines(_sandbox) == [] and server._PTEST_DROPPED['token'] == 1


def test_same_token_as_spy_shield_including_the_derived_default(client, _sandbox, monkeypatch):
    """De lade-URL = de Spy Shield-beacon-URL met /api/ptest/ als pad — ook met
    het afgeleide standaard-token (geen expliciet token in .env)."""
    monkeypatch.delenv('SPY_SHIELD_BEACON_TOKEN')
    monkeypatch.delenv('SPY_SHIELD_BEACON_DERIVE', raising=False)
    monkeypatch.setattr(server, 'tokens', {'dk': {'shop': 'x.myshopify.com', 'token': 'shpat_testseed'}})
    derived = server.hashlib.sha256(b'spy-shield-beacon:shpat_testseed').hexdigest()[:32]
    assert server._ptest_beacon_url() == f'https://188-166-11-177.nip.io/api/ptest/{derived}'
    assert server._ptest_beacon_url() == server._ss_beacon_url().replace('/api/spy_shield/', '/api/ptest/')
    _post(client, _beacon(), path='/api/ptest/' + derived)
    assert len(_lines(_sandbox)) == 1


def test_kill_switch_is_its_own(client, _sandbox, monkeypatch):
    """PTEST_BEACON=0 zet alleen de ptest-teller uit; de Spy Shield-schakelaar
    raakt hem niet en andersom."""
    monkeypatch.setenv('PTEST_BEACON', '0')
    assert _post(client, _beacon()).status_code == 204
    assert _lines(_sandbox) == [] and server._PTEST_DROPPED['off'] == 1
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
    assert server._PTEST_DROPPED['size'] == 1


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
    assert server._PTEST_DROPPED['json'] >= 2 and server._PTEST_DROPPED['json'] + server._PTEST_DROPPED['size'] == 3
    assert server._PTEST_DROPPED['shape'] == len(shapes) and server._PTEST_DROPPED['error'] == 0
    assert server._PTEST_RATE['day_count'] == 0


def test_v_is_only_a_version_string_never_poster_text(client, _sandbox):
    """v komt als sleutel terug in versions en kan in een Slack-regel belanden:
    alleen [0-9A-Za-z._+-] (na afkappen op 16) blijft, de rest wordt '' — de
    winkelwagen telt wel (een rare versie mag geen echte telling kosten). Zo kan
    ook geen newline het JSONL splitsen en geen emoji de regel opblazen."""
    cases = [('<!channel>', ''), ('\U0001F600' * 16, ''), ('a\nb\r\n{"x":1}\x00', ''), ('\ud800', ''),
             ('1.2.3 beta', ''), (7, '7'), (None, ''), ('2.0.1-rc.1+b', '2.0.1-rc.1+b'),
             ('1.2.3-rc.4+build.567', '1.2.3-rc.4+build')]
    for i, (v, _) in enumerate(cases):
        _post(client, _beacon(v=v), headers={**HDRS, 'X-Forwarded-For': f'198.51.100.{i}'})
    assert [r['v'] for r in _lines(_sandbox)] == [want for _, want in cases]
    raw = (_sandbox / 'ptest.jsonl').read_bytes()
    assert raw.count(b'\n') == len(cases) and all(b < 0x80 for b in raw)   # één regel per record, ASCII
    assert max(len(l) for l in raw.splitlines()) < 130
    assert server._PTEST_DROPPED['shape'] == 0 and server._PTEST_DROPPED['error'] == 0


def test_whitelist_and_no_ip_ua_or_browser_key_on_disk(client, _sandbox):
    body = _beacon(ip='203.0.113.9', ua='Mozilla/5.0 test-ua', ss_ua='Mozilla/5.0 test-ua',
                   browser_key='abc', cookie='session=abc')
    _post(client, body)
    row = _lines(_sandbox)[0]
    assert set(row) == {'ts', 'day', 'store', 'group', 'step', 'v'}
    raw = (_sandbox / 'ptest.jsonl').read_text(encoding='utf-8')
    raw += (_sandbox / 'ptest_drops.json').read_text(encoding='utf-8')
    for leak in ('203.0.113.9', '10.0.0.1', 'test-ua', 'Mozilla', 'session=abc', 'browser_key', 'ced027-2'):
        assert leak not in raw


def test_store_mapping_known_full_domain_and_unknown(client, _sandbox):
    for store in ('zzz-99', 'ced027-2.myshopify.com', '', None, '86d3b0-76'):
        _post(client, _beacon(ss_store=store))
    assert [r['store'] for r in _lines(_sandbox)] == ['unknown', 'nl', 'unknown', 'unknown', 'dk']


def test_get_is_405_slash_token_404_and_post_on_summary_is_a_token_drop(client, _sandbox):
    assert client.get(POST_PATH).status_code == 405
    assert _post(client, _beacon(), path='/api/ptest/a/b').status_code == 404
    r = _post(client, _beacon(), path='/api/ptest/summary')
    assert r.status_code == 204 and r.data == b''
    assert server._PTEST_DROPPED['token'] == 1 and _lines(_sandbox) == []


def test_beacon_has_no_side_effects_beyond_the_append(client, _sandbox, monkeypatch):
    calls = []
    monkeypatch.setattr(server.req, 'post', lambda *a, **k: calls.append('post'))
    monkeypatch.setattr(server, '_shopify_call', lambda *a, **k: calls.append('shopify'))
    monkeypatch.setattr(server, '_ptest_prune', lambda *a, **k: calls.append('prune') or 0)
    _post(client, _beacon(step='checkout'))
    assert len(_lines(_sandbox)) == 1 and calls == []        # ook nooit snoeien vanuit de route
    # Naast het log alleen de eigen drop-historie (de eerste beacon start die).
    assert sorted(p.name for p in _sandbox.iterdir() if p.is_file()) == ['ptest.jsonl', 'ptest_drops.json']


def test_a_crash_inside_ingest_still_answers_an_empty_204(client, _sandbox, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError('disk on fire')
    monkeypatch.setattr(server, '_ptest_rate_allow', boom)
    r = _post(client, _beacon())
    assert r.status_code == 204 and r.data == b''
    assert server._PTEST_DROPPED['error'] == 1 and _lines(_sandbox) == []


# ── rate-limit ────────────────────────────────────────────────────────────────

def test_per_ip_rate_limit_per_minute(client, _sandbox):
    limit = server._PTEST_LIMITS['per_ip_min']
    for _ in range(limit + 5):
        assert _post(client, _beacon()).status_code == 204
    assert len(_lines(_sandbox)) == limit
    assert server._PTEST_DROPPED['rate_ip'] == 5
    _post(client, _beacon(), headers=OTHER_IP)               # een ander IP komt er gewoon door
    assert len(_lines(_sandbox)) == limit + 1


def test_spoofed_first_xff_hop_does_not_split_the_bucket(client, _sandbox):
    limit = server._PTEST_LIMITS['per_ip_min']
    for i in range(limit * 2):
        _post(client, _beacon(), headers={**HDRS, 'X-Forwarded-For': f'10.0.{i}.1, 203.0.113.9'})
    assert len(_lines(_sandbox)) == limit and server._PTEST_DROPPED['rate_ip'] == limit


def test_one_ip_can_forge_at_most_15_carts_a_day(client, _sandbox, monkeypatch):
    """Review: 200/dag per IP was ±100 nep-winkelwagens — de hele echte dag van
    NL+DE — vanaf één curl. Nu 30 records (15 winkelwagens) per IP per dag; een
    echte klant komt nooit aan 6 per minuut (hooguit 2 per winkelwagen)."""
    assert (server._PTEST_LIMITS['per_ip_min'], server._PTEST_LIMITS['per_ip_day']) == (6, 30)
    t = [0.0]
    monkeypatch.setattr(server.time, 'monotonic', lambda: t[0])
    for _ in range(10):                       # 10 minuten × 6: alleen het dagbudget remt
        for _ in range(6):
            _post(client, _beacon(group='B'))
        t[0] += 61
    assert len(_lines(_sandbox)) == 30 and server._PTEST_DROPPED['rate_ip'] == 30


def test_per_ip_daily_cap_and_global_daily_cap_reset_with_the_utc_day(client, _sandbox, monkeypatch):
    monkeypatch.setitem(server._PTEST_LIMITS, 'per_ip_min', 20)
    monkeypatch.setitem(server._PTEST_LIMITS, 'per_ip_day', 30)
    monkeypatch.setitem(server._PTEST_LIMITS, 'per_day', 35)
    t = [0.0]
    monkeypatch.setattr(server.time, 'monotonic', lambda: t[0])
    for _ in range(2):
        for _ in range(20):
            _post(client, _beacon())
        t[0] += 61
    assert len(_lines(_sandbox)) == 30                       # 20 + 10, dan de dag-grens per IP
    assert server._PTEST_DROPPED['rate_ip'] == 10 and server._PTEST_DROPPED['rate_day'] == 0
    for _ in range(10):
        _post(client, _beacon(), headers=OTHER_IP)
    assert len(_lines(_sandbox)) == 35                       # globaal dagbudget op
    assert server._PTEST_DROPPED['rate_day'] == 5
    tomorrow = datetime.datetime.now(UTC) + datetime.timedelta(days=1)
    monkeypatch.setattr(server, '_ss_utcnow', lambda: tomorrow)
    _post(client, _beacon())
    assert len(_lines(_sandbox)) == 36                       # nieuwe UTC-dag: weer open


def test_ptest_and_spy_shield_never_eat_each_others_budget(client, _sandbox):
    limit = server._PTEST_LIMITS['per_ip_min']
    for _ in range(limit + 3):
        _post(client, _beacon())
    assert len(_lines(_sandbox)) == limit and server._PTEST_DROPPED['rate_ip'] == 3
    # Zelfde IP, zelfde minuut: de Spy Shield-beacon heeft zijn eigen emmer…
    ss = {'event': 'spy_shield', 'ss_store': 'ced027-2', 'ss_action': 'monitor'}
    assert _post(client, ss, path=f'/api/spy_shield/{TOKEN}').status_code == 204
    assert len(_lines(_sandbox, 'spy_shield.jsonl')) == 1 and server._SS_DROPPED['rate_ip'] == 0
    # …en geen van beide telt mee in het dagbudget van de ander.
    assert server._SS_RATE['day_count'] == 1 and server._PTEST_RATE['day_count'] == limit


def test_log_above_the_size_cap_drops_as_full_without_spending_budget(client, _sandbox, monkeypatch):
    _post(client, _beacon())
    monkeypatch.setitem(server._PTEST_LIMITS, 'max_bytes', 10)
    assert _post(client, _beacon()).status_code == 204
    assert len(_lines(_sandbox)) == 1 and server._PTEST_DROPPED['full'] == 1
    assert server._PTEST_RATE['day_count'] == 1


# ── drop-historie: een herstart mag geen gat verstoppen ──────────────────────

def test_drops_are_kept_per_day_on_disk_and_survive_a_restart(client, _sandbox, monkeypatch):
    """Elke merge = self-update = herstart: met tellers in alleen het geheugen
    bewees 'dropped: 0' over een test van 4 weken niets. Een nieuwe (dag, reden)
    staat meteen op schijf, verdere tellingen hooguit 1x per minuut (een flood
    met een verkeerd token kost geen schijf-I/O per post)."""
    monkeypatch.setattr(server, '_ss_utcnow', lambda: NOW)
    t = [1000.0]
    monkeypatch.setattr(server.time, 'monotonic', lambda: t[0])
    wrong = '/api/ptest/old-url-after-a-rotate'
    _post(client, _beacon(), path=wrong)
    assert _drops_file(_sandbox)['days'] == {'2026-11-20': {'token': 1}}       # meteen
    _post(client, _beacon(), path=wrong)
    assert _drops_file(_sandbox)['days'] == {'2026-11-20': {'token': 1}}       # binnen de minuut: geheugen
    t[0] += 61
    _post(client, _beacon(), path=wrong)
    assert _drops_file(_sandbox)['days'] == {'2026-11-20': {'token': 3}}
    _post(client, _beacon(group='Z'))                                           # nieuwe reden: meteen
    assert _drops_file(_sandbox)['days'] == {'2026-11-20': {'token': 3, 'shape': 1}}
    _restart_drop_history(monkeypatch)
    s = client.get('/api/ptest/summary?since=2026-11-20T13:00').get_json()      # 13:00 Amsterdam = NOW
    assert s['dropped']['token'] == 0                                           # sinds de herstart…
    assert s['drops']['in_window'] == {'token': 3, 'shape': 1}                  # …maar niet vergeten
    assert s['drops']['history_since'] == '2026-11-20T12:00:00Z'
    assert s['complete'] is False
    lost = [w for w in s['warnings'] if 'vielen weg' in w]
    assert len(lost) == 1 and '4 beacon(s)' in lost[0] and 'token 3, shape 1' in lost[0]
    assert 'Rotate' in lost[0] and 'klopt de lade' in lost[0]


def test_complete_only_when_the_drop_history_covers_the_window(client, _sandbox, monkeypatch):
    monkeypatch.setattr(server, '_ss_utcnow', lambda: NOW)
    _write_rows(_sandbox, [_row('nl', 'A', 'cart', _ts(11, 18)), _row('nl', 'B', 'cart', _ts(11, 18, 11))],
                corrupt=False)
    # Geen historie: die begint nu, dus over 12-19 november valt niets te garanderen.
    s = client.get('/api/ptest/summary?since=2026-11-12').get_json()
    assert s['complete'] is False and s['drops']['history_since'] == '2026-11-20T12:00:00Z'
    assert any('pas sinds 20-11-2026 13:00 bijgehouden' in w for w in s['warnings'])
    # Een historie van vóór het venster zonder drops: compleet, geen enkele waarschuwing.
    _old_history(_sandbox)
    _restart_drop_history(monkeypatch)
    s = client.get('/api/ptest/summary?since=2026-11-12').get_json()
    assert s['complete'] is True and s['warnings'] == []
    # Een drop van vóór het venster telt niet, een drop erin wel.
    _old_history(_sandbox, days={'2026-11-10': {'rate_ip': 4}, '2026-11-19': {'json': 1}})
    _restart_drop_history(monkeypatch)
    s = client.get('/api/ptest/summary?since=2026-11-12').get_json()
    assert s['drops']['in_window'] == {'json': 1} and s['complete'] is False
    assert list(s['drops']['daily']) == ['2026-11-19']
    # Kapot historiebestand: nieuwe historie vanaf nu, dus weer niet compleet.
    (_sandbox / 'ptest_drops.json').write_text('{"since": ', encoding='utf-8')
    _restart_drop_history(monkeypatch)
    s = client.get('/api/ptest/summary?since=2026-11-12').get_json()
    assert s['complete'] is False and s['drops']['history_since'] == '2026-11-20T12:00:00Z'
    assert _drops_file(_sandbox)['since'] == '2026-11-20T12:00:00Z'
    # Een nieuwe historie begint bij de start van het proces, niet bij de eerste
    # beacon: tot die beacon viel er niets weg (anders bestond de historie al). Dus
    # een deploy vóór de start van de test → het venster kan compleet zijn.
    monkeypatch.setattr(server, '_PTEST_STARTED_AT', '2026-11-11T22:00:00Z')
    (_sandbox / 'ptest_drops.json').unlink()
    _restart_drop_history(monkeypatch)
    s = client.get('/api/ptest/summary?since=2026-11-12').get_json()   # 2026-11-11T23:00:00Z
    assert s['drops']['history_since'] == '2026-11-11T22:00:00Z' and s['complete'] is True


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


def _rates(cart, checkout):
    ab = max(0, cart - checkout)
    return {'cart': cart, 'checkout': checkout, 'abandoned': ab,
            'abandon_rate': round(ab / cart, 4) if cart else None,
            'checkout_rate': round(checkout / cart, 4) if cart else None}


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
    assert s['test_stores'] == ['nl', 'de'] and s['window']['since'] is None and s['aa'] is None
    assert s['daily'] == [
        {'day': '2026-11-18', 'period': 'test', 'store': 'nl', 'group': 'A', 'cart': 3, 'checkout': 1},
        {'day': '2026-11-18', 'period': 'test', 'store': 'nl', 'group': 'B', 'cart': 2, 'checkout': 2},
        {'day': '2026-11-19', 'period': 'test', 'store': 'de', 'group': 'B', 'cart': 0, 'checkout': 1},
        {'day': '2026-11-19', 'period': 'test', 'store': 'de', 'group': 'off', 'cart': 1, 'checkout': 0},
        {'day': '2026-11-19', 'period': 'test', 'store': 'de', 'group': 'ch', 'cart': 1, 'checkout': 0},
        {'day': '2026-11-19', 'period': 'test', 'store': 'nl', 'group': 'A', 'cart': 1, 'checkout': 0},
        {'day': '2026-11-19', 'period': 'test', 'store': 'unknown', 'group': 'A', 'cart': 1, 'checkout': 0},
    ]
    nl = s['totals']['nl']
    assert nl['A'] == {'cart': 4, 'checkout': 1, 'abandoned': 3, 'abandon_rate': 0.75, 'checkout_rate': 0.25}
    assert nl['B'] == _rates(2, 2) and nl['off'] == nl['ch'] == _rates(0, 0)
    assert s['totals']['de']['B'] == _rates(0, 1)               # geen deling door 0
    assert sorted(s['totals']) == ['de', 'nl', 'unknown']
    # totals_test = alleen nl + de: de 'unknown'-winkelwagen telt daar niet mee.
    assert s['totals_test']['A'] == _rates(4, 1) and s['totals_test']['B'] == _rates(2, 3)
    assert s['versions'] == {'de': {'1.0.0': 2, '1.0.1': 1}, 'nl': {'1.0.0': 9}, 'unknown': {'1.0.0': 1}}
    assert s['first_at'] == _ts(11, 18) and s['last_at'] == _ts(11, 19)
    assert set(s['dropped']) == set(server._PTEST_DROPPED) and s['log_full'] is False
    assert s['limits']['retention_days'] == 120 and 'abandoned = cart - checkout' in s['note']
    w = s['warnings']
    assert any(x.startswith('geen startmoment') for x in w)
    assert any('buiten nl/de (unknown 1)' in x for x in w)
    assert any('test B: meer checkouts dan winkelwagens (3 > 2)' in x for x in w)
    assert s['complete'] is False                                # de drop-historie begint pas nu


def test_summary_window_default_and_clamp(client, _sandbox, monkeypatch):
    monkeypatch.setattr(server, '_ss_utcnow', lambda: NOW)
    _write_rows(_sandbox, [_row('nl', 'A', 'cart', _ts(11, 14)), _row('nl', 'A', 'cart', _ts(11, 13))],
                corrupt=False)
    cart = lambda q: client.get('/api/ptest/summary' + q).get_json()['totals']['nl']['A']['cart']
    assert cart('?days=7') == 1             # vandaag (20 nov) + 6 Amsterdamse dagen terug = 14 t/m 20 nov
    assert cart('?days=8') == 2
    days = lambda q: client.get('/api/ptest/summary' + q).get_json()['days']
    assert days('') == 60 and days('?days=999') == 120 and days('?days=abc') == 60
    assert days('?days=0') == 60 and days('?days=-5') == 1
    assert days('?since=2026-11-01&days=7') is None              # met since telt days niet


def test_window_in_amsterdam_time_splits_the_aa_trial_from_the_test(client, _sandbox, monkeypatch):
    """Zelfde knip als analyse.py --since 2026-11-12 --aa-until 15-11-2026 --until
    2026-11-20: Amsterdamse middernacht = 23:00 UTC in november. Proefklikken van
    vóór de start en de A/A-dagen (B ook €2,95) verdunnen het A/B-verschil niet."""
    monkeypatch.setattr(server, '_ss_utcnow', lambda: NOW)
    _write_rows(_sandbox, [
        _row('nl', 'B', 'cart', '2026-11-11T22:59:59Z'),       # 11-11 23:59 Amsterdam: vóór de start
        _row('nl', 'B', 'cart', '2026-11-11T23:00:00Z'),       # 12-11 00:00: A/A
        _row('nl', 'A', 'cart', '2026-11-14T22:59:59Z'),       # 14-11 23:59: A/A
        _row('nl', 'A', 'cart', '2026-11-14T23:00:00Z'),       # 15-11 00:00: test
        _row('de', 'B', 'checkout', '2026-11-19T10:00:00Z'),
        _row('nl', 'A', 'cart', '2026-11-19T23:00:00Z'),       # 20-11 00:00: until ligt ervoor
    ], corrupt=False)
    s = client.get('/api/ptest/summary?since=2026-11-12&aa_until=15-11-2026&until=2026-11-20').get_json()
    w = s['window']
    assert (w['start'], w['since'], w['aa_until'], w['until']) == (
        '2026-11-11T23:00:00Z', '2026-11-11T23:00:00Z', '2026-11-14T23:00:00Z', '2026-11-19T23:00:00Z')
    assert w['tz'] == 'Europe/Amsterdam' and w['source'] == {'since': 'query', 'aa_until': 'query',
                                                             'until': 'query'}
    assert s['days'] is None
    assert [(r['day'], r['period'], r['store'], r['group'], r['cart'], r['checkout']) for r in s['daily']] == [
        ('2026-11-12', 'aa', 'nl', 'B', 1, 0), ('2026-11-14', 'aa', 'nl', 'A', 1, 0),
        ('2026-11-15', 'test', 'nl', 'A', 1, 0), ('2026-11-19', 'test', 'de', 'B', 0, 1)]
    assert s['aa']['totals_test']['A'] == _rates(1, 0) and s['aa']['totals_test']['B'] == _rates(1, 0)
    assert s['totals_test']['A'] == _rates(1, 0) and s['totals_test']['B'] == _rates(0, 1)
    assert s['first_at'] == '2026-11-11T23:00:00Z' and s['last_at'] == '2026-11-19T10:00:00Z'
    # Zomertijd: 1 oktober 00:00 Amsterdam = 30 september 22:00 UTC.
    assert client.get('/api/ptest/summary?since=2026-10-01').get_json()['window']['start'] == '2026-09-30T22:00:00Z'


def test_window_defaults_from_env_and_an_empty_query_param_overrides_them(client, _sandbox, monkeypatch):
    """PTEST_SINCE & co. één keer zetten bij de start: dan rekent elke lezer (ook
    master-dashboard via X-Notify-Token) met hetzelfde venster."""
    monkeypatch.setattr(server, '_ss_utcnow', lambda: NOW)
    _write_rows(_sandbox, [_row('nl', 'A', 'cart', _ts(11, 14)), _row('nl', 'A', 'cart', _ts(11, 16))],
                corrupt=False)
    monkeypatch.setenv('PTEST_SINCE', '15-11-2026')
    s = client.get('/api/ptest/summary').get_json()
    assert s['window']['since'] == '2026-11-14T23:00:00Z' and s['window']['source']['since'] == 'env'
    assert s['totals']['nl']['A']['cart'] == 1
    s = client.get('/api/ptest/summary?since=').get_json()      # leeg = geen grens (dan days=60)
    assert s['window']['since'] is None and s['window']['source']['since'] is None
    assert s['totals']['nl']['A']['cart'] == 2
    monkeypatch.setenv('PTEST_SINCE', 'volgende week')
    r = client.get('/api/ptest/summary')
    assert r.status_code == 400 and 'PTEST_SINCE in .env' in r.get_json()['error']


def test_bad_window_input_is_a_400_never_silently_ignored(client, _sandbox):
    for q, part in (('?since=morgen', 'since: unknown date'), ('?until=31-02-2026', 'until: unknown date'),
                    ('?since=2026-11-15&aa_until=2026-11-14', 'aa_until must be after since'),
                    ('?since=2026-11-15&until=2026-11-15', 'until must be after'),
                    ('?v=<!channel>', 'v: not a drawer version')):
        r = client.get('/api/ptest/summary' + q)
        assert r.status_code == 400 and part in r.get_json()['error'], q


def test_v_filter_and_the_version_change_warning(client, _sandbox, monkeypatch):
    monkeypatch.setattr(server, '_ss_utcnow', lambda: NOW)
    _old_history(_sandbox)
    _write_rows(_sandbox, [
        _row('nl', 'A', 'cart', _ts(11, 16), v='1.0.0'), _row('nl', 'B', 'cart', _ts(11, 16), v='1.0.0'),
        _row('nl', 'A', 'cart', _ts(11, 18), v='1.1.0'), _row('nl', 'B', 'cart', _ts(11, 18), v='1.1.0'),
        _row('nl', 'B', 'checkout', _ts(11, 18, 11), v='1.1.0')], corrupt=False)
    s = client.get('/api/ptest/summary?since=2026-11-15').get_json()
    assert s['totals_test']['B']['cart'] == 2
    assert any('meerdere lade-versies in de testperiode (1.1.0 3, 1.0.0 2)' in w for w in s['warnings'])
    s = client.get('/api/ptest/summary?since=2026-11-15&v=1.1.0').get_json()
    assert s['window']['v'] == ['1.1.0'] and s['totals_test']['B'] == _rates(1, 1)
    assert s['versions'] == {'nl': {'1.1.0': 3, '1.0.0': 2}}    # wat je wegfiltert blijft zichtbaar
    assert s['warnings'] == [] and s['complete'] is True


def test_comparison_says_which_group_leaves_more_carts_behind(client, _sandbox, monkeypatch):
    """De vraag van de test: welke groep laat meer winkelwagens liggen — als
    aandeel (de groepen zijn nooit precies even groot) en met een 90%-marge, met
    dezelfde rekensom (Wilson/Newcombe) als ptest/analyse.py."""
    monkeypatch.setattr(server, '_ss_utcnow', lambda: NOW)
    _old_history(_sandbox)
    rows = []

    def carts(store, group, n, checkouts):
        rows.extend(_row(store, group, 'cart', _ts(11, 18)) for _ in range(n))
        rows.extend(_row(store, group, 'checkout', _ts(11, 18, 11)) for _ in range(checkouts))
    carts('nl', 'A', 100, 80)
    carts('nl', 'B', 100, 40)                 # B laat 60% liggen, A 20%
    carts('de', 'A', 50, 25)
    carts('de', 'B', 50, 25)                  # gelijk
    carts('nl', 'off', 7, 0)                  # eigen toestellen: nooit in de vergelijking
    _write_rows(_sandbox, rows, corrupt=False)
    s = client.get('/api/ptest/summary?since=2026-11-15').get_json()
    nl = s['comparison']['nl']
    assert (nl['abandon_rate_a'], nl['abandon_rate_b'], nl['diff']) == (0.2, 0.6, 0.4)
    assert nl['diff_90'] == [0.2899, 0.496] and nl['more_abandoned'] == 'B' and nl['split_ok'] is True
    de = s['comparison']['de']
    assert de['diff'] == 0.0 and de['diff_90'][0] < 0 < de['diff_90'][1] and de['more_abandoned'] is None
    both = s['comparison']['test_stores']
    assert (both['carts_a'], both['carts_b'], both['abandon_rate_a'], both['abandon_rate_b']) == (150, 150, 0.3, 0.5667)
    assert both['more_abandoned'] == 'B'
    assert s['totals']['nl']['B']['abandon_rate'] == 0.6 and s['totals']['nl']['off']['cart'] == 7
    assert s['warnings'] == [] and s['complete'] is True
    # Zonder winkelwagens in A of B valt er (nog) niets te vergelijken.
    assert server._ptest_compare({'cart': 0, 'checkout': 0}, {'cart': 5, 'checkout': 1}) is None
    lo, hi = server._ptest_wilson(0, 10)
    assert lo == 0.0 and round(hi, 4) == 0.2129                  # 0 van 10: Wald zou [0, 0] zeggen


def test_lopsided_split_warns_of_a_drawer_bug_or_forged_posts(client, _sandbox, monkeypatch):
    """De lade loot 50/50. 160 tegen 100 is geen toeval (p < 0,001) maar een fout
    in de toewijzing of vervalste posts (het token is publiek); 115 tegen 100 wel."""
    monkeypatch.setattr(server, '_ss_utcnow', lambda: NOW)
    _old_history(_sandbox)
    for nb, alarm in ((160, True), (115, False)):
        rows = [_row('nl', 'A', 'cart', _ts(11, 18)) for _ in range(100)]
        rows += [_row('nl', 'B', 'cart', _ts(11, 18)) for _ in range(nb)]
        _write_rows(_sandbox, rows, corrupt=False)
        s = client.get('/api/ptest/summary?since=2026-11-15').get_json()
        assert s['comparison']['nl']['split_ok'] is (not alarm)
        hits = [w for w in s['warnings'] if 'A/B-verdeling wijkt sterk af' in w]
        assert bool(hits) is alarm
    s_160 = 'test nl: de A/B-verdeling wijkt sterk af van 50/50 (B 62% van 260 winkelwagens)'
    rows = [_row('nl', 'A', 'cart', _ts(11, 18)) for _ in range(100)]
    rows += [_row('nl', 'B', 'cart', _ts(11, 18)) for _ in range(160)]
    _write_rows(_sandbox, rows, corrupt=False)
    assert any(s_160 in w for w in client.get('/api/ptest/summary?since=2026-11-15').get_json()['warnings'])


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
    # 120 dagen terug (23 juli, UTC) blijft: daar staan de eerste Amsterdamse uren
    # van 24 juli, de oudste dag van ?days=120. 121 dagen terug gaat eruit.
    old, keep, recent = (_row('nl', 'A', 'cart', iso(121)), _row('nl', 'A', 'cart', '2026-07-23T22:30:00Z'),
                         _row('nl', 'B', 'cart', iso(1)))
    _write_rows(_sandbox, [old, keep, recent])               # + een kapotte regel
    s = client.get('/api/ptest/summary?days=120').get_json()
    assert [r['ts'] for r in _lines(_sandbox)] == [keep['ts'], recent['ts']]
    assert s['totals']['nl']['A']['cart'] == 1                # 24-07 00:30 Amsterdam telt mee
    assert not (_sandbox / 'ptest.jsonl.tmp').exists()
    # Dezelfde UTC-dag snoeit niet nog eens…
    with open(_sandbox / 'ptest.jsonl', 'a', encoding='utf-8') as f:
        f.write(json.dumps(old) + '\n')
    client.get('/api/ptest/summary')
    assert len(_lines(_sandbox)) == 3
    # …de volgende dag wel (en dan valt ook 'keep' eruit).
    monkeypatch.setattr(server, '_ss_utcnow', lambda: NOW + datetime.timedelta(days=1))
    client.get('/api/ptest/summary')
    assert [r['ts'] for r in _lines(_sandbox)] == [recent['ts']]


def test_prune_keeps_only_the_retention_window(client, _sandbox, monkeypatch):
    iso = lambda d: (NOW - datetime.timedelta(days=d)).strftime('%Y-%m-%dT%H:%M:%SZ')
    _write_rows(_sandbox, [_row('nl', 'A', 'cart', iso(130)), _row('nl', 'A', 'cart', iso(119)),
                           _row('de', 'B', 'checkout', iso(0))])
    assert server._ptest_prune(NOW) == 2                      # de 130 dagen oude regel + de kapotte
    assert len(_lines(_sandbox)) == 2 and not (_sandbox / 'ptest.jsonl.tmp').exists()
    assert server._ptest_prune(NOW) == 0                      # idempotent
    monkeypatch.setattr(server, 'PTEST_LOG_PATH', str(_sandbox / 'missing.jsonl'))
    assert server._ptest_prune(NOW) == 0                      # geen bestand → niets te doen


def test_a_full_log_heals_itself_and_the_summary_says_so(client, _sandbox, monkeypatch):
    """Na een flood bleef het log op de grens tot de flood verouderde (±100
    dagen) en viel elke echte beacon stil als 'full' weg. Nu snoeit de summary
    dan de oudste regels tot 80% van de grens, zet dat in de historie en zegt het."""
    monkeypatch.setattr(server, '_ss_utcnow', lambda: NOW)
    monkeypatch.setitem(server._PTEST_LIMITS, 'max_bytes', 3000)
    _old_history(_sandbox)
    rows = [_row('nl', 'A', 'cart', _ts(11, d, h)) for d in range(1, 11) for h in range(8, 12)]
    _write_rows(_sandbox, rows, corrupt=False)
    assert server._ptest_log_full()
    _post(client, _beacon())
    assert server._PTEST_DROPPED['full'] == 1
    s = client.get('/api/ptest/summary?since=2026-11-01').get_json()
    assert (_sandbox / 'ptest.jsonl').stat().st_size < 3000 and not server._ptest_log_full()
    kept = _lines(_sandbox)
    assert kept[-1]['ts'] == rows[-1]['ts'] and kept[0]['ts'] > rows[0]['ts']   # oudste eruit, nieuwste niet
    hist = _drops_file(_sandbox)
    assert hist['days']['2026-11-20'] == {'full': 1, 'trimmed': len(rows) - len(kept)}
    assert '2026-11-01' <= hist['trimmed_through'] <= kept[0]['day']
    assert s['complete'] is False and s['drops']['in_window'] == {'full': 1}   # 'trimmed' is geen drop
    assert s['drops']['trimmed_through'] == hist['trimmed_through']
    assert any(w.startswith('het log zat vol: de oudste regels t/m') for w in s['warnings'])
    _post(client, _beacon(), headers=OTHER_IP)                # en er wordt weer geteld
    assert len(_lines(_sandbox)) == len(kept) + 1


# ── log, backup, gitignore ────────────────────────────────────────────────────

def test_werkzeug_access_log_filter_hides_only_the_beacon_posts():
    f = server._SpyShieldAccessLogFilter()

    def rec(msg, *args):
        return logging.LogRecord('werkzeug', 20, '', 0, msg, args, None)
    assert f.filter(rec('127.0.0.1 - - "POST /api/ptest/%s HTTP/1.1" 204 -', TOKEN)) is False
    # Werkzeug kleurt een 204 met ANSI-codes om de hele regel: het pad blijft één stuk.
    styled = '\x1b[1m\x1b[35mPOST /api/ptest/' + TOKEN + ' HTTP/1.1\x1b[0m'
    assert f.filter(rec('127.0.0.1 - - [x] "%s" %s %s', styled, '204', '-')) is False
    # De gegate summary blijft zichtbaar in journald, ook een 401-poging.
    assert f.filter(rec('127.0.0.1 - - "GET /api/ptest/summary?days=60 HTTP/1.1" 401 -')) is True
    assert f.filter(rec('127.0.0.1 - - "POST /api/spy_shield/%s HTTP/1.1" 204 -', TOKEN)) is False
    assert f.filter(rec('127.0.0.1 - - "GET /api/version HTTP/1.1" 200 -')) is True


def test_log_and_drop_history_are_droplet_only_backed_up_and_never_committed():
    backend = os.path.dirname(os.path.abspath(server.__file__))
    with open(os.path.join(os.path.dirname(backend), '.gitignore'), encoding='utf-8') as f:
        ignored = {line.strip() for line in f}
    assert {'ptest.jsonl', 'backend/ptest.jsonl', 'backend/ptest.jsonl.tmp', 'ptest_drops.json',
            'backend/ptest_drops.json', 'backend/ptest_drops.json.tmp'} <= ignored
    backup = inspect.getsource(server._run_backup)
    assert "'ptest.jsonl'" in backup and "'ptest_drops.json'" in backup
    src = inspect.getsource(server)
    assert "PTEST_LOG_PATH = os.path.join(_BASE_DIR, 'ptest.jsonl')" in src
    assert "PTEST_DROPS_PATH = os.path.join(_BASE_DIR, 'ptest_drops.json')" in src
