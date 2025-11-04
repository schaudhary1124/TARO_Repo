from fastapi.testclient import TestClient
import os
import sys
from pathlib import Path
import pytest

# Ensure repo root on path
repo_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(repo_root))
from main import app

client = TestClient(app)


def get_some_ids(n=5):
    r = client.get(f'/api/attractions?limit={n}')
    if r.status_code != 200:
        pytest.skip('No attractions available')
    rows = r.json().get('rows', [])
    return [r.get('id') for r in rows]


def test_optimize_with_duplicates():
    ids = get_some_ids(3)
    # duplicate the first id
    payload = {'attraction_ids': [ids[0], ids[1], ids[0]]}

    if 'GOOGLE_MAPS_API_KEY' in os.environ:
        del os.environ['GOOGLE_MAPS_API_KEY']

        r = client.post('/api/optimize', json=payload)
        assert r.status_code == 200
        j = r.json()
        assert j.get('mock') is True
        # DB may have duplicate rows; ensure returned count covers at least the unique requested ids
        assert j['count'] >= len(set(payload['attraction_ids']))
        assert 'prepared_request' in j


def test_waypoint_limit_enforced():
    # construct a payload exceeding the default MAX_WAYPOINTS (23)
    ids = get_some_ids(25)
    if len(ids) < 25:
        pytest.skip('Not enough attractions to test waypoint limit')

    payload = {'attraction_ids': ids}
    # Ensure no API key
    if 'GOOGLE_MAPS_API_KEY' in os.environ:
        del os.environ['GOOGLE_MAPS_API_KEY']

    r = client.post('/api/optimize', json=payload)
    # Should return local optimization fallback when exceeding waypoint limit
    assert r.status_code == 200
    j = r.json()
    assert j.get('mock') is True
    assert j.get('local_optimization') is True


def test_missing_coords_handled():
    # Try to call with an id that likely has no coords (create a fake id)
    payload = {'attraction_ids': ['nonexistent/fake-id-12345']}
    if 'GOOGLE_MAPS_API_KEY' in os.environ:
        del os.environ['GOOGLE_MAPS_API_KEY']
    r = client.post('/api/optimize', json=payload)
    assert r.status_code in (400, 404)
