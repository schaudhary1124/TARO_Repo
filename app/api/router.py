from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import os
import sqlite3
from pathlib import Path
from typing import List, Optional
from app.models.attraction import Attraction
import requests
import time
import logging
from app.core import cache as route_cache
from math import radians, cos, sin

router = APIRouter(prefix="/api")

# initialize cache table
try:
    route_cache.init_cache()
except Exception:
    logging.getLogger('app.api.router').exception('failed to init route cache')


def haversine(a, b):
    # a, b: (lat, lon) in degrees
    from math import radians, sin, cos, sqrt, atan2
    R = 6371.0  # km
    lat1, lon1 = radians(a[0]), radians(a[1])
    lat2, lon2 = radians(b[0]), radians(b[1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    x = sin(dlat/2)**2 + cos(lat1)*cos(lat2)*sin(dlon/2)**2
    c = 2 * atan2(sqrt(x), sqrt(1-x))
    return R * c


def geocode_address(address: str):
    """Geocode an address to (lat, lon).

    Uses Google Geocoding API if GOOGLE_MAPS_API_KEY is set, otherwise falls back to Nominatim.
    Returns (lat, lon) or raises Exception on failure.
    """
    api_key = os.getenv('GOOGLE_MAPS_API_KEY')
    # Support direct 'lat,lon' input to bypass external geocoding for local tests
    if isinstance(address, str) and ',' in address:
        parts = [p.strip() for p in address.split(',') if p.strip()]
        if len(parts) == 2:
            try:
                return (float(parts[0]), float(parts[1]))
            except Exception:
                pass
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
    # Nominatim fallback
    url = 'https://nominatim.openstreetmap.org/search'
    params = {'q': address, 'format': 'json', 'limit': 1}
    headers = {'User-Agent': 'hackohio/1.0 (email@example.com)'}
    resp = requests.get(url, params=params, headers=headers, timeout=10)
    resp.raise_for_status()
    arr = resp.json()
    if arr:
        return (float(arr[0]['lat']), float(arr[0]['lon']))
    raise Exception('Nominatim: no results')


def _parse_coord_from_row(row):
    # prefer explicit lat/lon columns
    lat = row.get('lat')
    lon = row.get('lon')
    if lat is not None and lon is not None:
        try:
            return (float(lat), float(lon))
        except Exception:
            pass
    # try WKT like 'POINT (lon lat)'
    wkt = row.get('wkt') or ''
    if wkt.upper().startswith('POINT'):
        inside = wkt[wkt.find('(')+1:wkt.find(')')].strip()
        parts = inside.replace(',', ' ').split()
        if len(parts) >= 2:
            try:
                # assume lon lat order in WKT
                lon_f = float(parts[0])
                lat_f = float(parts[1])
                return (lat_f, lon_f)
            except Exception:
                pass
    return None


def _point_segment_distance_km(p, a, b):
    # approximate small-distance planar projection using equirectangular approx
    # p, a, b are (lat, lon) in degrees
    R = 6371.0  # km
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
    """Return fractional projection t of point p onto segment a->b (0..1).
    Uses same equirectangular projection as distance helper for consistency.
    """
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
            # include rows without id
            out.append(r)
            continue
        if rid in seen:
            continue
        seen.add(rid)
        out.append(r)
    return out



def local_greedy_tsp(coords):
    # simple nearest-neighbor greedy order, returns index order
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
    # delta-based 2-opt: O(n^2) per pass but avoids full tour recompute
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
                # current edges: i-j and k-l. New edges after swap: i-k and j-l
                delta = (dist(i, k) + dist(j, l)) - (dist(i, j) + dist(k, l))
                if delta < -1e-6:
                    # perform 2-opt by reversing segment [a_next..b]
                    order[a_next:b+1] = list(reversed(order[a_next:b+1]))
                    improved = True
                    break
            if improved:
                break
    return order


@router.get("/attractions")
async def get_attractions(limit: int = 10):
    """Return up to `limit` attractions from the local SQLite file (table `attractions`)."""
    db_file = os.getenv('SQLITE_FILE', 'data.sqlite')
    # Resolve relative to project root if necessary
    p = Path(db_file)
    if not p.exists():
        # try relative to repository root
        repo_root = Path(__file__).resolve().parents[2]
        p = repo_root / db_file
    if not p.exists():
        raise HTTPException(status_code=500, detail=f"SQLite file not found: {db_file}")

    conn = sqlite3.connect(str(p))
    conn.row_factory = sqlite3.Row
    try:
        # fetch more rows than the requested limit to allow deduping to still return `limit` unique items
        cur = conn.execute("SELECT * FROM attractions")
        rows = [dict(r) for r in cur.fetchall()]
        rows = _dedupe_rows_by_id(rows)
        rows = rows[:limit]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

    return {"count": len(rows), "rows": rows}


## Deprecated: categories endpoint removed in favor of contextual categories returned from /search_between

@router.post('/cache/clear')
async def clear_route_cache():
    """Clear the route_cache table. Returns number of entries removed."""
    try:
        cleared = route_cache.clear_cache()
        return {"status": "ok", "cleared": cleared}
    except Exception as e:
        logging.getLogger('app.api.router').exception('cache clear failed')
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/debug/top_categories')
def debug_top_categories(limit: int = 10):
    """Return top categories and example attraction ids to help create sample searches locally."""
    db_file = os.getenv('SQLITE_FILE', 'data.sqlite')
    p = Path(db_file)
    if not p.exists():
        repo_root = Path(__file__).resolve().parents[2]
        p = repo_root / db_file
    if not p.exists():
        raise HTTPException(status_code=500, detail=f"SQLite file not found: {db_file}")

    conn = sqlite3.connect(str(p))
    try:
        cur = conn.execute("SELECT category, COUNT(*) as cnt FROM attractions WHERE category IS NOT NULL GROUP BY category ORDER BY cnt DESC LIMIT ?", (limit,))
        rows = cur.fetchall()
        top = [(r[0], r[1]) for r in rows]
        samples = {}
        for r in top:
            cat = r[0]
            cur2 = conn.execute("SELECT id FROM attractions WHERE category = ? LIMIT 3", (cat,))
            samples[cat] = [x[0] for x in cur2.fetchall()]
        return {"top_categories": top, "samples": samples}
    finally:
        conn.close()


## Previously there was a /api/categories route here; categories are now returned from /api/search_between


class OptimizeRequest(BaseModel):
    attraction_ids: List[str]
    departure: Optional[List[float]] = None  # [lat, lon]
    arrival: Optional[List[float]] = None


@router.post("/optimize")
def optimize_route(req: OptimizeRequest):
    """Given a list of attraction ids, lookup coordinates and call Google Directions API with optimize:true.
    If GOOGLE_MAPS_API_KEY is not set, return the prepared request payload for inspection (mock mode).
    """
    api_key = os.getenv('GOOGLE_MAPS_API_KEY')
    db_file = os.getenv('SQLITE_FILE', 'data.sqlite')
    p = Path(db_file)
    if not p.exists():
        repo_root = Path(__file__).resolve().parents[2]
        p = repo_root / db_file
    if not p.exists():
        raise HTTPException(status_code=500, detail=f"SQLite file not found: {db_file}")

    conn = sqlite3.connect(str(p))
    conn.row_factory = sqlite3.Row
    try:
        placeholders = ','.join('?' for _ in req.attraction_ids)
        q = f"SELECT * FROM attractions WHERE id IN ({placeholders})"
        cur = conn.execute(q, tuple(req.attraction_ids))
        rows = [dict(r) for r in cur.fetchall()]
        rows = _dedupe_rows_by_id(rows)
    finally:
        conn.close()

    if not rows:
        raise HTTPException(status_code=404, detail="No attractions found for provided ids")

    attractions = [Attraction.from_row(r) for r in rows]
    # deduplicate coordinates while preserving order
    seen = set()
    coords = []
    for a in attractions:
        c = a.to_coord()
        if c is None:
            continue
        if c in seen:
            continue
        seen.add(c)
        coords.append(c)
    if not coords:
        raise HTTPException(status_code=400, detail="No valid coordinates available for provided attractions")

    def make_cache_key(attraction_ids, departure, arrival):
        dep = f"{departure[0]},{departure[1]}" if departure else ""
        arr = f"{arrival[0]},{arrival[1]}" if arrival else ""
        ids_part = ",".join(map(str, sorted(attraction_ids)))
        return f"opt:dep={dep}:arr={arr}:ids={ids_part}"

    cache_key = make_cache_key(req.attraction_ids, req.departure, req.arrival)

    # Google expects waypoints as 'lat,lon' strings. Use departure/arrival if provided.
    waypoint_strs = [f"{c[0]},{c[1]}" for c in coords]

    # Google Directions free-tier waypoint limit (varies by account) — commonly 23 optimized waypoints.
    MAX_WAYPOINTS = int(os.getenv('GOOGLE_MAX_WAYPOINTS', '23'))

    # check cache now that we know the waypoints (we may need to skip cached prepared_request when local fallback required)
    try:
        cached = route_cache.get_cached(cache_key)
    except Exception:
        cached = None
        logging.getLogger('app.api.router').exception('cache get failed')
    if cached:
        # if cached is a prepared_request (mock) but current request requires local fallback (too many waypoints), ignore cache
        if isinstance(cached, dict) and 'prepared_request' in cached and len([f for f in coords]) > MAX_WAYPOINTS:
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

    # If too many waypoints, perform local TSP fallback and return result (cached)
    if len(waypoint_strs) > MAX_WAYPOINTS:
        start_t = time.time()
        order = local_greedy_tsp(coords)
        order = two_opt(order, coords)
        duration = time.time() - start_t
        logging.getLogger('app.api.router').info('local TSP used: n=%d duration=%.3fs', len(coords), duration)
        ordered_attractions = [attractions[i] for i in order]
        result = {
            'mock': True,
            'local_optimization': True,
            'ordered': [a.__dict__ for a in ordered_attractions],
            'count': len(ordered_attractions),
            'note': f'Local greedy TSP used because waypoint count {len(waypoint_strs)} exceeded max {MAX_WAYPOINTS}'
        }
        try:
            route_cache.set_cached(cache_key, result, source='local')
        except Exception:
            logging.getLogger('app.api.router').exception('cache set failed')
        return result



        if len(waypoint_strs) > MAX_WAYPOINTS:
            # fallback: perform local TSP ordering and return a mock optimized route
            start_t = time.time()
            order = local_greedy_tsp(coords)
            # improve with 2-opt
            order = two_opt(order, coords)
            duration = time.time() - start_t
            logging.getLogger('app.api.router').info('local TSP used: n=%d duration=%.3fs', len(coords), duration)
            ordered_attractions = [attractions[i] for i in order]
            return {
                'mock': True,
                'local_optimization': True,
                'ordered': [a.__dict__ for a in ordered_attractions],
                'count': len(ordered_attractions),
                'note': f'Local greedy TSP used because waypoint count {len(waypoint_strs)} exceeded max {MAX_WAYPOINTS}'
            }

    origin = f"{req.departure[0]},{req.departure[1]}" if req.departure else waypoint_strs[0]
    destination = f"{req.arrival[0]},{req.arrival[1]}" if req.arrival else waypoint_strs[-1]
    # If there are only 1-2 points, waypoints string is the set of intermediate points
    intermediate = []
    if len(waypoint_strs) > 2:
        intermediate = waypoint_strs[1:-1]
    elif len(waypoint_strs) == 2:
        intermediate = [waypoint_strs[1]]

    waypoints_param = 'optimize:true|' + '|'.join(intermediate) if intermediate else ''

    params = {
        'origin': origin,
        'destination': destination,
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

    # Make the request to Google
    try:
        resp = requests.get(prepared['url'], params=params, timeout=15)
        resp.raise_for_status()
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=str(e))

    res_json = resp.json()
    # cache the Google's response JSON for identical requests
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


@router.post('/search_between')
def search_between(req: BetweenRequest):
    """Given start/end addresses (or place names), return up to `limit` attractions whose
    projection to the segment between start and end is within `radius_km` kilometers.
    Applies Python-side sorting prioritization based on selected categories (temporary mock).
    """
    # validate input early and provide a clear error for missing addresses
    if not isinstance(req.start, str) or not req.start.strip():
        raise HTTPException(status_code=400, detail="`start` must be a non-empty address string")
    if not isinstance(req.end, str) or not req.end.strip():
        raise HTTPException(status_code=400, detail="`end` must be a non-empty address string")
    try:
        a_coord = geocode_address(req.start)
        b_coord = geocode_address(req.end)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Geocode failed: {e}")

    db_file = os.getenv('SQLITE_FILE', 'data.sqlite')
    p = Path(db_file)
    if not p.exists():
        repo_root = Path(__file__).resolve().parents[2]
        p = repo_root / db_file
    if not p.exists():
        raise HTTPException(status_code=500, detail=f"SQLite file not found: {db_file}")

    conn = sqlite3.connect(str(p))
    conn.row_factory = sqlite3.Row
    
    try:
        # --- FIX: ALWAYS QUERY ALL ROWS TO AVOID SQL ERROR ---
        # We query all rows regardless of the category column status (to prevent "no such column" error).
        cur = conn.execute("SELECT * FROM attractions")
        rows = [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

    cats = getattr(req, 'categories', []) or []
    # normalize requested categories and create a list of tokens to search against
    requested_tokens = [c.strip().lower() for c in cats if isinstance(c, str) and c.strip()]

    candidates = []
    for r in rows:
        coord = _parse_coord_from_row(r)
        if coord is None:
            continue
        dist_km = _point_segment_distance_km(coord, a_coord, b_coord)
        
        if dist_km <= (req.radius_km or 5.0):
            t = _projection_fraction(coord, a_coord, b_coord)

            # --- ADVANCED FIX: PYTHON-SIDE PRIORITIZATION SCORE ---
            score = 0
            if requested_tokens:
                # Check various reliable columns (leisure, tourism, name) for a match.
                text_fields = []
                # Use existing OSM tags as the search target (since 'category' might be null/missing)
                for f in ('leisure', 'tourism', 'historic', 'name', 'category', 'tags'):
                    v = r.get(f)
                    if isinstance(v, str):
                        text_fields.append(v.lower())
                combined = ' '.join(text_fields)
                
                # Assign score=1 if ANY requested category token is found in the combined text.
                for token in requested_tokens:
                    if token in combined:
                        score = 1
                        break
            
            # Ensure the UI badge has a label: use existing category or mock as Uncategorized
            if not r.get('category'):
                 # Ensure the UI badge renders correctly even if the category column is empty/null
                 r['category'] = 'Uncategorized' 
                 
            # candidate tuple: (score, t, dist_km, row)
            candidates.append((score, t, dist_km, r))

    # sort candidates by category match (desc) then by t (asc)
    # This implements the user request: prioritize selected categories (score) then spread along the route (t).
    candidates.sort(key=lambda x: (-x[0], x[1])) 

    # dedupe by id while preserving route order
    # FIX: Corrected index from c[2] (dist_km) to c[3] (the row dictionary)
    rows_ordered = [c[3] for c in candidates] 
    rows_ordered = _dedupe_rows_by_id(rows_ordered)

    limit_n = int(req.limit or 10)
    if limit_n <= 0:
        return {"count": 0, "rows": [], "start": a_coord, "end": b_coord}

    # rebuild candidates list after dedupe to keep t values aligned
    id_to_candidate = {c[3].get('id'): (c[0], c[1], c[2], c[3]) for c in candidates}
    deduped_candidates = []
    for r in rows_ordered:
        cid = r.get('id')
        cand = id_to_candidate.get(cid)
        if cand:
            # store (score, t, dist, row)
            deduped_candidates.append(cand)

    # If fewer candidates than requested limit, return all (ordered by route position)
    if len(deduped_candidates) <= limit_n:
        selected_rows = [c[3] for c in deduped_candidates]
        uniq = []
        seen_c = set()
        for r in selected_rows:
            cat = r.get('category')
            if isinstance(cat, str) and cat and cat not in seen_c:
                seen_c.add(cat)
                uniq.append(cat)
        return {"count": len(selected_rows), "rows": selected_rows, "start": a_coord, "end": b_coord, "unique_categories": uniq}

    # Choose up to limit_n attractions spread along the route.
    # For each target fraction, pick the remaining candidate closest in t.
    remaining = deduped_candidates.copy()
    selected = []
    for i in range(limit_n):
        if limit_n == 1:
            target_t = 0.5
        else:
            target_t = i / (limit_n - 1)
        best_idx = None
        best_delta = float('inf')
        
        for idx, cand in enumerate(remaining):
            # cand is (score, t, dist, row)
            t_val = cand[1]
            d = abs(t_val - target_t)
            
            # --- Advanced selection logic: Prioritize match score first ---
            match_score = cand[0]
            current_best_score = remaining[best_idx][0] if best_idx is not None else -1
            
            # Rule: If current score is better OR (score is equal AND distance to target t is better)
            if best_idx is None or (match_score > current_best_score) or (match_score == current_best_score and d < best_delta):
                best_delta = d
                best_idx = idx

        if best_idx is None:
            break
        selected.append(remaining.pop(best_idx))

    # sort selected by t value (index 1) so returned rows follow the route order
    selected.sort(key=lambda x: x[1])
    selected_rows = [c[3] for c in selected]
    uniq = []
    seen_c = set()
    for r in selected_rows:
        cat = r.get('category')
        if isinstance(cat, str) and cat and cat not in seen_c:
            seen_c.add(cat)
            uniq.append(cat)
    return {"count": len(selected_rows), "rows": selected_rows, "start": a_coord, "end": b_coord, "unique_categories": uniq}
