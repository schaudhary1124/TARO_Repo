# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
import json
import os
import sqlite3
import logging

# Routers / startup helpers
from app.api.router import router
from app.ai_enrich import ensure_schema as ai_ensure


class NormalizeJSONMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        resp = await call_next(request)
        content_type = resp.headers.get("content-type", "")
        if "application/json" in content_type:
            body = b""
            async for chunk in resp.body_iterator:
                body += chunk
            try:
                parsed = json.loads(body.decode()) if body else None
            except Exception:
                parsed = body.decode(errors="ignore")
            return JSONResponse({"status": "ok", "result": parsed}, status_code=resp.status_code)
        return resp


def _open_sqlite_for_startup(db_file: str) -> sqlite3.Connection:
    # Safe for threadpool; WAL helps concurrency; small busy timeout smooths parallel writes.
    conn = sqlite3.connect(db_file, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("PRAGMA busy_timeout=3000;")
    except Exception:
        pass
    return conn


app = FastAPI(
    title="Tourist Attraction Route Optimizer API",
    description="Backend service using SQLite and Google Maps API.",
    version="1.0.0",
)

# CORS (open in dev)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Optional JSON envelope (off by default)
enable_norm = os.getenv("ENABLE_RESPONSE_NORMALIZE", "false").lower() == "true"
if enable_norm:
    app.add_middleware(NormalizeJSONMiddleware)

# Include API routes
app.include_router(router)

# ---- Startup hooks (MUST be after app is defined) ----
logger = logging.getLogger("uvicorn.error")

@app.on_event("startup")
async def _log_routes():
    paths = [getattr(r, "path", None) for r in app.router.routes]
    logger.info("Loaded routes: %s", sorted([p for p in paths if p]))

@app.on_event("startup")
def _ai_enrich_startup():
    db_file = os.getenv("SQLITE_FILE", "data.sqlite")
    conn = _open_sqlite_for_startup(db_file)
    try:
        ai_ensure(conn)  # idempotent
    finally:
        conn.close()
# ------------------------------------------------------


@app.get("/", include_in_schema=False)
async def root():
    return {"message": "Welcome to the Tourist Attraction Route Optimizer API. See /docs for endpoints."}


if __name__ == "__main__":
    # Intentionally no uvicorn here; start with start.py or run_local.sh
    pass
