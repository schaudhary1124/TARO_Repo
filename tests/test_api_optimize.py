from fastapi.testclient import TestClient
import os
import sys
from pathlib import Path

# Ensure repo root is on sys.path so top-level `main.py` can be imported during pytest
repo_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(repo_root))
from main import app


client = TestClient(app)


def test_optimize_mock():
    # pick three ids from the DB; these are known to exist from earlier runs
    # We'll query /api/attractions to get three ids dynamically
    r = client.get('/api/attractions?limit=3')
    assert r.status_code == 200
    data = r.json()
    assert data['count'] == 3
    ids = [row.get('id') for row in data['rows']]
    payload = {'attraction_ids': ids}

    # Ensure GOOGLE_MAPS_API_KEY is not set in test env
    if 'GOOGLE_MAPS_API_KEY' in os.environ:
        del os.environ['GOOGLE_MAPS_API_KEY']

    r2 = client.post('/api/optimize', json=payload)
    assert r2.status_code == 200
    j = r2.json()
    assert j.get('mock') is True
    assert 'prepared_request' in j
    # DB may return multiple rows per id if data contains duplicates; ensure at least requested count
    assert j['count'] >= len(ids)
    # verify prepared params shape
    pr = j['prepared_request']
    assert 'url' in pr and 'params' in pr
    assert 'origin' in pr['params'] and 'destination' in pr['params']
