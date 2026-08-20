"""Tests for the Higgsfield self-test, health surface and error mapping (bug #42,
approved plan #5 step 3).

Bug #42 was a total image-generation outage. The CLI answered `--version` fine,
our code had not changed, and every generate failed — but the reason only ever
existed in a stderr line on the droplet. From a cloud session nothing could tell
"session expired" from "out of credits" from "the service dropped our
three-month-old client", so the routine could not diagnose it and had to file a
plan asking a human to read that line.

These tests pin the three things that were missing:
  1. an UNGATED outcome-only check that actually runs a generate,
  2. /api/health saying whether generation works (and on which CLI version)
     instead of only whether the binary is on disk,
  3. "Not authenticated" being recognised, so the employee reads a sentence
     instead of raw CLI output.

Because the check spends real money, the cache and the lock around it are part
of the contract and are tested here too.
"""
import subprocess

import pytest

import server


OUT_URL = f'https://{server.HIGGSFIELD_OUTPUT_CDN}/hf_abc123.jpg'
INPUT_URL = 'https://d2ol7oe51mr4n9.cloudfront.net/ref_0.jpg'


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    monkeypatch.setattr(server, '_SELFTEST_CACHE', {})
    monkeypatch.setattr(server, '_HF_VERSION_CACHE', {'ts': 0.0, 'value': ''})
    # A real path so the "is the CLI installed" guard passes; nothing is executed
    # — subprocess.run is stubbed in every test that gets that far.
    exe = tmp_path / 'hf'
    exe.write_text('#!/bin/sh\n')
    monkeypatch.setattr(server, 'HIGGSFIELD_EXE', str(exe))


@pytest.fixture()
def client():
    server.app.config['TESTING'] = True
    with server.app.test_client() as c:
        yield c


class _Run:
    """Stub for subprocess.run that answers --version and generate differently."""

    def __init__(self, stdout='', stderr='', rc=0, version='higgsfield 0.1.40'):
        self.stdout, self.stderr, self.rc, self.version = stdout, stderr, rc, version
        self.generate_calls = 0

    def __call__(self, cmd, **kw):
        if '--version' in cmd:
            return subprocess.CompletedProcess(cmd, 0, self.version, '')
        self.generate_calls += 1
        return subprocess.CompletedProcess(cmd, self.rc, self.stdout, self.stderr)


def _stub(monkeypatch, **kw):
    run = _Run(**kw)
    monkeypatch.setattr(server.subprocess, 'run', run)
    return run


# ── The check itself ───────────────────────────────────────────────────────

def test_a_working_generate_reports_ok(client, monkeypatch):
    run = _stub(monkeypatch, stdout='{"jobs":[{"output_url":"%s"}]}' % OUT_URL)

    body = client.get('/api/selftest?what=higgsfield').get_json()

    assert body['ok'] is True
    assert body['reason'] == 'generated'
    assert run.generate_calls == 1


def test_a_lost_session_is_named_as_such(client, monkeypatch):
    """The exact failure behind bug #42's most likely cause (A). Before the fix
    'Not authenticated' matched no rule at all."""
    _stub(monkeypatch, stdout='', stderr='Error: Not authenticated. Run `hf auth login`.', rc=2)

    body = client.get('/api/selftest?what=higgsfield').get_json()

    assert body['ok'] is False
    assert body['reason'] == 'auth'
    assert 'hf auth login' in body['message']


def test_an_empty_account_is_not_reported_as_a_lost_session(client, monkeypatch):
    _stub(monkeypatch, stdout='', stderr='insufficient credits for this generation', rc=2)

    body = client.get('/api/selftest?what=higgsfield').get_json()

    assert body['reason'] == 'credits'
    assert 'credits' in body['message']


def test_success_without_an_output_url_points_at_the_model_or_cdn(client, monkeypatch):
    """rc=0, clean run, but nothing on our output CDN — the shape a renamed
    model or a moved output host takes. That one IS a code change on our side,
    so it must not be lumped in with the account failures."""
    _stub(monkeypatch, stdout='{"jobs":[{"status":"completed"}]}', stderr='', rc=0)

    body = client.get('/api/selftest?what=higgsfield').get_json()

    assert body['ok'] is False
    assert body['reason'] == 'no_output_url'


def test_an_input_image_url_is_never_mistaken_for_a_result(client, monkeypatch):
    _stub(monkeypatch, stdout='{"jobs":[{"url":"%s"}]}' % INPUT_URL, rc=0)

    assert client.get('/api/selftest?what=higgsfield').get_json()['ok'] is False


def test_a_missing_cli_says_so_instead_of_shelling_out(client, monkeypatch):
    monkeypatch.setattr(server, 'HIGGSFIELD_EXE', '')
    run = _stub(monkeypatch, stdout='{"output_url":"%s"}' % OUT_URL)

    body = client.get('/api/selftest?what=higgsfield').get_json()

    assert body['reason'] == 'cli_missing'
    assert run.generate_calls == 0


def test_a_timeout_is_an_outcome_not_a_500(client, monkeypatch):
    def _boom(cmd, **kw):
        if '--version' in cmd:
            return subprocess.CompletedProcess(cmd, 0, 'higgsfield 0.1.40', '')
        raise subprocess.TimeoutExpired(cmd, 300)

    monkeypatch.setattr(server.subprocess, 'run', _boom)

    r = client.get('/api/selftest?what=higgsfield')

    assert r.status_code == 200
    assert r.get_json()['reason'] == 'timeout'


# ── Ungated, and therefore: no secrets, no spending ────────────────────────

def test_it_needs_no_session_token(client, monkeypatch):
    """The whole point — the routine runs in a cloud session with no token."""
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', 'a-secret')
    monkeypatch.delenv('DEV_LOCAL', raising=False)
    _stub(monkeypatch, stdout='{"output_url":"%s"}' % OUT_URL)

    assert client.get('/api/selftest?what=higgsfield').status_code == 200


def test_it_never_echoes_the_cli_output_or_the_image_url(client, monkeypatch):
    """Failing CLI output carries account and session detail, and a success
    carries a signed image URL. Neither may leave an ungated endpoint."""
    secret = 'token=SUPERSECRET user=ceo@vionna.dk'
    _stub(monkeypatch, stdout='', stderr=f'401 Unauthorized ({secret})', rc=2)

    text = client.get('/api/selftest?what=higgsfield').get_data(as_text=True)

    assert 'SUPERSECRET' not in text and 'ceo@vionna.dk' not in text

    server._SELFTEST_CACHE.clear()
    _stub(monkeypatch, stdout='{"output_url":"%s"}' % OUT_URL)
    text = client.get('/api/selftest?what=higgsfield').get_data(as_text=True)

    assert OUT_URL not in text and 'cloudfront' not in text


def test_a_second_call_is_served_from_cache_instead_of_burning_a_credit(client, monkeypatch):
    """Ungated + costs money = a retry loop must not be able to spend. The TTL
    is an hour for this check, not the usual two minutes."""
    run = _stub(monkeypatch, stdout='{"output_url":"%s"}' % OUT_URL)

    first = client.get('/api/selftest?what=higgsfield').get_json()
    second = client.get('/api/selftest?what=higgsfield').get_json()

    assert run.generate_calls == 1
    assert first['from_cache'] is False and second['from_cache'] is True
    assert server._selftest_ttl('higgsfield') >= 3600
    assert server._selftest_ttl('keywords') == server._SELFTEST_TTL


def test_a_failure_is_cached_too_so_a_broken_account_cannot_be_hammered(client, monkeypatch):
    run = _stub(monkeypatch, stdout='', stderr='Not authenticated', rc=2)

    client.get('/api/selftest?what=higgsfield')
    client.get('/api/selftest?what=higgsfield')

    assert run.generate_calls == 1


def test_parallel_callers_share_one_generate(client, monkeypatch):
    """Without the lock, N simultaneous requests each start a generate before the
    first writes the cache — N credits for one answer."""
    import threading

    run = _stub(monkeypatch, stdout='{"output_url":"%s"}' % OUT_URL)
    results = []

    def _hit():
        with server.app.test_client() as c:
            results.append(c.get('/api/selftest?what=higgsfield').status_code)

    threads = [threading.Thread(target=_hit) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert results == [200] * 6
    assert run.generate_calls == 1


def test_the_other_checks_still_work(client):
    r = client.get('/api/selftest?what=nonsense')
    assert r.status_code == 400
    assert 'higgsfield' in r.get_json()['error']


# ── /api/health: does generation work, and on which client? ────────────────

def test_health_reports_the_cli_version(client, monkeypatch):
    _stub(monkeypatch, version='higgsfield 0.1.40 (9aa6f1f) built 2026-05-12T11:19:03Z')

    body = client.get('/api/health').get_json()

    assert body['higgsfield_cli'] is True
    assert '0.1.40' in body['higgsfield_cli_version']


def test_health_never_starts_a_generate_itself(client, monkeypatch):
    """It is polled by the admin panel; a generate per poll would bill us."""
    run = _stub(monkeypatch, stdout='{"output_url":"%s"}' % OUT_URL)

    body = client.get('/api/health').get_json()

    assert run.generate_calls == 0
    assert body['higgsfield_generate']['status'] == 'unknown'


def test_health_reports_the_last_measured_generate(client, monkeypatch):
    _stub(monkeypatch, stdout='', stderr='Not authenticated', rc=2)
    client.get('/api/selftest?what=higgsfield')

    gen = client.get('/api/health').get_json()['higgsfield_generate']

    assert gen['status'] == 'failing'
    assert gen['reason'] == 'auth'
    assert gen['checked_seconds_ago'] is not None


def test_health_stays_ungated_and_leaks_nothing(client, monkeypatch):
    monkeypatch.setattr(server, 'DROPLET_TOKEN_SECRET', 'a-secret')
    _stub(monkeypatch, stdout='', stderr='401 for user ceo@vionna.dk', rc=2)
    client.get('/api/selftest?what=higgsfield')

    text = client.get('/api/health').get_data(as_text=True)

    assert 'ceo@vionna.dk' not in text


# ── The message the employee reads on a failed tile ────────────────────────

@pytest.mark.parametrize('raw, needle', [
    ('Error: Not authenticated. Run `hf auth login`.', 'hf auth login'),
    ('not logged in — please authenticate', 'hf auth login'),
    ('Request failed: 401 Unauthorized', 'hf auth login'),
    ('insufficient balance', 'out of credits'),
    ('quota exceeded', 'quota'),
])
def test_known_failures_become_a_sentence_not_cli_output(raw, needle):
    msg = server._map_higgsfield_error(raw)
    assert needle in msg
    # A translated sentence, not the CLI's line handed back verbatim.
    assert msg != raw and msg.endswith('.')


def test_an_unrecognised_failure_still_shows_the_raw_text_on_the_gated_path():
    """The generate endpoint is token-gated, so an unknown error is more useful
    verbatim than swallowed — that fallback must survive the refactor."""
    assert 'unicorn exploded' in server._map_higgsfield_error('unicorn exploded')


def test_the_reference_image_rule_still_beats_the_token_rule():
    """'invalid token' and 'invalid image' both contain 'invalid'; order matters."""
    assert 'reference image' in server._map_higgsfield_error('image rejected: unsupported format')
    assert 'hf auth login' in server._map_higgsfield_error('invalid token')
