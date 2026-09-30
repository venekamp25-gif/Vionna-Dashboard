"""Honest daily Spy Shield line (digest 30 Sep 2026).

The 30-09 Slack line read "Spy Shield (14d): 96 would-be blocks … 0 buyers …
NL 397 / FR 90 / DK 27" and was read as "half of the 14 clean days done, 96
spies stopped". In fact the log began at the 28-09 go-live (day 2 of 14), the
96 were RECORDS (1-4 per page view, venek's own ?ss_sim tests included), the
store list was ALL records per store and "0 buyers" rested on 6 orders (DK 1).
These tests pin the honest version: real coverage, records next to
browser-days, operator tests counted apart, orders checked per store (only
those placed since the store's first live record) and one explicit
"KLAAR VOOR DK: ja/nee" verdict.
"""
import datetime
import json

import pytest

import server

UTC = datetime.timezone.utc
NOW = datetime.datetime(2026, 9, 30, 9, 5, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _sandbox(tmp_path, monkeypatch):
    monkeypatch.setattr(server, 'SPY_SHIELD_LOG_PATH', str(tmp_path / 'spy_shield.jsonl'))
    monkeypatch.setattr(server, 'SPY_SHIELD_DIGEST_STATE', str(tmp_path / 'spy_shield_digest.json'))
    monkeypatch.setattr(server, 'ENV_PATH', str(tmp_path / '.env'))
    monkeypatch.setenv('SPY_SHIELD_BEACON_TOKEN', 'test-beacon-token')
    monkeypatch.setenv('DEV_LOCAL', '1')
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', '')
    monkeypatch.setattr(server, '_SS_ORDERS_CACHE', {})
    monkeypatch.setattr(server, '_ss_utcnow', lambda: NOW)
    for k in server._SS_DROPPED:
        server._SS_DROPPED[k] = 0
    return tmp_path


def _ts(day, hh=10, mm=0):
    """'2026-09-<day>T<hh>:<mm>:00Z' (September 2026)."""
    return datetime.datetime(2026, 9, day, hh, mm, tzinfo=UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def _row(store, ts, **over):
    r = {'ts': ts, 'day': ts[:10], 'store': store, 'browser_key': 'k' + store, 'ss_v': '2.0.0',
         'ss_store': 'x', 'ss_mode': 'monitor', 'ss_pt': 0, 'ss_action': 'monitor',
         'ss_tier': 'block', 'ss_reason': 'ext:ppspy', 'ss_signals': 'ext:ppspy', 'ss_info': '',
         'ss_phase': 'late', 'ss_ref_host': '', 'ss_clickid': 0, 'ss_utm': 0, 'ss_repeat': 0,
         'ss_path': '/products/a'}
    r.update(over)
    return r


def _sim(store, ts, **over):
    """A ?ss_sim test from venek's own browser (needs the _ss_op cookie)."""
    base = {'ss_reason': 'sim:ref:app.ppspy.com', 'ss_signals': 'sim:ref:app.ppspy.com',
            'browser_key': 'k-venek', 'ss_phase': 'head'}
    base.update(over)
    return _row(store, ts, **base)


def _write(tmp_path, rows):
    (tmp_path / 'spy_shield.jsonl').write_text('\n'.join(json.dumps(r) for r in rows) + '\n',
                                               encoding='utf-8')


def _order(name, day, hh=12, path='/products/elsewhere'):
    return {'order_name': name, 'created_at': _ts(day, hh), 'landing_site': path}


def _orders(monkeypatch, per_store):
    monkeypatch.setattr(server, '_spy_shield_orders', lambda store, days: per_store.get(store, []))


# ── coverage ─────────────────────────────────────────────────────────────────

def test_digest_reports_coverage_since_the_first_live_record_not_the_window(_sandbox, monkeypatch):
    _orders(monkeypatch, {})
    _write(_sandbox, [
        # Before go-live: venek's duplicate-theme test (ss_pt=1) and a sim test —
        # neither may start the 14-day clock.
        _row('dk', _ts(21), ss_pt=1),
        _sim('dk', _ts(22)),
        # Go-live 28-09 ~08:09 UTC.
        _row('dk', _ts(28, 8, 10)),
        _row('nl', _ts(29, 14)),
        _row('dk', _ts(30, 7)),
    ])
    line = server._spy_shield_digest_line(14)
    assert line.startswith('🛡️ Spy Shield (data sinds 28-09, 2 dagen): ')
    assert '(14d)' not in line
    s = server._spy_shield_summary(days=14)
    assert s['first_seen'] == {'dk': _ts(28, 8, 10), 'nl': _ts(29, 14)}
    assert s['totals']['first_seen_at'] == _ts(28, 8, 10)
    # first_hit_at stays what it was for the tab: the oldest record in the window.
    assert s['stores']['dk']['first_hit_at'] == _ts(21)


def test_digest_says_the_numbers_cover_the_window_once_the_log_is_older(_sandbox, monkeypatch):
    _orders(monkeypatch, {})
    _write(_sandbox, [_row('dk', _ts(1)), _row('dk', _ts(29))])
    line = server._spy_shield_digest_line(14)
    assert line.startswith('🛡️ Spy Shield (data sinds 01-09, 29 dagen; cijfers over laatste 14d): ')
    assert 'would-be blocks 1 records' in line          # the 01-09 record is outside the 14-day window


# ── operator tests ───────────────────────────────────────────────────────────

def test_sim_records_are_not_counted_as_would_be_blocks_nor_as_buyers(_sandbox, monkeypatch):
    _write(_sandbox, [
        _row('dk', _ts(29, 10), browser_key='b1'),
        _row('dk', _ts(29, 11), browser_key='b2', ss_phase='final'),
        _sim('dk', _ts(29, 15), ss_path='/products/berit'),
        _sim('dk', _ts(29, 15, 1), ss_path='/products/berit', ss_phase='final'),
        _sim('dk', _ts(29, 16), ss_action='block', ss_mode='block'),
        # Top reason is a real extension, but the sim signal proves the _ss_op
        # cookie: the owner's own browser, which is never blocked for real.
        _row('dk', _ts(29, 17), browser_key='k-venek', ss_signals='sim:ext:ppspy|ext:ppspy'),
        _row('dk', _ts(29, 18), ss_tier='', ss_action='allow', ss_reason='op_cookie', ss_signals=''),
    ])
    # An order placed right on the sim page — must not turn into a red buyer row.
    _orders(monkeypatch, {'dk': [_order('#1001', 29, 15, path='/products/berit')]})
    s = server._spy_shield_summary(days=14)
    dk = s['stores']['dk']
    assert dk['block_tier_hits'] == 2 and dk['block_tier_browsers'] == 2
    assert dk['operator_tests'] == 5 and s['totals']['operator_tests'] == 5
    assert s['totals']['block_tier_hits'] == 2 and s['totals']['block_tier_browsers'] == 2
    assert dk['total'] == 7                               # still visible in the raw per-reason view
    b = s['buyers_flagged']
    assert b['count'] == 0 and b['orders'] == [] and b['block_tier_browsers'] == 2
    line = server._spy_shield_digest_line(14)
    assert 'would-be blocks 2 records / 2 browser-dagen (DK 2/2)' in line
    assert '5 operator tests (sim/op, niet meegeteld)' in line


def test_only_sim_records_mean_no_would_be_blocks_and_no_live_data(_sandbox, monkeypatch):
    _orders(monkeypatch, {})
    _write(_sandbox, [_sim('dk', _ts(30, 8)), _sim('dk', _ts(30, 8, 1))])
    line = server._spy_shield_digest_line(14)
    assert line.startswith('🛡️ Spy Shield (nog geen live data, alleen tests/preview): would-be blocks 0 records / 0 browser-dagen, ')
    assert '0 buyers in flagged sessions (DK/FR/FI niet gecontroleerd: geen block-tier records)' in line
    assert 'KLAAR VOOR DK: nee (geen live DK-data;' in line


# ── orders checked ───────────────────────────────────────────────────────────

def test_digest_shows_orders_checked_per_store_counting_only_orders_since_go_live(_sandbox, monkeypatch):
    _write(_sandbox, [
        _row('dk', _ts(28, 8, 10)), _row('fr', _ts(28, 9)), _row('fi', _ts(28, 9, 30)),
    ])
    _orders(monkeypatch, {
        # 14 days of orders are fetched; the ones before the store's first record could never match.
        'dk': [_order('#d0', 20), _order('#d1', 27), _order('#d2', 29)],
        'fr': [_order('#f0', 18)] + [_order(f'#f{i}', 29, 8 + i) for i in range(1, 5)],
        'fi': [_order('#i1', 30, 6)],
    })
    b = server._spy_shield_summary(days=14)['buyers_flagged']
    assert b['orders_checked'] == {'dk': 1, 'fr': 4, 'fi': 1}
    assert b['not_checked'] == [] and b['count'] == 0
    line = server._spy_shield_digest_line(14)
    assert '0 buyers in flagged sessions (DK 1, FR 4, FI 1 orders gecontroleerd)' in line


def test_store_without_block_tier_records_reads_not_checked_instead_of_zero(_sandbox, monkeypatch):
    calls = []
    monkeypatch.setattr(server, '_spy_shield_orders',
                        lambda store, days: calls.append(store) or [_order('#x', 29)])
    _write(_sandbox, [
        _row('dk', _ts(28, 9)),
        _row('fi', _ts(28, 9), ss_tier='monitor', ss_reason='dom:widget-shadow-host'),
        _row('fi', _ts(28, 9), ss_tier='', ss_action='allow', ss_reason='url:macro-literal'),
    ])
    b = server._spy_shield_summary(days=14)['buyers_flagged']
    assert calls == ['dk']                                # nothing to match on FR/FI → no fetch
    assert b['not_checked'] == ['fr', 'fi'] and 'Not checked' in b['note']
    line = server._spy_shield_digest_line(14)
    assert '(DK 1 orders gecontroleerd; FR/FI niet gecontroleerd: geen block-tier records)' in line
    assert 'FI 0' not in line


def test_unreadable_orders_show_per_store_in_the_na_text(_sandbox, monkeypatch):
    _write(_sandbox, [_row('dk', _ts(28, 9)), _row('fr', _ts(28, 9))])
    _orders(monkeypatch, {'dk': [_order('#d', 29)], 'fr': None})
    line = server._spy_shield_digest_line(14)
    assert ('buyers in flagged sessions: n/a (DK 1 orders gecontroleerd; FR niet leesbaar; '
            'FI niet gecontroleerd: geen block-tier records)') in line


# ── KLAAR VOOR DK ────────────────────────────────────────────────────────────

def _ready_log(extra=()):
    """DK live since 16-09 (14 calendar days before 30-09), a silent stretch,
    tool-signal block-tier records in the window, one DK order that did not match."""
    return [
        _row('dk', _ts(16, 8)),                           # go-live: outside the 14-day window
        _row('dk', _ts(24, 10), ss_reason='ref:app.ppspy.com', ss_signals='ref:app.ppspy.com'),
        _row('dk', _ts(29, 10), ss_reason='dom:winninghunter', ss_signals='dom:winninghunter'),
        _row('dk', _ts(29, 11), ss_reason='cookie:persist', ss_signals='cookie:persist', ss_repeat=1),
        *extra,
    ]


def test_ready_verdict_is_no_with_less_than_14_days_of_data(_sandbox, monkeypatch):
    _write(_sandbox, [_row('dk', _ts(28, 8, 10)), _row('dk', _ts(29, 10))])
    _orders(monkeypatch, {'dk': [_order('#d1', 29)]})       # 1 checked order, 0 matches, tool reasons
    s = server._spy_shield_summary(days=14)
    assert s['ready']['dk'] == {'ready': False, 'days_live': 2, 'why_not': ['dag 2 van 14']}
    assert server._spy_shield_digest_line(14).endswith('· KLAAR VOOR DK: nee (dag 2 van 14)')


def test_ready_verdict_is_yes_after_14_calendar_days_with_a_clean_checked_order(_sandbox, monkeypatch):
    _write(_sandbox, _ready_log())
    _orders(monkeypatch, {'dk': [_order('#d1', 29)]})
    s = server._spy_shield_summary(days=14)
    assert s['ready']['dk'] == {'ready': True, 'days_live': 14, 'why_not': []}
    line = server._spy_shield_digest_line(14)
    assert '· KLAAR VOOR DK: ja (check nog in het tabblad: would-be blocks < 0,5% van de DK-sessies)' in line


def test_operator_sim_tests_cannot_flip_a_ready_verdict(_sandbox, monkeypatch):
    # sim:* is not a tool reason and sits on the page where the order landed:
    # counted, it would add a non-tool block reason AND a buyer match.
    _write(_sandbox, _ready_log(extra=[_sim('dk', _ts(29, 12), ss_path='/products/elsewhere')]))
    _orders(monkeypatch, {'dk': [_order('#d1', 29, 12)]})
    assert server._spy_shield_summary(days=14)['ready']['dk']['ready'] is True


@pytest.mark.parametrize('extra, orders, why', [
    ([_row('dk', _ts(29, 13), ss_reason='none', ss_signals='')], [_order('#d1', 29)],
     '1 block-tier records zonder tool-signaal'),
    ([], [_order('#d1', 29, 10, path='/products/a')], '1 DK-koper in flagged sessions'),
    ([], [_order('#d0', 10)], '0 DK-orders gecontroleerd'),           # only an order from before go-live
    ([], None, 'DK-orders niet gecontroleerd (niet leesbaar)'),
])
def test_ready_verdict_names_each_failed_criterion(_sandbox, monkeypatch, extra, orders, why):
    _write(_sandbox, _ready_log(extra=extra))
    _orders(monkeypatch, {'dk': orders})
    v = server._spy_shield_summary(days=14)['ready']['dk']
    assert v['ready'] is False and v['why_not'] == [why]
    assert f'KLAAR VOOR DK: nee ({why})' in server._spy_shield_digest_line(14)


def test_ready_verdict_is_no_when_dk_had_no_block_tier_records_to_check(_sandbox, monkeypatch):
    _write(_sandbox, [_row('dk', _ts(16, 8), ss_tier='', ss_action='allow', ss_reason='url:macro-literal'),
                      _row('fr', _ts(29, 8))])
    _orders(monkeypatch, {'fr': [_order('#f', 29)]})
    v = server._spy_shield_summary(days=14)['ready']['dk']
    assert v == {'ready': False, 'days_live': 14,
                 'why_not': ['DK-orders niet gecontroleerd (geen block-tier records)']}
