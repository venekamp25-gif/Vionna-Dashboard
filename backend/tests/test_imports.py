"""Import smoke test — the gate that makes auto-merge safe.

The droplet self-updates by pulling `server.py` and running it verbatim, so a
syntax error or undefined name in that file means a dead backend in production.
The rest of the suite only exercises `shipping_check`, so without this test a
broken `server.py` would sail through CI green. Importing the module here forces
the whole file to parse and its top-level code (route definitions, decorators,
helper defs) to execute — catching the breakage before it can be auto-merged.

Kept dependency-free: `server.py` imports cleanly with no tokens.json / .env
(tokens load lazily; the app only binds under `__main__`).
"""


def test_server_module_imports():
    import server  # noqa: F401  — import side-effects (route registration) must not raise
    assert server.app is not None
    # A sane number of routes registered = the module finished loading intact.
    assert len(list(server.app.url_map.iter_rules())) > 10


def test_shipping_module_imports():
    import shipping_check  # noqa: F401
