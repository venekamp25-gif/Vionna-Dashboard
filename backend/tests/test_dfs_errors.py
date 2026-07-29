"""Regression tests for bug #31: keyword research silently returned 0 keywords
in every market instead of reporting that DataForSEO had failed.

DataForSEO reports ACCOUNT-level failures — invalid/rotated credentials (40100),
exhausted balance (40200), account rate limiting — at the TOP level of the
response envelope, with `tasks` empty or absent. The parsers here used to read
only the PER-TASK status and defaulted a missing task to `{}`:

    t = (d.get('tasks') or [{}])[0]
    if t.get('status_code') not in (20000, None) and not t.get('result'):

`{}`.get('status_code') is None, which that tuple explicitly whitelists, so the
error branch was skipped and an empty item list was returned as if the search
had simply found nothing. The dashboard then showed "No keywords above the
threshold for this type in this market. Try a broader type." — for a dead API
key, in all three markets at once.
"""
import server


class FakeResp:
    def __init__(self, status_code=200):
        self.status_code = status_code


# ── envelope-level failures must surface as errors, never as "no results" ──

def test_account_auth_error_is_reported():
    """40100 (bad credentials) arrives top-level with tasks: []."""
    body = {'status_code': 40100,
            'status_message': 'You are not Authorized to Access this Resource.',
            'cost': 0, 'tasks': []}
    task, err = server._dfs_task_or_error(FakeResp(401), body)
    assert task is None
    assert err['code'] == 40100
    assert 'Authorized' in err['error']


def test_payment_required_is_reported():
    """40200 (exhausted balance) can arrive with tasks: null."""
    body = {'status_code': 40200, 'status_message': 'Payment Required.', 'tasks': None}
    task, err = server._dfs_task_or_error(FakeResp(402), body)
    assert task is None
    assert err['code'] == 40200


def test_empty_tasks_with_ok_envelope_is_reported():
    """An empty tasks array is never a legitimate success — one task in, one out."""
    task, err = server._dfs_task_or_error(FakeResp(200), {'status_code': 20000, 'tasks': []})
    assert task is None
    assert err['code'] is not None


def test_non_dict_body_is_reported():
    """A proxy/HTML error page must not crash or look like an empty result."""
    task, err = server._dfs_task_or_error(FakeResp(502), 'Bad Gateway')
    assert task is None
    assert err is not None


# ── per-task failures keep working ──

def test_task_level_error_is_reported():
    body = {'status_code': 20000, 'tasks': [
        {'status_code': 40501, 'status_message': 'Invalid Field: filters'}]}
    task, err = server._dfs_task_or_error(FakeResp(200), body)
    assert task is None
    assert err['code'] == 40501


# ── genuine successes still pass through untouched ──

def test_successful_task_passes_through():
    body = {'status_code': 20000, 'tasks': [
        {'status_code': 20000, 'result': [{'items': [{'keyword': 'kjole'}]}]}]}
    task, err = server._dfs_task_or_error(FakeResp(200), body)
    assert err is None
    assert task['result'][0]['items'][0]['keyword'] == 'kjole'


def test_genuinely_empty_result_is_not_an_error():
    """Zero matches is a real answer, not a failure — it must stay silent."""
    body = {'status_code': 20000, 'tasks': [
        {'status_code': 20000, 'result': [{'items': []}]}]}
    task, err = server._dfs_task_or_error(FakeResp(200), body)
    assert err is None
    assert (task.get('result') or [{}])[0].get('items') == []


# ── end-to-end through the real caller ──

def test_keyword_suggestions_surfaces_account_error(monkeypatch):
    """The whole point: a dead account must reach the caller as an error entry,
    because that is what /api/keyword_research_niche collects into `errors[]`
    and shows the user."""
    def fake_post(url, **kwargs):
        resp = FakeResp(401)
        resp.json = lambda: {'status_code': 40100, 'status_message': 'Not Authorized', 'tasks': []}
        return resp

    monkeypatch.setattr(server.req, 'post', fake_post)
    monkeypatch.setattr(server, '_dfs_headers', lambda: {})
    out = server._dfs_keyword_suggestions('kjole', 'dk', min_volume=1800, limit=25)
    assert len(out) == 1 and 'error' in out[0], f'expected an error entry, got {out!r}'
    assert out[0]['code'] == 40100


def test_keyword_suggestions_sends_no_volume_filter(monkeypatch):
    """The threshold is applied by the caller. Sending it as a server-side filter
    was the one thing that could empty this call site and nothing else."""
    sent = {}

    def fake_post(url, **kwargs):
        sent['task'] = (kwargs.get('json') or [{}])[0]
        resp = FakeResp(200)
        resp.json = lambda: {'status_code': 20000,
                             'tasks': [{'status_code': 20000, 'result': [{'items': []}]}]}
        return resp

    monkeypatch.setattr(server.req, 'post', fake_post)
    monkeypatch.setattr(server, '_dfs_headers', lambda: {})
    server._dfs_keyword_suggestions('kjole', 'dk', min_volume=1800, limit=25)
    assert 'filters' not in sent['task'], f"unexpected filters: {sent['task'].get('filters')!r}"
    assert sent['task']['order_by'] == ['keyword_info.search_volume,desc']
