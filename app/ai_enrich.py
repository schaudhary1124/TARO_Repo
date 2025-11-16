# app/ai_enrich.py
import os
import time
import json
import sqlite3
import re
import urllib.parse
from typing import List, Dict, Any, Optional, Tuple

import requests

# Try to import google.genai (Gemini) safely
try:
    from google import genai  # same as gemini_ai.py
except ImportError:
    genai = None  # type: ignore

# ------------------------------
# Config
# ------------------------------
WIKI_TIMEOUT = float(os.getenv("WIKI_TIMEOUT", "4.0"))
GEMINI_TIMEOUT = float(os.getenv("GEMINI_TIMEOUT", "10.0"))  # kept for consistency
TTL_HOURS = int(os.getenv("AI_ENRICH_TTL_HOURS", "336"))  # 14 days default

# Sanitize model name, default to a known-good one
_raw_model = os.getenv("GEMINI_MODEL") or "gemini-2.5-flash"
if _raw_model.startswith("models/"):
    _raw_model = _raw_model.split("/", 1)[1]
GEMINI_MODEL = _raw_model
_gemini_model = GEMINI_MODEL  # <- used in checks below

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()

# Only enable Gemini if we have BOTH a key and the genai module
AI_PROVIDER = "gemini" if GEMINI_API_KEY and genai is not None else "off"

import logging
logger = logging.getLogger("uvicorn.error")

if genai is None:
    logger.error("google.genai is not available. Install 'google-genai' in this venv to enable AI.")
logger.info(f"ai_enrich.py using provider: {AI_PROVIDER}")

# Make the provider visible via env for code that reads os.getenv("AI_PROVIDER")
os.environ["AI_PROVIDER"] = AI_PROVIDER

# Aggressively unset all possible Google Cloud auth vars to force API key usage
auth_vars = [
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GCLOUD_PROJECT",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_CLOUD_QUOTA_PROJECT",
    "ADC_TRACING",
]
for var in auth_vars:
    if var in os.environ:
        del os.environ[var]
        logger.info(f"Unset conflicting auth var: {var}")

# Initialize Gemini client once (new client)
_gemini_client: Optional["genai.Client"] = None  # type: ignore[name-defined]
if AI_PROVIDER == "gemini":
    try:
        _gemini_client = genai.Client(api_key=GEMINI_API_KEY)  # type: ignore[operator]
        logger.info(f"Gemini client initialized for ai_enrich.py with model: {GEMINI_MODEL}")
    except Exception as e:
        logger.error(f"Failed to initialize Gemini client: {e}")
        _gemini_client = None


# ------------------------------
# Schema
# ------------------------------
def ensure_schema(conn: sqlite3.Connection) -> None:
    """
    Ensure the attractions table has ai_* columns. Idempotent.
    """
    conn.row_factory = sqlite3.Row
    cur = conn.execute("PRAGMA table_info('attractions');")
    cols = {row["name"] if isinstance(row, sqlite3.Row) else row[1] for row in cur.fetchall()}
    to_add: List[Tuple[str, str]] = []
    if "ai_description" not in cols:
        to_add.append(("ai_description", "TEXT"))
    if "ai_website_url" not in cols:
        to_add.append(("ai_website_url", "TEXT"))
    if "ai_address" not in cols:
        to_add.append(("ai_address", "TEXT"))
    if "ai_source" not in cols:
        to_add.append(("ai_source", "TEXT"))
    if "ai_updated_at" not in cols:
        to_add.append(("ai_updated_at", "REAL"))

    for name, typ in to_add:
        conn.execute(f"ALTER TABLE attractions ADD COLUMN {name} {typ};")
    if to_add:
        conn.commit()


# ------------------------------
# Helpers
# ------------------------------
def _now() -> float:
    return time.time()


def _is_stale(ts: Optional[float]) -> bool:
    if not ts:
        return True
    return ((_now() - ts) / 3600.0) > TTL_HOURS


def _safe_url(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    u = url.strip()
    if not u:
        return None
    if u.startswith("//"):
        u = "https:" + u
    if not re.match(r"^https?://", u, re.I):
        u = "https://" + u
    return u


def _parse_wikipedia_tag(tag: Optional[str]) -> Optional[Tuple[str, str]]:
    """
    Accepts formats like 'en:Some_Page' or full URL.
    Returns (lang, title) or None.
    """
    if not tag:
        return None
    t = tag.strip()
    if not t:
        return None

    if t.startswith("http://") or t.startswith("https://"):
        # Try to extract lang + title from URL
        m = re.match(r"^https?://([a-z]+)\.wikipedia\.org/wiki/(.+)$", t)
        if m:
            lang = m.group(1)
            title = m.group(2)
            return lang, title
        return None

    # "en:Page_Name" format
    if ":" in t:
        lang, title = t.split(":", 1)
        lang = lang.strip() or "en"
        title = title.strip().replace(" ", "_")
        return lang, title
    return None


def _wikipedia_summary(lang: str, title: str) -> Optional[str]:
    url = f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(title)}"
    headers = {"User-Agent": "TARO/1.0 (local)"}
    try:
        r = requests.get(url, headers=headers, timeout=WIKI_TIMEOUT)
        if r.status_code != 200:
            return None
        j = r.json()
        extract = j.get("extract")
        if not extract:
            return None
        # keep it concise
        words = extract.strip().split()
        if len(words) > 40:
            extract = " ".join(words[:40]).rstrip(",.;:") + "."
        return extract
    except Exception:
        return None


def _update_row(
    conn: sqlite3.Connection,
    item_id: str,
    desc: str,
    site: Optional[str],
    source: str,
    address: Optional[str],
) -> None:
    conn.execute(
        """
        UPDATE attractions
        SET ai_description = ?, ai_website_url = ?, ai_source = ?, ai_updated_at = ?, ai_address = ?
        WHERE id = ?
        """,
        (desc, site, source, _now(), address, item_id),
    )
    conn.commit()


def _read_cache_row(conn: sqlite3.Connection, item_id: str) -> Optional[sqlite3.Row]:
    conn.row_factory = sqlite3.Row
    return conn.execute(
        "SELECT ai_description, ai_website_url, ai_source, ai_updated_at, ai_address FROM attractions WHERE id = ?",
        (item_id,),
    ).fetchone()


def _fallback_summary(name: Optional[str], category: Optional[str]) -> str:
    n = (name or "This place").strip()
    cat = (category or "attraction").strip()
    return f"{n} is a {cat} popular with visitors."


# ------------------------------
# Gemini (bulk) – one call for up to 20 items
# ------------------------------
def _gemini_bulk(items: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """
    items: [{id, name, category, wikipedia, website_url, lat, lon, address}]
    Returns mapping id -> {summary, website_url, address}
    """
    if AI_PROVIDER != "gemini" or _gemini_client is None:
        return {}

    # Build the schema as a JSON prompt
    schema = {
        "instruction": (
            "You are enriching place data for a travel app. "
            "Return STRICT JSON only (no commentary), an array of objects with fields: "
            "`id` (string, unchanged), `summary` (Generate a descriptive, informative, and engaging summary, max 30 words), "
            "`website_url` (verified official site if known, else null), "
            "`address` (concise, full, verified postal address in one line, or null). "
            "Prefer Wikipedia/OSM data if provided. Only infer address if necessary and confident. "
            "Do not invent URLs or addresses."
        ),
        "items": items,
        "output_format_example": [
            {
                "id": "node/123",
                "summary": "The Cleveland Hungarian Museum is a great place to explore Hungarian heritage and culture.",
                "website_url": "https://example.org",
                "address": "123 Main St, Anytown, ST 12345",
            },
            {
                "id": "node/456",
                "summary": "This museum showcases Hungarian culture, featuring old-world costumes, detailed embroidery, art, and the history of the local Hungarian community.",
                "website_url": None,
                "address": None,
            },
        ],
    }

    prompt = json.dumps(schema, ensure_ascii=False)

    try:
        resp = _gemini_client.models.generate_content(  # type: ignore[union-attr]
            model=_gemini_model,
            contents=prompt,
            config={
                "response_mime_type": "application/json",
            },
        )

        text = getattr(resp, "text", None)
        if not text:
            logger.error("Gemini returned empty text response in bulk enrichment.")
            return {}

        data = json.loads(text)

        out: Dict[str, Dict[str, Any]] = {}
        for obj in data:
            _id = obj.get("id")
            if not _id:
                continue
            s = (obj.get("summary") or "").strip()
            u = _safe_url(obj.get("website_url"))
            a = (obj.get("address") or "").strip()
            if s:
                out[_id] = {
                    "summary": s,
                    "website_url": u,
                    "address": a or None,
                }
        return out

    except Exception as e:
        logger.error(f"Gemini bulk enrichment failed: {e}")
        return {}


# ------------------------------
# Single item (blocking)
# ------------------------------
def enrich_one(conn: sqlite3.Connection, base: Dict[str, Any], force: bool = False) -> Dict[str, Any]:
    """
    Enrich a single item and write-through cache.
    base keys: id, name, wikipedia, tourism, historic, leisure, amenity, website_url,
               opening_hours, lat, lon, address
    """
    ensure_schema(conn)

    item_id = base["id"]
    name = base.get("name")
    category = (
        base.get("tourism")
        or base.get("historic")
        or base.get("leisure")
        or base.get("amenity")
        or "attraction"
    )
    osm_address = base.get("address")  # OSM-derived address for use/fallback

    # 1) honor cache if fresh and not forced
    row = _read_cache_row(conn, item_id)
    if row and row["ai_description"] and not force and not _is_stale(row["ai_updated_at"]):
        # Force refresh if the cached summary is from a generic source ("fallback", "osm") and AI is enabled
        if (row["ai_source"] or "").lower() not in ("fallback", "osm") or AI_PROVIDER != "gemini":
            return {
                "id": item_id,
                "summary": row["ai_description"],
                "website_url": row["ai_website_url"],
                "address": row["ai_address"],
                "source": "cache",
                "updated_at": row["ai_updated_at"],
            }
        # Fall-through to AI enrichment if stale/generic

    # 2) try OSM website + Wikipedia first
    site = _safe_url(base.get("website_url"))
    wiki = _parse_wikipedia_tag(base.get("wikipedia"))

    # wikipedia summary preferred if available
    if wiki:
        summary = _wikipedia_summary(wiki[0], wiki[1])
        if summary:
            # Note: Wikipedia summary doesn't provide a site/address, so we keep existing OSM site/address
            _update_row(conn, item_id, summary, site, "wikipedia", osm_address)
            row = _read_cache_row(conn, item_id)
            return {
                "id": item_id,
                "summary": row["ai_description"],
                "website_url": row["ai_website_url"],
                "address": row["ai_address"],
                "source": row["ai_source"],
                "updated_at": row["ai_updated_at"],
            }

    # if we have official site but no summary and not forced: create short fallback
    if site and not force and (not row or not row["ai_description"]):
        summary = _fallback_summary(name, category)
        _update_row(conn, item_id, summary, site, "osm", osm_address)
        row = _read_cache_row(conn, item_id)
        return {
            "id": item_id,
            "summary": row["ai_description"],
            "website_url": row["ai_website_url"],
            "address": row["ai_address"],
            "source": row["ai_source"],
            "updated_at": row["ai_updated_at"],
        }

    # 3) AI if allowed (forced or still missing)
    if AI_PROVIDER == "gemini" and _gemini_model is not None and _gemini_client is not None:
        out = _gemini_bulk(
            [
                {
                    "id": item_id,
                    "name": name,
                    "category": category,
                    "wikipedia": base.get("wikipedia"),
                    "website_url": site,
                    "lat": base.get("lat"),  # Pass location context
                    "lon": base.get("lon"),  # Pass location context
                    "address": osm_address,  # Pass current address context
                }
            ]
        )
        if item_id in out:
            summary = out[item_id]["summary"]
            site2 = out[item_id].get("website_url") or site
            address2 = out[item_id].get("address") or osm_address  # Use AI address if provided, else OSM

            _update_row(conn, item_id, summary, site2, "gemini", address2)
            row = _read_cache_row(conn, item_id)
            return {
                "id": item_id,
                "summary": row["ai_description"],
                "website_url": row["ai_website_url"],
                "address": row["ai_address"],
                "source": row["ai_source"],
                "updated_at": row["ai_updated_at"],
            }

    # 4) last resort fallback
    summary = _fallback_summary(name, category)
    _update_row(conn, item_id, summary, site, "fallback", osm_address)
    row = _read_cache_row(conn, item_id)
    return {
        "id": item_id,
        "summary": row["ai_description"],
        "website_url": row["ai_website_url"],
        "address": row["ai_address"],
        "source": row["ai_source"],
        "updated_at": row["ai_updated_at"],
    }


# ------------------------------
# Bulk – one Gemini call for the ones that actually need AI
# ------------------------------
def bulk_enrich(
    conn: sqlite3.Connection, bases: List[Dict[str, Any]], force: bool = False
) -> List[Dict[str, Any]]:
    """
    Process up to 20 items. Uses free fallbacks first, then ONE Gemini call for the rest.
    Writes to DB for every item that needed enrichment (write-through cache).
    Returns [{id, summary, website_url, source, updated_at, address}] in the same order as bases.
    """
    ensure_schema(conn)
    conn.row_factory = sqlite3.Row

    if not bases:
        return []

    # map id -> (cached row or None)
    id_list = [b["id"] for b in bases]
    placeholders = ",".join(["?"] * len(id_list))
    rows = {
        r["id"]: r
        for r in conn.execute(
            f"SELECT id, ai_description, ai_website_url, ai_source, ai_updated_at, ai_address "
            f"FROM attractions WHERE id IN ({placeholders})",
            tuple(id_list),
        ).fetchall()
    }

    results: Dict[str, Dict[str, Any]] = {}
    needs_ai: List[Dict[str, Any]] = []

    for b in bases:
        item_id = b["id"]
        name = b.get("name")
        category = (
            b.get("tourism")
            or b.get("historic")
            or b.get("leisure")
            or b.get("amenity")
            or "attraction"
        )
        site = _safe_url(b.get("website_url"))
        wiki = _parse_wikipedia_tag(b.get("wikipedia"))
        osm_address = b.get("address")  # OSM-derived address
        r = rows.get(item_id)

        # fresh cache (unless force)
        if r and r["ai_description"] and not force and not _is_stale(r["ai_updated_at"]):
            # Force refresh if the cached summary is from a generic source and AI is enabled
            if (r["ai_source"] or "").lower() not in ("fallback", "osm") or AI_PROVIDER != "gemini":
                results[item_id] = {
                    "id": item_id,
                    "summary": r["ai_description"],
                    "website_url": r["ai_website_url"],
                    "address": r["ai_address"],
                    "source": "cache",
                    "updated_at": r["ai_updated_at"],
                }
                continue

        # Wikipedia
        if wiki:
            summary = _wikipedia_summary(wiki[0], wiki[1])
            if summary:
                _update_row(conn, item_id, summary, site, "wikipedia", osm_address)
                rr = _read_cache_row(conn, item_id)
                results[item_id] = {
                    "id": item_id,
                    "summary": rr["ai_description"],
                    "website_url": rr["ai_website_url"],
                    "address": rr["ai_address"],
                    "source": rr["ai_source"],
                    "updated_at": rr["ai_updated_at"],
                }
                continue

        # OSM-only fallback (when not forced)
        if site and not force:
            summary = _fallback_summary(name, category)
            _update_row(conn, item_id, summary, site, "osm", osm_address)
            rr = _read_cache_row(conn, item_id)
            results[item_id] = {
                "id": item_id,
                "summary": rr["ai_description"],
                "website_url": rr["ai_website_url"],
                "address": rr["ai_address"],
                "source": rr["ai_source"],
                "updated_at": rr["ai_updated_at"],
            }
            continue

        # needs AI
        needs_ai.append(
            {
                "id": item_id,
                "name": name,
                "category": category,
                "wikipedia": b.get("wikipedia"),
                "website_url": site,
                "lat": b.get("lat"),  # Pass location context
                "lon": b.get("lon"),  # Pass location context
                "address": osm_address,  # Pass current address context
            }
        )

    # ONE Gemini call for the remainder (if enabled)
    ai_map: Dict[str, Dict[str, Any]] = {}
    if needs_ai and AI_PROVIDER == "gemini" and _gemini_model is not None and _gemini_client is not None:
        ai_map = _gemini_bulk(needs_ai)

    # Write AI results (or final fallback) and fill result set
    for b in bases:
        item_id = b["id"]
        if item_id in results:
            continue  # already handled via cache/wiki/osm

        site = _safe_url(b.get("website_url"))
        osm_address = b.get("address")

        if item_id in ai_map:
            summary = ai_map[item_id]["summary"]
            site2 = ai_map[item_id].get("website_url") or site
            address2 = ai_map[item_id].get("address") or osm_address  # Use AI address if provided, else OSM
            _update_row(conn, item_id, summary, site2, "gemini", address2)
        else:
            # final fallback
            category = (
                b.get("tourism")
                or b.get("historic")
                or b.get("leisure")
                or b.get("amenity")
                or "attraction"
            )
            summary = _fallback_summary(b.get("name"), category)
            _update_row(conn, item_id, summary, site, "fallback", osm_address)

        rr = _read_cache_row(conn, item_id)
        results[item_id] = {
            "id": item_id,
            "summary": rr["ai_description"],
            "website_url": rr["ai_website_url"],
            "address": rr["ai_address"],
            "source": rr["ai_source"],
            "updated_at": rr["ai_updated_at"],
        }

    # Return in original order
    return [results[b["id"]] for b in bases]


# ------------------------------
# Background refresh hook (used by router for SWR)
# ------------------------------
def refresh_one(db_file: str, base: Dict[str, Any], force: bool = True) -> None:
    conn = sqlite3.connect(db_file, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("PRAGMA busy_timeout=3000;")
    except Exception:
        pass
    try:
        enrich_one(conn, base, force=force)
    finally:
        conn.close()
