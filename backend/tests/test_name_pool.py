# -*- coding: utf-8 -*-
"""The product-name pool must be watched, not discovered empty.

2026-08-31: pool empty -> 38 garments shared a name. 2026-09-15: empty again ->
9 garments were named 'Berit 2', 'Ylva 2'… (135 products). Nothing warned either
time. The droplet now reads the pool itself and pings Slack while there are
still weeks of names left.
"""
import inspect

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
