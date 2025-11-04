from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
import json
import os

# Assuming you have already created and saved the router file at this path:
from app.api.router import router


class NormalizeJSONMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        resp = await call_next(request)
        content_type = resp.headers.get("content-type", "")
        # Only try to normalize JSON responses
        if "application/json" in content_type:
            # Consume the body iterator to reconstruct the payload
            body = b""
            async for chunk in resp.body_iterator:
                body += chunk
            try:
                parsed = json.loads(body.decode()) if body else None
            except Exception:
                parsed = body.decode(errors="ignore")
            normalized = {"status": "ok", "result": parsed}
            return JSONResponse(normalized, status_code=resp.status_code)
        return resp


app = FastAPI(
    title="Tourist Attraction Route Optimizer API",
    description="Backend service using SQLite and Google Maps API.",
    version="1.0.0",
)

# CORS configuration — defaults to allow all origins in development but can be locked down via env
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Normalize JSON responses to a small envelope: {status, result}
# Controlled by ENABLE_RESPONSE_NORMALIZE env var (default false)
# Set ENABLE_RESPONSE_NORMALIZE=true to enable the envelope wrapper.
enable_norm = os.getenv("ENABLE_RESPONSE_NORMALIZE", "false").lower() == "true"
if enable_norm:
    app.add_middleware(NormalizeJSONMiddleware)

# Include the API router
app.include_router(router)


@app.get("/", include_in_schema=False)
async def root():
    return {"message": "Welcome to the Tourist Attraction Route Optimizer API. See /docs for endpoints."}


if __name__ == "__main__":
    # --- CRITICAL FIX: COMMENTED OUT OLD AUTO-START ---
    # The uvicorn run command here is deprecated and can cause issues.
    # We now use the start.py script for a clean launch.
    # import uvicorn
    # uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
    pass
