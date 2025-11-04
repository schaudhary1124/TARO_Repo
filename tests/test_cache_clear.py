from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_clear_cache():
    res = client.post('/api/cache/clear')
    assert res.status_code == 200
    body = res.json()
    # The middleware may wrap this as {status, result}
    if isinstance(body, dict) and body.get('status') == 'ok' and 'result' in body:
        result = body['result']
    else:
        result = body
    assert 'cleared' in result
