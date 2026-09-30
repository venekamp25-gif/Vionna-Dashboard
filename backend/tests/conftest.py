import os
import sys

import pytest

# Make backend/ importable so tests can `import shipping_check`.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture(autouse=True)
def _isolate_dfs_cache(tmp_path, monkeypatch):
    """Keep the DataForSEO disk cache (v1.254) out of the test run.

    It lives next to server.py, so without this the suite writes
    backend/dfs_cache.json on the first run and the NEXT run serves the keyword
    tests from that file instead of from their mocked API — two green tests turn
    red for reasons that have nothing to do with the code under test.
    """
    import server

    monkeypatch.setattr(server, 'DFS_CACHE_PATH', str(tmp_path / 'dfs_cache.json'))
    monkeypatch.setattr(server, '_DFS_DISK', {})
    monkeypatch.setitem(server._DFS_DISK_STATE, 'loaded', False)


@pytest.fixture(autouse=True)
def _isolate_bs_product_cache(tmp_path, monkeypatch):
    """Same treatment for the per-product bestseller cache (plan #3, bug #35).

    _bs_scan persists it after every scan, so without this a test run would drop
    backend/bs_product_cache.json into the repo and the NEXT run would serve
    products from that file instead of from the mocked fetch.
    """
    import server

    monkeypatch.setattr(server, 'BS_PROD_CACHE_PATH', str(tmp_path / 'bs_product_cache.json'))
    monkeypatch.setattr(server, '_BS_PROD_CACHE', {})


@pytest.fixture(autouse=True)
def _isolate_hf_media(tmp_path, monkeypatch):
    """Keep the captured-image store (plan #9, bug #46) out of the repo.

    /api/higgsfield writes real image bytes next to server.py; without this a
    test run would drop backend/hf_media/ into a PUBLIC repo and leave it there.
    """
    import server

    d = tmp_path / 'hf_media'
    d.mkdir()
    monkeypatch.setattr(server, 'HF_MEDIA_DIR', str(d))


@pytest.fixture(autouse=True)
def _isolate_after_quotation(tmp_path, monkeypatch):
    """After Quotation keeps live data next to server.py: the index disk copies,
    the order file, the change log and the undo backups. A test that rebuilt the
    index with a fake empty Shopify once wrote an EMPTY backend/aq_index_dk.json
    (30 Sep) — the next real start would have served DK with no products."""
    import server

    monkeypatch.setattr(server, 'AQ_INDEX_DISK', str(tmp_path / 'aq_index_%s.json'))
    monkeypatch.setattr(server, 'AQ_ORDERS_PATH', str(tmp_path / 'aq_orders.json'))
    monkeypatch.setattr(server, 'AQ_HISTORY_PATH', str(tmp_path / 'aq_history.jsonl'))
    monkeypatch.setattr(server, 'AQ_BACKUP_DIR', str(tmp_path / 'aq_backups'))
    monkeypatch.setattr(server, 'AQ_SIZE_REPORT_PATH', str(tmp_path / 'aq_size_backfill.json'))
    monkeypatch.setattr(server, '_AQ_INDEX', {})
    monkeypatch.setattr(server, '_AQ_ORDERS', {'data': None, 'agg': None, 'ver': 0})
    monkeypatch.setattr(server, '_AQ_SUMMARY_CACHE', {'sig': None, 'items': None})
    monkeypatch.setattr(server, '_AQ_LIST_CACHE', {'sig': None, 'payload': None})
    monkeypatch.setattr(server, '_AQ_HISTORY_CACHE', {'v': None})


@pytest.fixture(autouse=True)
def _isolate_name_pool(tmp_path, monkeypatch):
    """The name-pool watch keeps its 'already warned' state in
    backend/name_pool_watch.json (30 Sep 2026: kept in memory, it was lost on
    every deploy restart and each deploy sent a false Slack ping). Without this
    the watch tests would write that file into the public repo and the next run
    would start from its leftovers instead of a clean slate."""
    import server

    monkeypatch.setattr(server, 'NAME_POOL_STATE_PATH', str(tmp_path / 'name_pool_watch.json'))
    monkeypatch.setattr(server, '_NAME_POOL_LAST', {'at': 0.0, 'status': None, 'warned_free': None})
    monkeypatch.setattr(server, '_NAME_POOL_SYNC', {'at': 0.0, 'result': None})
