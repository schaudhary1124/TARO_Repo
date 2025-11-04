import os
import json
import sqlite3
from typing import Optional, Any

SQLITE_FILE = os.environ.get("SQLITE_FILE", "data.sqlite")


def _get_conn():
    conn = sqlite3.connect(SQLITE_FILE, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def init_cache():
    """Ensure the route_cache table exists."""
    conn = _get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS route_cache (
            key TEXT PRIMARY KEY,
            result_json TEXT NOT NULL,
            source TEXT,
            ts INTEGER DEFAULT (strftime('%s','now'))
        )
        """
    )
    conn.commit()
    conn.close()


def get_cached(key: str) -> Optional[Any]:
    conn = _get_conn()
    cur = conn.cursor()
    cur.execute("SELECT result_json, source FROM route_cache WHERE key = ?", (key,))
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    try:
        return json.loads(row["result_json"])
    except Exception:
        return None


def set_cached(key: str, result: Any, source: str = "local") -> None:
    conn = _get_conn()
    cur = conn.cursor()
    result_json = json.dumps(result, separators=(',', ':'), ensure_ascii=False)
    cur.execute(
        "INSERT OR REPLACE INTO route_cache(key, result_json, source) VALUES (?, ?, ?)",
        (key, result_json, source),
    )
    conn.commit()
    conn.close()


def clear_cache() -> int:
    """Delete all cache entries and return the number deleted."""
    conn = _get_conn()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(1) as cnt FROM route_cache")
    row = cur.fetchone()
    try:
        before = int(row["cnt"]) if row else 0
    except Exception:
        before = 0
    cur.execute("DELETE FROM route_cache")
    conn.commit()
    conn.close()
    return before
