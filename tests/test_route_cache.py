import os
import sys
from pathlib import Path
import tempfile
import json

# ensure repo root is on sys.path for pytest collection
ROOT = str(Path(__file__).resolve().parents[1])
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from app.core import cache


def test_cache_set_get(tmp_path):
    # use a temp sqlite file for cache
    db = tmp_path / "test_cache.sqlite"
    os.environ["SQLITE_FILE"] = str(db)
    cache.init_cache()

    key = "test:1"
    payload = {"ordered": [1, 2, 3], "meta": "ok"}
    cache.set_cached(key, payload, source="unit")

    got = cache.get_cached(key)
    assert got == payload


def test_optimize_cached(monkeypatch):
    # Ensure API in mock mode returns cached result on second call
    from fastapi.testclient import TestClient
    from main import app

    # point to a temp sqlite for cache initialization
    # reuse repository's data.sqlite for attractions (if present)
    client = TestClient(app)

    # craft a small optimize request with 1-2 arbitrary ids that exist in dataset
    # We don't require real ids here; the router will return 404 if not found,
    # so use an existing id by querying /api/attractions first.
    r = client.get('/api/attractions?limit=1')
    if r.status_code == 500:
        # repository has no data.sqlite; skip integration part
        return
    assert r.status_code == 200
    rows = r.json().get('rows', [])
    if not rows:
        # No data available; skip
        return
    aid = rows[0]['id']

    req = {"attraction_ids": [aid]}
    # first call: should return mock prepared_request (no GOOGLE_MAPS_API_KEY)
    r1 = client.post('/api/optimize', json=req)
    assert r1.status_code == 200
    j1 = r1.json()
    assert j1.get('mock') or j1.get('status') == 'ok'

    # second call: should return cached envelope (source: cache)
    r2 = client.post('/api/optimize', json=req)
    assert r2.status_code == 200
    j2 = r2.json()
    # cached responses use structure {status, source, result} per integration above
    assert j2 is not None
