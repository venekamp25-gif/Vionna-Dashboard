"""Tests for the stalled-fix backstop.

Bug #31's fix was pushed, reviewed by CI and left green and mergeable — and then
nothing happened, because the routine merges its own PR at the end of its run and
that run had already ended. The bug stayed 'open' in the queue with no signal
anywhere that a finished fix was one click away. These cover the registration
endpoint and the escalation policy that closes that gap.
"""
import datetime
import json

import server


def _fresh_queue(tmp_path, entries):
    path = tmp_path / 'bug_reports.jsonl'
    with open(path, 'w', encoding='utf-8') as f:
        for e in entries:
            f.write(json.dumps(e) + '\n')
    server.BUG_REPORTS_PATH = str(path)
    return path


def test_attach_pr_records_it_on_the_bug(tmp_path):
    _fresh_queue(tmp_path, [{'id': 31, 'title': 'keywords', 'status': 'open', 'resolved_at': None}])
    c = server.app.test_client()
    r = c.post('/api/bug_reports/31/pr', json={'pr_number': 27})
    assert r.status_code == 200 and r.get_json()['pr_number'] == 27

    entry = server._load_bug_reports()[0]
    assert entry['pr_number'] == 27
    assert entry['pr_url'].endswith('/pull/27')
    assert entry['pr_opened_at']


def test_attach_pr_requires_a_number(tmp_path):
    _fresh_queue(tmp_path, [{'id': 31, 'title': 'x', 'status': 'open', 'resolved_at': None}])
    c = server.app.test_client()
    assert c.post('/api/bug_reports/31/pr', json={}).status_code == 400


def test_attach_pr_unknown_bug_is_404(tmp_path):
    _fresh_queue(tmp_path, [])
    c = server.app.test_client()
    assert c.post('/api/bug_reports/999/pr', json={'pr_number': 1}).status_code == 404


# ── escalation policy ──

def _iso(minutes_ago):
    return (datetime.datetime.utcnow()
            - datetime.timedelta(minutes=minutes_ago)).isoformat() + 'Z'


def test_grace_period_then_ping(tmp_path, monkeypatch):
    """A PR that just opened is not nagged about; one past the grace period is."""
    _fresh_queue(tmp_path, [
        {'id': 1, 'title': 'fresh', 'status': 'open', 'resolved_at': None,
         'pr_number': 101, 'pr_opened_at': _iso(2), 'pr_nagged_at': None},
        {'id': 2, 'title': 'stale', 'status': 'open', 'resolved_at': None,
         'pr_number': 102, 'pr_opened_at': _iso(45), 'pr_nagged_at': None},
    ])
    pinged = []
    monkeypatch.setattr(server, '_post_stalled_fix_to_slack',
                        lambda e, pr, mins: pinged.append((e['id'], mins)))

    class R:
        status_code = 200
        @staticmethod
        def json():
            return {'number': 0, 'state': 'open', 'merged': False, 'draft': False}

    monkeypatch.setattr(server.req, 'get', lambda *a, **k: R())
    server._fix_pr_sweep()

    assert [p[0] for p in pinged] == [2], f'expected only the stale one, got {pinged}'
    assert pinged[0][1] >= 45

    after = {e['id']: e for e in server._load_bug_reports()}
    assert after[2]['pr_nagged_at'] is not None
    assert after[1]['pr_nagged_at'] is None


def test_merged_pr_stops_being_chased(tmp_path, monkeypatch):
    _fresh_queue(tmp_path, [
        {'id': 3, 'title': 'landed', 'status': 'open', 'resolved_at': None,
         'pr_number': 103, 'pr_opened_at': _iso(90), 'pr_nagged_at': None},
    ])
    pinged = []
    monkeypatch.setattr(server, '_post_stalled_fix_to_slack',
                        lambda e, pr, mins: pinged.append(e['id']))

    class R:
        status_code = 200
        @staticmethod
        def json():
            return {'number': 103, 'state': 'closed', 'merged': True,
                    'merged_at': '2026-07-29T15:00:00Z'}

    monkeypatch.setattr(server.req, 'get', lambda *a, **k: R())
    server._fix_pr_sweep()

    assert pinged == []
    entry = server._load_bug_reports()[0]
    assert entry['pr_number'] is None
    assert entry['pr_merged_at'] == '2026-07-29T15:00:00Z'


def test_resolved_bugs_are_left_alone(tmp_path, monkeypatch):
    """_load_bug_reports() hides resolved entries by default; make sure a resolved
    bug never produces a ping even if it still carries a PR number."""
    _fresh_queue(tmp_path, [
        {'id': 4, 'title': 'done', 'status': 'resolved', 'resolved_at': _iso(1),
         'pr_number': 104, 'pr_opened_at': _iso(300), 'pr_nagged_at': None},
    ])
    pinged = []
    monkeypatch.setattr(server, '_post_stalled_fix_to_slack',
                        lambda e, pr, mins: pinged.append(e['id']))
    monkeypatch.setattr(server.req, 'get',
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError('should not poll')))
    server._fix_pr_sweep()
    assert pinged == []
