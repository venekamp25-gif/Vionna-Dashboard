# -*- coding: utf-8 -*-
"""The product-name pool must be watched, not discovered empty.

2026-08-31: pool empty -> 38 garments shared a name. 2026-09-15: empty again ->
9 garments were named 'Berit 2', 'Ylva 2'… (135 products). Nothing warned either
time. The droplet now reads the pool itself and pings Slack while there are
still weeks of names left.

2026-09-30: that watch pinged 'pool almost empty' ~15 min after every deploy
while 1.003 of 1.425 names were free. The self-updater never shipped names.ts
(the droplet counted on the 10 June list, 279 names) and 'already warned' lived
in memory, which every deploy restart wiped.
"""
import ast
import inspect
import os
import re

import server


def test_slug_matches_shopify_rules():
    assert server._name_slug('Adèle') == server._name_slug('Adele') == 'adele'
    assert server._name_slug('Lærke') == 'laerke'
    assert server._name_slug('Synnøve') == 'synnove'
    assert server._name_slug('Berit 2') == 'berit-2'


def test_pool_is_parsed_from_names_ts(tmp_path):
    p = tmp_path / 'names.ts'
    # a quoted word inside a COMMENT is not a pool name
    p.write_text('export const WOMEN_NAMES = [\n  // Nordic — the fallback handed out "Berit 2"\n'
                 '  "Aase", "Berit",\n  "Adèle",\n];\n'
                 'export function randomName() { return "x"; }\n', encoding='utf-8')
    assert server._name_pool_names(str(p)) == ['Aase', 'Berit', 'Adèle']
    assert server._name_pool_names(str(tmp_path / 'missing.ts')) == []


def test_status_counts_free_names_by_slug_and_finds_numbered_ones():
    st = server._name_pool_status(
        titles_by_store={'dk': ['Adele', 'Berit', 'Berit 2'], 'fr': ['BERIT', 'Ylva 2']},
        pool=['Adèle', 'Berit', 'Clara', 'Dagny'])
    assert st['pool'] == 4 and st['free'] == 2            # Adèle is taken by 'Adele'
    assert st['numbered_names'] == ['Berit 2', 'Ylva 2']
    assert st['low'] is True                               # 2 < 150
    assert st['stores_failed'] == []


def test_an_unread_store_is_not_read_as_plenty_left(monkeypatch):
    monkeypatch.setattr(server, 'tokens', {'dk': {}, 'fr': {}, 'fi': {}})

    def titles(store):
        if store == 'fr':
            raise RuntimeError('fr: HTTP 503')
        return ['Berit']
    monkeypatch.setattr(server, '_store_titles', titles)
    st = server._name_pool_status(pool=['Berit', 'Clara'])
    assert st['stores_failed'] == ['fr']
    assert st['low'] is False                              # unknown: no verdict either way


def test_watch_pings_once_and_again_only_when_it_got_worse(monkeypatch):
    sent = []
    monkeypatch.setattr(server, '_blog_slack', lambda text, blocks=None: sent.append(text))
    monkeypatch.setitem(server._NAME_POOL_LAST, 'warned_free', None)
    state = {'free': 120}
    monkeypatch.setattr(server, '_name_pool_status', lambda: {
        'pool': 1800, 'free': state['free'], 'in_use': 900, 'numbered_names': [], 'stores_failed': [],
        'warn_below': 150, 'low': state['free'] < 150, 'checked_at': 'x'})
    server._name_pool_watch_once()
    server._name_pool_watch_once()                         # same number next day: silent
    assert len(sent) == 1 and '120 of 1800' in sent[0]
    state['free'] = 90                                     # 30 fewer: ping again
    server._name_pool_watch_once()
    assert len(sent) == 2
    state['free'] = 0
    server._name_pool_watch_once()
    assert 'EMPTY' in sent[-1]


def test_watch_stays_silent_when_healthy_or_unreadable(monkeypatch):
    sent = []
    monkeypatch.setattr(server, '_blog_slack', lambda text, blocks=None: sent.append(text))
    monkeypatch.setitem(server._NAME_POOL_LAST, 'warned_free', None)
    monkeypatch.setattr(server, '_name_pool_status', lambda: {
        'pool': 1800, 'free': 900, 'in_use': 900, 'numbered_names': [], 'stores_failed': [],
        'warn_below': 150, 'low': False, 'checked_at': 'x'})
    server._name_pool_watch_once()
    monkeypatch.setattr(server, '_name_pool_status', lambda: {
        'pool': 1800, 'free': 3, 'in_use': 900, 'numbered_names': [], 'stores_failed': ['dk'],
        'warn_below': 150, 'low': False, 'checked_at': 'x'})
    server._name_pool_watch_once()
    assert sent == []


def test_names_endpoint_reads_past_2500_titles():
    src = inspect.getsource(server.get_names)
    assert 'pages < 60' in src and 'pages < 10' not in src


def test_the_real_pool_is_large_and_clean():
    pool = server._name_pool_names()
    slugs = [server._name_slug(n) for n in pool]
    assert len(pool) >= 1400          # 1.428 on 2026-09-17; shrinking it is what caused 'Berit 2'
    assert len(slugs) == len(set(slugs)), 'two pool names share a Shopify slug'
    assert not [n for n in pool if any(ch.isdigit() for ch in n) or ' ' in n or '-' in n]


# ── 2026-09-30: stale list on the droplet + alert state lost on restart ─────

class _R:
    def __init__(self, content=b'', status=200):
        self.content, self.status_code = content, status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f'HTTP {self.status_code}')


def _names_ts(names):
    return ('export const WOMEN_NAMES = [\n  // a "Quoted" word in a comment\n  '
            + ', '.join(f'"{n}"' for n in names) + ',\n];\n').encode('utf-8')


def _slack(monkeypatch):
    sent = []
    monkeypatch.setattr(server, '_blog_slack', lambda text, blocks=None: sent.append(text))
    return sent


def _restart(monkeypatch):
    """What a deploy does to the process: every in-memory dict starts over."""
    monkeypatch.setattr(server, '_NAME_POOL_LAST', {'at': 0.0, 'status': None, 'warned_free': None})


def _droplet(monkeypatch, tmp_path, local, stores=None):
    """A droplet whose names.ts holds `local` and whose stores use `stores`."""
    p = tmp_path / 'names.ts'
    p.write_bytes(_names_ts(local))
    monkeypatch.setattr(server, 'NAMES_TS_PATH', str(p))
    monkeypatch.setattr(server, 'tokens', {'dk': {}})
    monkeypatch.setattr(server, '_store_titles', lambda store: list(stores or []))
    return p


def _github(monkeypatch, remote, allow=True):
    """GitHub main serves `remote` as names.ts. `allow` = running on the droplet."""
    if allow:
        monkeypatch.setattr(server, '_background_loops_allowed', lambda: True)
    monkeypatch.setattr(server, 'GITHUB_RAW', 'https://raw.githubusercontent.com/o/r/main')
    monkeypatch.setattr(server, '_resolve_commit_sha', lambda: 'abc123')
    urls = []

    def get(url, **k):
        urls.append(url)
        return _R(_names_ts(remote))
    monkeypatch.setattr(server.req, 'get', get)
    return urls


def test_watch_state_survives_a_restart(monkeypatch):
    sent = _slack(monkeypatch)
    monkeypatch.setattr(server, '_name_pool_status', lambda: {
        'pool': 1800, 'free': 120, 'in_use': 900, 'numbered_names': ['Berit 2'], 'stores_failed': [],
        'warn_below': 150, 'low': True, 'pool_stale': False, 'remote_pool': 1800, 'checked_at': 'x'})
    server._name_pool_watch_once()
    assert len(sent) == 1
    _restart(monkeypatch)                                  # deploy -> os._exit -> fresh process
    server._name_pool_watch_once()
    assert len(sent) == 1                                  # the file remembers: no second ping
    assert os.path.exists(server.NAME_POOL_STATE_PATH)


def test_recovery_rearms_the_low_warning_but_not_the_stale_one(monkeypatch):
    sent = _slack(monkeypatch)
    cur = {'pool': 1800, 'in_use': 900, 'numbered_names': [], 'stores_failed': [], 'warn_below': 150,
           'remote_pool': 1800, 'pool_source': 'github', 'checked_at': 'x'}
    monkeypatch.setattr(server, '_name_pool_status', lambda: dict(cur))
    cur.update(free=120, low=True, pool_stale=False)
    server._name_pool_watch_once()
    cur.update(free=900, low=False)                        # names added: healthy again
    server._name_pool_watch_once()
    cur.update(free=120, low=True)                         # low again later: warn again
    server._name_pool_watch_once()
    assert len(sent) == 2
    stale = dict(pool=279, free=1, low=False, pool_stale=True, remote_pool=1425)
    cur.update(stale)
    server._name_pool_watch_once()
    assert len(sent) == 3 and 'outdated' in sent[-1]
    cur.update(pool=1800, free=900, low=False, pool_stale=False, remote_pool=1800)
    server._name_pool_watch_once()
    cur.update(stale)                                      # same 279-vs-1425 pair: already said
    _restart(monkeypatch)
    server._name_pool_watch_once()
    assert len(sent) == 3


def test_an_outdated_list_on_the_droplet_is_not_low_and_never_says_extend_names_ts(monkeypatch, tmp_path):
    sent = _slack(monkeypatch)
    # 30 Sep: the droplet had 279 names, GitHub main 1.425 — 2 'free' here is not a verdict
    _droplet(monkeypatch, tmp_path, ['Aase', 'Berit', 'Clara'], stores=['Aase', 'Dagny 2'])
    monkeypatch.setattr(server, '_name_pool_sync', lambda: {'source': 'local', 'remote_pool': 1425})
    st = server._name_pool_watch_once()
    assert st['pool'] == 3 and st['free'] == 2
    assert st['pool_stale'] is True and st['low'] is False and st['remote_pool'] == 1425
    assert len(sent) == 2                                  # the stale note + the numbered name
    assert any('1425' in m and 'outdated' in m for m in sent)
    assert not [m for m in sent if 'extend' in m.lower()]
    _restart(monkeypatch)
    server._name_pool_watch_once()
    assert len(sent) == 2                                  # once per (local, GitHub) pair


def test_github_unreachable_with_an_old_list_says_so_instead_of_extend(monkeypatch, tmp_path):
    sent = _slack(monkeypatch)
    _droplet(monkeypatch, tmp_path, ['Aase', 'Berit', 'Clara'], stores=['Aase'])
    monkeypatch.setattr(server, '_name_pool_sync', lambda: {'source': 'local', 'remote_pool': None})
    st = server._name_pool_watch_once()
    assert st['pool_stale'] is True and st['low'] is False  # 3 < NAME_POOL_MIN_EXPECTED
    assert len(sent) == 1 and 'could not be reached' in sent[0]
    assert 'extend' not in sent[0].lower()


def test_the_list_the_sync_just_repaired_is_not_stale(monkeypatch, tmp_path):
    # The investigator's first formula compared GitHub to the size BEFORE the
    # sync and would have called the freshly repaired list 'outdated'.
    p = _droplet(monkeypatch, tmp_path, ['Aase', 'Berit', 'Clara'])
    urls = _github(monkeypatch, ['Aase', 'Berit', 'Clara', 'Dagny', 'Edda'])
    st = server._name_pool_status(titles_by_store={'dk': ['Aase']})
    assert p.read_bytes() == _names_ts(['Aase', 'Berit', 'Clara', 'Dagny', 'Edda'])
    assert st['pool'] == 5 and st['remote_pool'] == 5 and st['pool_source'] == 'github'
    assert st['pool_stale'] is False and st['low'] is True  # a real, current, small pool IS low
    assert urls == ['https://raw.githubusercontent.com/o/r/abc123/frontend/lib/names.ts']  # SHA-pinned
    server._name_pool_status(titles_by_store={'dk': ['Aase']})
    assert len(urls) == 1                                  # cached, not refetched per status call


def test_sync_never_writes_under_dev_local_or_pytest(monkeypatch, tmp_path):
    monkeypatch.setenv('DEV_LOCAL', '1')
    p = _droplet(monkeypatch, tmp_path, ['Aase', 'Berit'])
    urls = _github(monkeypatch, ['Aase', 'Berit', 'Clara', 'Dagny'], allow=False)
    assert server._name_pool_sync() == {'source': 'local', 'remote_pool': None}
    assert urls == [] and p.read_bytes() == _names_ts(['Aase', 'Berit'])


def test_sync_refuses_a_smaller_remote_list(monkeypatch, tmp_path):
    # A stale CDN answer or a broken main must never shrink the pool on the box.
    p = _droplet(monkeypatch, tmp_path, ['Aase', 'Berit', 'Clara', 'Dagny'])
    _github(monkeypatch, ['Aase', 'Berit'])
    assert server._name_pool_sync() == {'source': 'local', 'remote_pool': 2}
    assert p.read_bytes() == _names_ts(['Aase', 'Berit', 'Clara', 'Dagny'])
    st = server._name_pool_status(titles_by_store={'dk': []})
    assert st['pool'] == 4 and st['pool_stale'] is False


def test_sync_never_raises_and_leaves_the_list_alone_when_github_is_down(monkeypatch, tmp_path):
    p = _droplet(monkeypatch, tmp_path, ['Aase', 'Berit'])
    _github(monkeypatch, ['x'])

    def down(url, **k):
        raise ConnectionError('github down')
    monkeypatch.setattr(server.req, 'get', down)
    assert server._name_pool_sync() == {'source': 'local', 'remote_pool': None}
    assert p.read_bytes() == _names_ts(['Aase', 'Berit'])


# ── the self-updater ships every repo file the server reads ─────────────────

def _updater(monkeypatch, tmp_path, fail=None):
    backend = tmp_path / 'backend'
    backend.mkdir()
    monkeypatch.setattr(server, '_BASE_DIR', str(backend))
    monkeypatch.setattr(server, 'NAMES_TS_PATH', str(tmp_path / 'frontend' / 'lib' / 'names.ts'))
    monkeypatch.setattr(server, 'VERSION_FILE', str(backend / 'version.txt'))
    monkeypatch.setattr(server, 'GITHUB_RAW', 'https://raw.githubusercontent.com/o/r/main')
    monkeypatch.setattr(server, '_resolve_commit_sha', lambda: 'abc123')
    restarts, writes = [], []
    monkeypatch.setattr(server, '_schedule_restart', lambda: restarts.append(1))
    real_write = server._write_file_atomic
    monkeypatch.setattr(server, '_write_file_atomic', lambda p, c: (writes.append(p), real_write(p, c)))

    def get(url, **k):
        path = url.split('/abc123/', 1)[1]
        return _R(b'', 404) if path == fail else _R(f'content of {path}'.encode())
    monkeypatch.setattr(server.req, 'get', get)
    return restarts, writes


def test_updater_ships_names_ts_and_writes_version_txt_last(monkeypatch, tmp_path):
    restarts, writes = _updater(monkeypatch, tmp_path)
    r = server.app.test_client().post('/api/update')
    body = r.get_json()
    assert r.status_code == 200 and body['success'] and body['pinned'] is True
    assert 'frontend/lib/names.ts' in body['updated'] and body['updated'][-1] == 'backend/version.txt'
    assert writes[-1] == server.VERSION_FILE
    assert (tmp_path / 'frontend' / 'lib' / 'names.ts').read_bytes() == b'content of frontend/lib/names.ts'
    assert restarts == [1]


def test_updater_writes_nothing_when_one_code_fetch_fails(monkeypatch, tmp_path):
    restarts, writes = _updater(monkeypatch, tmp_path, fail='backend/shipping_check.py')
    r = server.app.test_client().post('/api/update')
    assert r.status_code == 500 and r.get_json()['success'] is False
    assert writes == [] and restarts == []
    assert os.listdir(tmp_path / 'backend') == []          # not even version.txt moved on
    assert not (tmp_path / 'frontend').exists()


def test_a_missing_names_ts_on_main_never_stops_code_deploys(monkeypatch, tmp_path):
    # names.ts renamed/moved/deleted on main (404): the code still ships —
    # otherwise even the commit that fixes the list could never reach the droplet
    restarts, writes = _updater(monkeypatch, tmp_path, fail='frontend/lib/names.ts')
    r = server.app.test_client().post('/api/update')
    body = r.get_json()
    assert r.status_code == 200 and body['success'] and restarts == [1]
    assert body['updated'][-1] == 'backend/version.txt' and 'frontend/lib/names.ts' not in body['updated']
    assert any('names.ts' in w for w in body['warnings'])
    assert not (tmp_path / 'frontend').exists()


def test_a_names_ts_write_failure_never_holds_the_code_deploy(monkeypatch, tmp_path):
    # frontend/lib not writable on the droplet: the code still ships (the boot
    # sync retries the list); a failing CODE file still stops before version.txt
    restarts, writes = _updater(monkeypatch, tmp_path)
    real_write = server._write_file_atomic

    def picky(p, c):
        if p.endswith('names.ts'):
            raise PermissionError('read-only')
        return real_write(p, c)
    monkeypatch.setattr(server, '_write_file_atomic', picky)
    r = server.app.test_client().post('/api/update')
    body = r.get_json()
    assert r.status_code == 200 and body['success'] and restarts == [1]
    assert body['updated'][-1] == 'backend/version.txt' and 'frontend/lib/names.ts' not in body['updated']
    assert any('names.ts' in w for w in body['warnings'])

    (tmp_path / 'b').mkdir()
    restarts2, _ = _updater(monkeypatch, tmp_path / 'b')

    def broken_code(p, c):
        if p.endswith('server.py'):
            raise PermissionError('read-only')
        return real_write(p, c)
    monkeypatch.setattr(server, '_write_file_atomic', broken_code)
    r = server.app.test_client().post('/api/update')
    assert r.status_code == 500 and restarts2 == []
    assert not (tmp_path / 'b' / 'backend' / 'version.txt').exists()


def test_every_repo_file_server_reads_outside_backend_is_shipped_by_the_updater():
    shipped = {repo for repo, _ in server._updater_files()}
    backend = os.path.dirname(os.path.abspath(server.__file__))
    root = os.path.dirname(backend)
    norm = lambda p: os.path.normcase(os.path.abspath(p))  # noqa: E731
    within = lambda p, d: p == norm(d) or p.startswith(norm(d) + os.sep)  # noqa: E731
    outside = {}
    for name, val in vars(server).items():
        if isinstance(val, str) and os.path.isabs(val):
            v = norm(val)
            if within(v, root) and not within(v, backend):
                outside[name] = os.path.relpath(val, root).replace(os.sep, '/')
    assert outside.get('NAMES_TS_PATH') == 'frontend/lib/names.ts'   # the scan itself works
    assert {n: p for n, p in outside.items() if p not in shipped} == {}
    # A path that climbs out of backend/ inline is invisible to the scan above:
    # make it a module constant (and ship it) instead.
    with open(server.__file__, encoding='utf-8') as f:
        src = f.read()
    climbs = [ln.strip() for ln in src.splitlines()
              if re.search(r"os\.path\.dirname\(os\.path\.dirname\(|os\.pardir|['\"]\.\.['\"]", ln)]
    assert [ln for ln in climbs if ln.split('=')[0].strip() not in outside] == []


def test_updater_ships_every_local_module_server_imports():
    backend = os.path.dirname(os.path.abspath(server.__file__))
    with open(server.__file__, encoding='utf-8') as f:
        tree = ast.parse(f.read())
    mods = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            mods |= {a.name.split('.')[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            mods.add(node.module.split('.')[0])
    local = {f'backend/{m}.py' for m in mods if os.path.exists(os.path.join(backend, f'{m}.py'))}
    assert 'backend/shipping_check.py' in local
    assert local - {repo for repo, _ in server._updater_files()} == set()
