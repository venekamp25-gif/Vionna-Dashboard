# -*- coding: utf-8 -*-
"""Plan #11 / bug #62: the dropship queue has to drain by itself.

_wtl_classify_store returns 'Onbekend' when the shipping policy is unreadable,
and such a store deliberately still enters the pool with a "not checked" chip
(bug #22: the strict bar filtered out exactly the small dropshippers). So the
gate must NOT get stricter — the 296-store backlog just needs working off. The
'🛡 Verify dropshippers' button already does that work; nobody pressed it often
enough. _wtl_classify_pass is that button, on a daily timer.
"""
import server


def _capture(monkeypatch, results):
    """Replace the (slow, network-bound) classifier with a scripted queue."""
    calls = []

    def fake_missing(domains, jid=None, cap=10, force=False):
        calls.append(cap)
        return results[len(calls) - 1] if len(calls) <= len(results) else results[-1]

    monkeypatch.setattr(server, '_wtl_all_domains', lambda: {'a.dk', 'b.dk'})
    monkeypatch.setattr(server, '_wtl_classify_missing', fake_missing)
    return calls


def test_a_full_pass_works_off_a_daily_block(monkeypatch):
    calls = _capture(monkeypatch, [{'classified': 10, 'resolved': 4}])
    done = server._wtl_classify_pass(rounds=12, block=10, pause=0)
    assert done == 120 and calls == [10] * 12      # 296 in backlog → ~3 days


def test_the_pass_stops_when_the_queue_runs_dry(monkeypatch):
    """A block that does not fill up means nothing is due — don't keep hammering."""
    calls = _capture(monkeypatch, [{'classified': 10}, {'classified': 3}, {'classified': 0}])
    done = server._wtl_classify_pass(rounds=12, block=10, pause=0)
    assert done == 13 and len(calls) == 2


def test_the_pass_yields_to_the_button(monkeypatch):
    """The employee pressing 'Verify dropshippers' holds the lock; that job
    reports an error instead of running. Back off rather than spin."""
    calls = _capture(monkeypatch, [{'error': 'classification already running'}])
    assert server._wtl_classify_pass(rounds=12, block=10, pause=0) == 0
    assert len(calls) == 1


def test_a_crash_in_one_block_does_not_take_the_loop_down(monkeypatch):
    monkeypatch.setattr(server, '_wtl_all_domains', lambda: {'a.dk'})

    def boom(*a, **k):
        raise RuntimeError('network gone')
    monkeypatch.setattr(server, '_wtl_classify_missing', boom)
    assert server._wtl_classify_pass(rounds=3, block=10, pause=0) == 0


def test_the_loop_has_a_kill_switch(monkeypatch):
    """WTL_CLASSIFY_LOOP=0 must return immediately — without it the test would
    sit in the 15-minute start-up sleep."""
    monkeypatch.setenv('WTL_CLASSIFY_LOOP', '0')
    monkeypatch.setattr(server.time, 'sleep',
                        lambda *a: (_ for _ in ()).throw(AssertionError('loop ran')))
    server._wtl_classify_loop()
