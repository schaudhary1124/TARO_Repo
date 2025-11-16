from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel, Field
import os
import sqlite3
from pathlib import Path
from typing import List, Optional, Dict, Any
from app.models.attraction import Attraction
import requests
import time
import logging
from app.core import cache as route_cache
from math import radians, cos, sin
from collections import Counter # Used for sorting categories
import json
from app.core.auth import make_token, get_current_user
from fastapi import BackgroundTasks
from app.ai_enrich import (
    ensure_schema as ai_ensure,
    bulk_enrich as ai_bulk_enrich,
    enrich_one as ai_enrich_one,
    refresh_one as ai_refresh_one,
)

router = APIRouter(prefix="/api")

import time, logging
logging.getLogger("uvicorn.error").info("router.py loaded at %s", time.time())

# ... (haversine, geocode_address, _parse_coord_from_row, _point_segment_distance_km, _projection_fraction, _dedupe_rows_by_id, local_greedy_tsp, two_opt... all unchanged) ...
def haversine(a, b):
    from math import radians, sin, cos, sqrt, atan2
    R = 6371.0
    lat1, lon1 = radians(a[0]), radians(a[1])
    lat2, lon2 = radians(b[0]), radians(b[1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    x = sin(dlat/2)**2 + cos(lat1)*cos(lat2)*sin(dlon/2)**2
    c = 2 * atan2(sqrt(x), sqrt(1-x))
    return R * c

# --- MODIFIED: geocode_address to fix 403 Nominatim error ---
def geocode_address(address: str):
    # Try server-side key first, then fall back to the Vite key
    raw_key = (
        os.getenv('GOOGLE_MAPS_API_KEY')
        or ""
    )
    api_key = raw_key.strip().strip('"')

    # Allow "lat, lon" direct coordinates as a fast path
    if isinstance(address, str) and ',' in address:
        parts = [p.strip() for p in address.split(',') if p.strip()]
        if len(parts) == 2:
            try:
                return (float(parts[0]), float(parts[1]))
            except Exception:
                pass
    
    # 1. Google Maps Geocoding (if API key is present)
    if api_key:
        url = 'https://maps.googleapis.com/maps/api/geocode/json'
        params = {'address': address, 'key': api_key}
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        j = resp.json()
        if j.get('status') == 'OK' and j.get('results'):
            loc = j['results'][0]['geometry']['location']
            return (loc['lat'], loc['lng'])
        raise Exception('Geocoding failed: ' + str(j))
    
    # 2. Nominatim Geocoding (fallback)
    url = 'https://nominatim.openstreetmap.org/search'
    params = {'q': address, 'format': 'json', 'limit': 1}
    # --- REQUIRED FIX: Add User-Agent header ---
    headers = {
        'User-Agent': 'TARO-Tourist-Route-Optimizer/1.0 (contact@example.com)'
    }
    # --- END REQUIRED FIX ---
    
    resp = requests.get(url, params=params, headers=headers, timeout=10)
    
    # Check for HTTP status codes (especially 403 Forbidden)
    if not resp.ok:
        try:
            # Try to get a specific message if available
            detail = resp.json().get('error', resp.status_code)
        except:
            detail = resp.status_code
            
        raise Exception(f'Nominatim failed: HTTP {detail}')
        
    arr = resp.json()
    if arr:
        return (float(arr[0]['lat']), float(arr[0]['lon']))
        
    raise Exception('Nominatim: no results')
# --- END MODIFIED: geocode_address ---


def _parse_coord_from_row(row):
    lat = row.get('lat')
    lon = row.get('lon')
    if lat is not None and lon is not None:
        try:
            return (float(lat), float(lon))
        except Exception:
            pass
    wkt = row.get('wkt') or ''
    if wkt.upper().startswith('POINT'):
        inside = wkt[wkt.find('(')+1:wkt.find(')')].strip()
        parts = inside.replace(',', ' ').split()
        if len(parts) >= 2:
            try:
                lon_f = float(parts[0])
                lat_f = float(parts[1])
                return (lat_f, lon_f)
            except Exception:
                pass
    return None

def _point_segment_distance_km(p, a, b):
    R = 6371.0
    lat0 = radians(a[0])
    lon0 = radians(a[1])
    def to_xy(pt):
        lat = radians(pt[0]); lon = radians(pt[1])
        x = (lon - lon0) * cos((lat + lat0)/2) * R
        y = (lat - lat0) * R
        return (x, y)
    px, py = to_xy(p)
    ax, ay = to_xy(a)
    bx, by = to_xy(b)
    vx = bx - ax; vy = by - ay
    wx = px - ax; wy = py - ay
    vlen2 = vx*vx + vy*vy
    if vlen2 == 0:
        dx = px - ax; dy = py - ay
        return (dx*dx + dy*dy) ** 0.5
    t = (wx*vx + wy*vy) / vlen2
    t_clamped = max(0.0, min(1.0, t))
    projx = ax + t_clamped * vx
    projy = ay + t_clamped * vy
    dx = px - projx; dy = py - projy
    return (dx*dx + dy*dy) ** 0.5

def _projection_fraction(p, a, b):
    R = 6371.0
    lat0 = radians(a[0])
    lon0 = radians(a[1])
    def to_xy(pt):
        lat = radians(pt[0]); lon = radians(pt[1])
        x = (lon - lon0) * cos((lat + lat0)/2) * R
        y = (lat - lat0) * R
        return (x, y)
    px, py = to_xy(p)
    ax, ay = to_xy(a)
    bx, by = to_xy(b)
    vx = bx - ax; vy = by - ay
    wx = px - ax; wy = py - ay
    vlen2 = vx*vx + vy*vy
    if vlen2 == 0:
        return 0.0
    t = (wx*vx + wy*vy) / vlen2
    return max(0.0, min(1.0, t))

def _dedupe_rows_by_id(rows):
    seen = set()
    out = []
    for r in rows:
        rid = r.get('id')
        if rid is None:
            continue
        if rid in seen:
            continue
        seen.add(rid)
        out.append(r)
    return out

def local_greedy_tsp(coords):
    if not coords:
        return []
    n = len(coords)
    visited = [False]*n
    order = [0]
    visited[0] = True
    for _ in range(1, n):
        last = order[-1]
        best = None
        bestd = float('inf')
        for i in range(n):
            if visited[i]:
                continue
            d = haversine(coords[last], coords[i])
            if d < bestd:
                bestd = d
                best = i
        if best is None:
            break
        order.append(best)
        visited[best] = True
    return order

def two_opt(order, coords, max_iters=1000):
    n = len(order)
    if n < 4:
        return order
    def dist(i, j):
        return haversine(coords[i], coords[j])
    improved = True
    iters = 0
    while improved and iters < max_iters:
        improved = False
        iters += 1
        for a in range(0, n - 2):
            a_next = a + 1
            for b in range(a_next + 1, n - 1):
                b_next = b + 1
                i, j, k, l = order[a], order[a_next], order[b], order[b_next]
                delta = (dist(i, k) + dist(j, l)) - (dist(i, j) + dist(k, l))
                if delta < -1e-6:
                    order[a_next:b+1] = list(reversed(order[a_next:b+1]))
                    improved = True
                    break
            if improved:
                break
    return order

def _get_db_conn():
    db_file = os.getenv('SQLITE_FILE', 'data.sqlite')
    p = Path(db_file)
    if not p.exists():
        repo_root = Path(__file__).resolve().parents[2]
        p = repo_root / db_file
    if not p.exists():
        raise HTTPException(status_code=500, detail=f"SQLite file not found at {p}")
    
    conn = sqlite3.connect(str(p))
    conn.row_factory = sqlite3.Row
    return conn

# --- MODIFIED: _get_best_category ---
def _get_best_category(row: dict) -> str:
    """Extracts a single, most descriptive category from a data row."""
    # Use .get() for safety
    if isinstance(row.get('category'), str) and row['category']:
        return row['category']
        
    osm_tags = ('leisure', 'tourism', 'historic', 'amenity', 'shop', 'sport')
    for tag in osm_tags:
        value = row.get(tag)
        if isinstance(value, str) and value:
            return value.replace('_', ' ').title()
            
    return "Other" # Return a default instead of None
# --- END MODIFICATION ---


@router.get("/attractions")
async def get_attractions(limit: int = 10):
    conn = _get_db_conn()
    try:
        cur = conn.execute("SELECT * FROM attractions")
        rows = [dict(r) for r in cur.fetchall()]
        rows = _dedupe_rows_by_id(rows)
        
        # --- FIX: Populate website_url from model ---
        rows_with_url = []
        for r in rows:
            attr = Attraction.from_row(r)
            r['website_url'] = attr.website_url
            rows_with_url.append(r)
        
        rows = rows_with_url[:limit]
        # --- END FIX ---
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

    return {"count": len(rows), "rows": rows}


@router.post('/cache/clear')
async def clear_route_cache():
    try:
        cleared = route_cache.clear_cache()
        return {"status": "ok", "cleared": cleared}
    except Exception as e:
        logging.getLogger('app.api.router').exception('cache clear failed')
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/debug/top_categories')
def debug_top_categories(limit: int = 10):
    conn = _get_db_conn()
    try:
        cur = conn.execute("SELECT * FROM attractions") # Changed to SELECT *
        rows = cur.fetchall()
        counts = {}
        for row in rows:
            cat = _get_best_category(dict(row)) # Use dict(row)
            if cat:
                counts[cat] = counts.get(cat, 0) + 1
        
        top_sorted = sorted(counts.items(), key=lambda item: item[1], reverse=True)
        top = top_sorted[:limit]
        
        return {"top_categories": top, "samples": "Sampling disabled in this debug endpoint"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

# --- MODIFIED: get_all_categories ---
@router.get("/all_categories")
def get_all_categories():
    """
    Scans the entire attractions database, counts all categories,
    and returns a sorted list of the top 100 most common categories.
    """
    conn = _get_db_conn()
    category_counts = Counter()
    try:
        cur = conn.execute("SELECT * FROM attractions")
        rows = cur.fetchall()
        for row in rows:
            best_cat = _get_best_category(dict(row))
            # --- FIX: Filter out the default "Other" category ---
            if best_cat and best_cat != "Other":
                category_counts[best_cat] += 1
            # --- END FIX ---
                
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
        
    # Return only the top 100 most common categories, sorted alphabetically
    top_categories = [cat for cat, count in category_counts.most_common(100)]
    return sorted(top_categories)
# --- END MODIFICATION ---


@router.get("/attraction/{item_id:path}")
def get_attraction_details(item_id: str):
    conn = _get_db_conn()
    try:
        query = 'SELECT * FROM attractions WHERE id = ? LIMIT 1'
        cur = conn.execute(query, (item_id,))
        
        row = cur.fetchone()
        
        if row is None:
            raise HTTPException(status_code=404, detail="Attraction not found")
            
        # --- FIX: Populate website_url from model ---
        full_data = dict(row)
        attr = Attraction.from_row(full_data)
        full_data['website_url'] = attr.website_url
        return full_data
        # --- END FIX ---
        
    except Exception as e:
        logging.getLogger('app.api.router').exception(f'Error fetching details for {item_id}')
        if not isinstance(e, HTTPException):
             raise HTTPException(status_code=500, detail=str(e))
        raise e
    finally:
        conn.close()


class RatingRequest(BaseModel):
    rating: int = Field(..., ge=1, le=5)  # User's new rating (1-5)

@router.post("/attraction/{item_id:path}/rate")
def rate_attraction(item_id: str, req: RatingRequest, user=Depends(get_current_user)):
    """
    Stores or updates a rating for an attraction by the current user.
    Requires authentication.
    """
    if not user:
        raise HTTPException(status_code=401, detail="Login required")

    conn = _get_db()
    try:
        # Validate attraction exists
        exists = conn.execute("SELECT 1 FROM attractions WHERE id = ?", (item_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Attraction not found")

        # Check for existing rating by this user
        row = conn.execute(
            "SELECT rating FROM ratings WHERE user_id = ? AND attraction_id = ?",
            (user["sub"], item_id)
        ).fetchone()

        if row:
            # Update existing rating
            conn.execute(
                "UPDATE ratings SET rating = ? WHERE user_id = ? AND attraction_id = ?",
                (req.rating, user["sub"], item_id)
            )

        else:
            # Insert new rating
            conn.execute(
                "INSERT INTO ratings (user_id, attraction_id, rating) VALUES (?, ?, ?)",
                (user["sub"], item_id, req.rating)
            )

        conn.commit()

        # Return updated aggregate rating data
        agg = conn.execute(
            "SELECT COUNT(*) AS count, AVG(rating) AS avg FROM ratings WHERE attraction_id = ?",
            (item_id,)
        ).fetchone()

        return {
            "attraction_id": item_id,
            "user_rating": req.rating,
            "rating_count": agg["count"],
            "average_rating": round(agg["avg"], 2) if agg["avg"] is not None else None
        }

    except Exception as e:
        conn.rollback()
        logging.getLogger('app.api.router').exception(f'Error rating item {item_id}')
        if not isinstance(e, HTTPException):
            raise HTTPException(status_code=500, detail=str(e))
        raise e
    finally:
        conn.close()


class OptimizeRequest(BaseModel):
    attraction_ids: List[str]
    departure: Optional[List[float]] = None
    arrival: Optional[List[float]] = None

@router.delete("/attraction/{item_id:path}/rate")
def delete_rating(item_id: str, user=Depends(get_current_user)):
    """
    Deletes the current user's rating for the given attraction, if it exists.
    Returns updated aggregates so the UI can refresh.
    """
    if not user:
        raise HTTPException(status_code=401, detail="Login required")

    conn = _get_db()
    try:
        # Was there a rating?
        exists = conn.execute(
            "SELECT 1 FROM ratings WHERE user_id = ? AND attraction_id = ?",
            (user["sub"], item_id)
        ).fetchone()

        deleted = False
        if exists:
            conn.execute(
                "DELETE FROM ratings WHERE user_id = ? AND attraction_id = ?",
                (user["sub"], item_id)
            )
            conn.commit()
            deleted = True

        # Return updated aggregate rating data
        agg = conn.execute(
            "SELECT COUNT(*) AS count, AVG(rating) AS avg FROM ratings WHERE attraction_id = ?",
            (item_id,)
        ).fetchone()

        return {
            "attraction_id": item_id,
            "deleted": deleted,
            "rating_count": agg["count"],
            "average_rating": round(agg["avg"], 2) if agg["avg"] is not None else None
        }
    except Exception as e:
        conn.rollback()
        logging.getLogger('app.api.router').exception(f'Error deleting rating for {item_id}')
        if not isinstance(e, HTTPException):
            raise HTTPException(status_code=500, detail=str(e))
        raise e
    finally:
        conn.close()



@router.post("/optimize")
def optimize_route(req: OptimizeRequest):
    api_key = os.getenv('GOOGLE_MAPS_API_KEY')
    conn = _get_db_conn()
    id_to_attraction = {}
    try:
        placeholders = ','.join('?' for _ in req.attraction_ids)
        q = f"SELECT * FROM attractions WHERE id IN ({placeholders})"
        cur = conn.execute(q, tuple(req.attraction_ids))
        rows = [dict(r) for r in cur.fetchall()]
        for r in rows:
            a = Attraction.from_row(r)
            if a.id:
                 id_to_attraction[a.id] = a
    finally:
        conn.close()
    attractions = []
    for user_id in req.attraction_ids:
        if user_id in id_to_attraction:
            attractions.append(id_to_attraction[user_id])
    if not attractions:
        raise HTTPException(status_code=404, detail="No attractions found for provided ids")
    seen_coords = set()
    coords = []
    coord_to_attraction_map = {}
    for a in attractions:
        c = a.to_coord()
        if c is None:
            continue
        c_str = f"{c[0]},{c[1]}"
        if c_str in seen_coords:
            continue
        seen_coords.add(c_str)
        coords.append(c)
        coord_to_attraction_map[c_str] = a
    if not coords:
        raise HTTPException(status_code=400, detail="No valid coordinates available for provided attractions")
    def make_cache_key(attraction_ids, departure, arrival):
        dep = f"{departure[0]},{departure[1]}" if departure else ""
        arr = f"{arrival[0]},{arrival[1]}" if arrival else ""
        ids_part = ",".join(map(str, sorted(attraction_ids)))
        return f"opt:dep={dep}:arr={arr}:ids={ids_part}"
    cache_key = make_cache_key(req.attraction_ids, req.departure, req.arrival)
    waypoint_strs = [f"{c[0]},{c[1]}" for c in coords]
    MAX_WAYPOINTS = int(os.getenv('GOOGLE_MAX_WAYPOINTS', '23'))
    try:
        cached = route_cache.get_cached(cache_key)
    except Exception:
        cached = None
        logging.getLogger('app.api.router').exception('cache get failed')
    if cached:
        if isinstance(cached, dict) and 'prepared_request' in cached and len(coords) > MAX_WAYPOINTS:
            logging.getLogger('app.api.router').info('ignoring prepared_request cache because local fallback required')
        else:
            logging.getLogger('app.api.router').info('returning cached route for key %s', cache_key)
            try:
                if isinstance(cached, dict):
                    cached.setdefault('source', 'cache')
                    return cached
            except Exception:
                logging.getLogger('app.api.router').exception('while preparing cached response')
            return {"status": "ok", "source": "cache", "result": cached}
    if len(waypoint_strs) > MAX_WAYPOINTS:
        start_t = time.time()
        order = local_greedy_tsp(coords)
        order = two_opt(order, coords, max_iters=2000)
        duration = time.time() - start_t
        logging.getLogger('app.api.router').info('local TSP used: n=%d duration=%.3fs', len(coords), duration)
        ordered_attractions = []
        for i in order:
            c = coords[i]
            c_str = f"{c[0]},{c[1]}"
            if c_str in coord_to_attraction_map:
                ordered_attractions.append(coord_to_attraction_map[c_str])
        result = {
            'mock': True,
            'local_optimization': True,
            'orderedAttractions': [a.__dict__ for a in ordered_attractions], 
            'count': len(ordered_attractions),
            'note': f'Local greedy TSP used because waypoint count {len(waypoint_strs)} exceeded max {MAX_WAYPOINTS}'
        }
        try:
            route_cache.set_cached(cache_key, result, source='local')
        except Exception:
            logging.getLogger('app.api.router').exception('cache set failed')
        return result
    origin_str = f"{req.departure[0]},{req.departure[1]}" if req.departure else waypoint_strs[0]
    destination_str = f"{req.arrival[0]},{req.arrival[1]}" if req.arrival else waypoint_strs[-1]
    intermediate_strs = []
    if len(waypoint_strs) > 0:
        intermediate_strs = waypoint_strs
        if req.departure: pass 
        else: intermediate_strs = intermediate_strs[1:]
        if req.arrival: pass
        else: intermediate_strs = intermediate_strs[:-1]
    waypoints_param = 'optimize:true|' + '|'.join(intermediate_strs) if intermediate_strs else ''
    params = {
        'origin': origin_str,
        'destination': destination_str,
        'waypoints': waypoints_param,
        'key': api_key or ''
    }
    prepared = {
        'url': 'https://maps.googleapis.com/maps/api/directions/json',
        'params': params,
        'note': 'If GOOGLE_MAPS_API_KEY env var is set the server will forward this request.'
    }
    if not api_key:
        result = {'mock': True, 'prepared_request': prepared, 'count': len(attractions)}
        try:
            route_cache.set_cached(cache_key, result, source='mock')
        except Exception:
            logging.getLogger('app.api.router').exception('cache set failed')
        return result
    try:
        resp = requests.get(prepared['url'], params=params, timeout=15)
        resp.raise_for_status()
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=str(e))
    res_json = resp.json()
    if res_json.get('routes') and res_json['routes'][0].get('waypoint_order'):
        waypoint_order = res_json['routes'][0]['waypoint_order']
        intermediate_attractions = []
        if len(waypoint_strs) > 0:
            intermediate_attractions = attractions
            if req.departure: pass
            else: intermediate_attractions = intermediate_attractions[1:]
            if req.arrival: pass
            else: intermediate_attractions = intermediate_attractions[:-1]
        ordered_waypoints = [intermediate_attractions[i] for i in waypoint_order]
        final_ordered_list = []
        if not req.departure: final_ordered_list.append(attractions[0])
        final_ordered_list.extend(ordered_waypoints)
        if not req.arrival: final_ordered_list.append(attractions[-1])
        res_json['orderedAttractions'] = [a.__dict__ for a in final_ordered_list]
    else:
        res_json['orderedAttractions'] = [a.__dict__ for a in attractions]
    try:
        route_cache.set_cached(cache_key, res_json, source='google')
    except Exception:
        logging.getLogger('app.api.router').exception('cache set failed')
    return res_json


class BetweenRequest(BaseModel):
    start: str
    end: str
    radius_km: Optional[float] = 5.0
    limit: Optional[int] = 10
    categories: Optional[List[str]] = Field(default_factory=list)
    trashed_ids: Optional[List[str]] = Field(default_factory=list)


@router.post('/search_between')
def search_between(req: BetweenRequest):
    """Given start/end addresses, return attractions within `radius_km`."""
    if not isinstance(req.start, str) or not req.start.strip():
        raise HTTPException(status_code=400, detail="`start` must be a non-empty address string")
    if not isinstance(req.end, str) or not req.end.strip():
        raise HTTPException(status_code=400, detail="`end` must be a non-empty address string")
    try:
        a_coord = geocode_address(req.start)
        b_coord = geocode_address(req.end)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Geocode failed: {e}")

    conn = _get_db_conn()
    
    try:
        cur = conn.execute("SELECT * FROM attractions")
        rows = [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

    if req.trashed_ids:
        trashed_set = set(req.trashed_ids)
        rows = [r for r in rows if r.get('id') not in trashed_set]

    cats = getattr(req, 'categories', []) or []
    requested_tokens = [c.strip().lower() for c in cats if isinstance(c, str) and c.strip()]

    candidates = []

    for r in rows:
        coord = _parse_coord_from_row(r)
        if coord is None:
            continue
        dist_km = _point_segment_distance_km(coord, a_coord, b_coord)
        
        if dist_km <= (req.radius_km or 5.0):
            t = _projection_fraction(coord, a_coord, b_coord)
            best_cat = _get_best_category(r)
            r['category'] = best_cat
            
            # --- **** THIS IS THE FIX for filtering **** ---
            score = 0
            if not requested_tokens:
                score = 1 # If no filter is applied, show everything
            else:
                name_part = (r.get('name', '') or '').lower()
                cat_part = (best_cat or '').lower()
                
                for token in requested_tokens:
                    # If the token matches the category OR is in the name, it's a match
                    if token == cat_part or token in name_part:
                        score = 1
                        break
            # --- **** END FIX **** ---
            
            if score > 0:
                # Use Attraction model to get correct website_url
                attr = Attraction.from_row(r)
                r['website_url'] = attr.website_url
                candidates.append((score, t, dist_km, r))

    # --- NEW: Sort by category first (as requested), then by route position ---
    candidates.sort(key=lambda x: (x[3].get('category', 'Z'), x[1])) 
    # --- END NEW ---

    rows_ordered = [c[3] for c in candidates] 
    rows_ordered = _dedupe_rows_by_id(rows_ordered)

    limit_n = int(req.limit or 10)
    if limit_n <= 0:
        return {"count": 0, "rows": [], "start": a_coord, "end": b_coord}

    selected_rows = rows_ordered[:limit_n]
    
    return {"count": len(selected_rows), "rows": selected_rows, "start": a_coord, "end": b_coord}

# ============================================================
# NEW FEATURE SECTION
# ============================================================
from typing import Optional, List, Dict, Any
import sqlite3
import bcrypt


def _get_db():
    db_file = os.getenv('SQLITE_FILE', 'data.sqlite')
    conn = sqlite3.connect(db_file)
    conn.row_factory = sqlite3.Row
    return conn


# ============================================================
# 1. USER AUTH (REGISTER, LOGIN, WHOAMI)
# ============================================================

class UserCreds(BaseModel):
    email: str
    password: str

def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_pw(pw: str, hashed: str) -> bool:
    return bcrypt.checkpw(pw.encode(), hashed.encode())

# ... (auth_register, auth_login, auth_me unchanged)

@router.post("/auth/register")
def auth_register(creds: UserCreds):
    conn = _get_db()
    try:
        conn.execute(
            "INSERT INTO users (email, password_hash) VALUES (?, ?)",
            (creds.email.lower(), hash_pw(creds.password))
        )
        conn.commit()
        user = conn.execute("SELECT id, role FROM users WHERE email = ?", (creds.email.lower(),)).fetchone()
        token = make_token(user['id'], user['role'], creds.email)
        return {"token": token, "email": creds.email, "role": user['role']}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="Email already registered")
    finally:
        conn.close()

@router.post("/auth/login")
def auth_login(creds: UserCreds):
    conn = _get_db()
    row = conn.execute(
        "SELECT id, password_hash, role FROM users WHERE email = ?",
        (creds.email.lower(),)
    ).fetchone()
    conn.close()

    if not row or not verify_pw(creds.password, row['password_hash']):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = make_token(row['id'], row['role'], creds.email)
    return {"token": token, "email": creds.email, "role": row['role']}

@router.get("/auth/me")
def auth_me(user = Depends(get_current_user)):
    if not user:
        return {"guest": True}

    return {
        "id": user.get("sub"),  # ✅ Use "sub" from decoded token
        "email": user.get("email"),
        "role": user.get("role", "user"),
        "guest": False,
    }

# ============================================================
# 2. SAVED TRIPS (CREATE, LIST, LOAD, DELETE)
# ============================================================

class TripItem(BaseModel):
    id: str
    locked: bool = False
    position: Optional[int] = None

class TripIn(BaseModel):
    title: str
    start: Optional[str] = None
    end: Optional[str] = None
    radius_km: Optional[float] = None
    limit: Optional[int] = None
    categories: Optional[List[str]] = None
    trashed_ids: Optional[List[str]] = None
    attractions: Optional[List[TripItem]] = None


@router.post("/trips")
def create_trip(trip: TripIn, user=Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Login required")

    conn = _get_db()
    cur = conn.cursor()

    cur.execute(
        """
        INSERT INTO trips (user_id, title, start, end, radius_km, result_limit, categories, trashed_ids)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            user["sub"],
            trip.title,
            trip.start,
            trip.end,
            trip.radius_km,
            trip.limit,
            json.dumps(trip.categories or []),
            json.dumps(trip.trashed_ids or []),
        )
    )

    trip_id = cur.lastrowid

    if trip.attractions:
        for idx, item in enumerate(trip.attractions):
            cur.execute(
                "INSERT INTO trip_items (trip_id, attraction_id, locked, position) VALUES (?, ?, ?, ?)",
                (trip_id, item.id, int(item.locked), item.position if item.position is not None else idx)
            )

    conn.commit()
    conn.close()
    return {"id": trip_id}

@router.get("/trips")
def list_trips(user=Depends(get_current_user)):
    if not user:
        raise HTTPException(status_code=401, detail="Login required")

    conn = _get_db()
    cur = conn.execute(
        "SELECT id, title, start, end, created_at FROM trips WHERE user_id = ? ORDER BY created_at DESC",
        (user["sub"],)
    )
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return {"rows": rows}

@router.get("/trips/{trip_id}")
def get_trip(trip_id: int, user=Depends(get_current_user)):
    conn = _get_db()
    trip = conn.execute(
        "SELECT * FROM trips WHERE id = ?",
        (trip_id,)
    ).fetchone()

    if not trip or str(trip["user_id"]) != user["sub"]:
        conn.close()
        raise HTTPException(status_code=403, detail="Forbidden or not found")

    items = conn.execute(
        "SELECT attraction_id, locked, position FROM trip_items WHERE trip_id = ? ORDER BY position",
        (trip_id,)
    ).fetchall()
    conn.close()

    return {
        "id": trip["id"],
        "title": trip["title"],
        "start": trip["start"],
        "end": trip["end"],
        "radius_km": trip["radius_km"],
        "limit": trip["result_limit"],
        "categories": json.loads(trip["categories"]) if trip["categories"] else [],
        "trashed_ids": json.loads(trip["trashed_ids"]) if trip["trashed_ids"] else [],
        "attractions": [dict(r) for r in items]
    }



@router.delete("/trips/{trip_id}")
def delete_trip(trip_id: int, user=Depends(get_current_user)):
    conn = _get_db()
    trip = conn.execute(
        "SELECT * FROM trips WHERE id = ?",
        (trip_id,)
    ).fetchone()

    if not trip or str(trip["user_id"]) != user["sub"]:
        conn.close()
        raise HTTPException(status_code=403, detail="Forbidden or not found")

    conn.execute("DELETE FROM trip_items WHERE trip_id = ?", (trip_id,))
    conn.execute("DELETE FROM trips WHERE id = ?", (trip_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ============================================================
# 3. REPORT AN ISSUE
# ============================================================

class IssueIn(BaseModel):
    subject: str
    payload: Optional[Dict[str, Any]] = None

@router.post("/issues")
def report_issue(issue: IssueIn, user=Depends(get_current_user)):
    uid = user["sub"] if user else None
    conn = _get_db()
    conn.execute(
        "INSERT INTO issues (user_id, subject, payload) VALUES (?, ?, ?)",
        (uid, issue.subject, json.dumps(issue.payload or {}))
    )
    conn.commit()
    conn.close()
    return {"ok": True}

class BulkEnrichIn(BaseModel):
    ids: List[str] = Field(..., max_items=20)
    force: Optional[bool] = False

@router.post("/ai/enrich/bulk")
def enrich_bulk(req: BulkEnrichIn):
    # Validate
    if not isinstance(req.ids, list) or not req.ids:
        raise HTTPException(status_code=400, detail="ids[] required")
    if len(req.ids) > 20:
        raise HTTPException(status_code=400, detail="max 20 ids")

    conn = _get_db()
    try:
        # Ensure columns exist; safe if already present
        ai_ensure(conn)

        # Fetch in one query; keep original order later
        rows = conn.execute(
            "SELECT * FROM attractions WHERE id IN (%s)" % ",".join(["?"]*len(req.ids)),
            tuple(req.ids)
        ).fetchall()
        by_id = {r["id"]: dict(r) for r in rows}

        # Prepare “base” items
        bases = []
        for rid in req.ids:
            r = by_id.get(rid)
            if not r:
                continue
            attr = Attraction.from_row(r)
            bases.append({
                "id": attr.id,
                "name": attr.name or getattr(attr, "title", None),
                "wikipedia": attr.wikipedia,
                "tourism": attr.tourism,
                "historic": attr.historic,
                "leisure": attr.leisure,
                "amenity": attr.amenity,
                "website_url": attr.website_url,
                "opening_hours": getattr(attr, "opening_hours", None),
                # 👇 NEW: Expose location data to AI (copied from attraction_details logic below)
                "lat": r.get("lat"),
                "lon": r.get("lon"),
                "address": r.get("address"), # Simple address field if it exists
            })

        # One call; honors force=True (requires ai_enrich.py fixes)
        results = ai_bulk_enrich(conn, bases, force=bool(req.force))
        return {"status": "ok", "results": results}
    finally:
        conn.close()
# ---- End bulk endpoint ----


@router.get("/attractions/{osm_type}/{osm_id}/details")
def attraction_details(
    osm_type: str,
    osm_id: str,
    background_tasks: BackgroundTasks,
    force: bool = False,           # 👈 allow ?force=1 to re-enrich
):
    conn = _get_db()
    try:
        # Be patient with brief writer locks
        try:
            conn.execute("PRAGMA busy_timeout = 3000")
        except Exception:
            pass

        # Resolve attraction row
        full_id = f"{osm_type}/{osm_id}"
        row = conn.execute(
            "SELECT * FROM attractions WHERE id = ?",
            (full_id,),
        ).fetchone()
        if not row:
            row = conn.execute(
                "SELECT * FROM attractions WHERE id = ?",
                (osm_id,),
            ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Attraction not found")

        data = dict(row)
        attr = Attraction.from_row(data)
        best_cat = _get_best_category(data)

        # ---------- MODIFIED: build human-readable address + coords ----------
        def _pick(*keys):
            for key in keys:
                v = data.get(key)
                if v is None:
                    continue
                s = str(v).strip()
                if not s or s.lower() == "none":
                    continue
                return s
            return None

        # --- FIX 1: Prioritize AI-provided address if it exists ---
        ai_address = _pick("ai_address")
        if ai_address:
            formatted_address = ai_address
            # Fall back to checking OSM tags for components used in 'base' even if we use the AI address for display
            housenumber = _pick("addr:housenumber", "addr_housenumber", "house_number", "housenumber")
            road = _pick("addr:street", "addr_street", "road", "street")
            city = _pick("addr:city", "addr_city", "city", "town", "village", "hamlet", "municipality")
            postcode = _pick("addr:postcode", "addr_postcode", "postcode", "postal_code", "zip")
            country = _pick("addr:country", "addr_country", "country")
        else:
            # Fall back to OSM tag construction
            housenumber = _pick("addr:housenumber", "addr_housenumber", "house_number", "housenumber")
            road = _pick("addr:street", "addr_street", "road", "street")
            city = _pick("addr:city", "addr_city", "city", "town", "village", "hamlet", "municipality")
            postcode = _pick("addr:postcode", "addr_postcode", "postcode", "postal_code", "zip")
            country = _pick("addr:country", "addr_country", "country")

            line1 = " ".join(p for p in [housenumber, road] if p)
            city_post = " ".join(p for p in [city, postcode] if p)
            formatted_address = ", ".join(
                p for p in [line1 or None, city_post or None, country] if p
            ) or None
        # --- END FIX 1 ---

        try:
            lat_val = float(data.get("lat")) if data.get("lat") is not None else None
        except Exception:
            lat_val = None
        try:
            lon_val = float(data.get("lon")) if data.get("lon") is not None else None
        except Exception:
            lon_val = None
        # ---------- END MODIFIED address/coord block ----------

        # Rating stats while conn is open
        try:
            r = conn.execute(
                "SELECT COUNT(*) AS count, AVG(rating) AS avg "
                "FROM ratings WHERE attraction_id = ?",
                (attr.id,),
            ).fetchone()
            rating_count = r["count"]
            average_rating = round(r["avg"], 2) if r["avg"] is not None else None
        except Exception:
            rating_count = 0
            average_rating = None

        # Base for enrichment / refresh
        base = {
            "id": attr.id,
            "name": attr.name or getattr(attr, "title", None),
            "wikipedia": attr.wikipedia,
            "tourism": attr.tourism,
            "historic": attr.historic,
            "leisure": attr.leisure,
            "amenity": attr.amenity,
            "website_url": attr.website_url,
            "opening_hours": getattr(attr, "opening_hours", None),
            # 👇 expose location data to AI + client
            "lat": lat_val,
            "lon": lon_val,
            "address": formatted_address, # Pass the best-effort address to AI for context
            "road": road,
            "city": city,
            "country": country,
        }

        # Ensure ai_* columns exist (safe on concurrent calls)
        ai_ensure(conn)

        def build_payload(summary_text, site_url, source, updated_at, address_text):
            return {
                "id": attr.id,
                "name": attr.name or getattr(attr, "title", None),
                "summary": summary_text,
                "website_url": site_url,
                "wikipedia": attr.wikipedia,
                "tourism": attr.tourism,
                "historic": attr.historic,
                "leisure": attr.leisure,
                "amenity": attr.amenity,
                "category": best_cat,
                "rating_count": rating_count,
                "average_rating": average_rating,
                "ai_source": source,
                "ai_updated_at": updated_at,
                "ai_address": address_text, # <--- NEW RETURN
                # 👇 always return address + coords to frontend
                "lat": lat_val,
                "lon": lon_val,
                "address": address_text, # Return the best address found/generated
                "road": road,
                "city": city,
                "country": country,
            }

        # --- FORCE path: bypass cache and re-enrich now ---
        if force:
            enriched = ai_enrich_one(conn, base, force=True)
            return build_payload(
                enriched["summary"],
                enriched.get("website_url"),
                enriched["source"],
                enriched["updated_at"],
                enriched.get("address")
            )

        # Normal path: use cache if present, else enrich once
        cached = conn.execute(
            # MODIFIED: Select ai_address
            "SELECT ai_description, ai_website_url, ai_source, ai_updated_at, ai_address "
            "FROM attractions WHERE id = ?",
            (attr.id,),
        ).fetchone()

        # Cache miss OR OSM/Fallback source: blocking single enrichment (writes back)
        if not cached or not cached[0] or (cached[2] and (cached[2] or "").lower() in ("fallback", "osm") and os.getenv("AI_PROVIDER", "").lower() == "gemini"):
            enriched = ai_enrich_one(conn, base, force=True)
            return build_payload(
                enriched["summary"],
                enriched.get("website_url"),
                enriched["source"],
                enriched["updated_at"],
                enriched.get("address")
            )
        
        ai_desc, ai_site, ai_src, ai_ts, ai_addr = cached

        try:
            ttl_hours = int(os.getenv("AI_ENRICH_TTL_HOURS", "336"))
        except Exception:
            ttl_hours = 336
        is_stale = ((time.time() - (ai_ts or 0)) / 3600.0) > ttl_hours

        # Stale → serve cache now, refresh in background
        if is_stale:
            db_path = os.getenv("SQLITE_FILE", "data.sqlite")
            background_tasks.add_task(ai_refresh_one, db_path, base, True)

        return build_payload(
            ai_desc,
            ai_site,
            ai_src or ("cache" if not is_stale else "cache(stale)"),
            ai_ts or 0.0,
            ai_addr # <--- PASS CACHED ADDRESS
        )
    finally:
        conn.close()