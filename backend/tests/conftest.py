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
