import sys
from pathlib import Path
proj_root = Path(__file__).resolve().parents[1]
if str(proj_root) not in sys.path:
    sys.path.insert(0, str(proj_root))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)
res = client.post('/api/cache/clear')
print('status_code=', res.status_code)
print('body=', res.json())
