from fastapi import APIRouter, HTTPException
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
    """Geocode an address to (lat, lon)."""
    api_key = os.getenv('GOOGLE_MAPS_API_KEY')
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
            out.append(r)
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
    """Helper to connect to the SQLite DB."""
    db_file = os.getenv('SQLITE_FILE', 'data.sqlite')
    p = Path(db_file)
    if not p.exists():
        repo_root = Path(__file__).resolve().parents[2]
        p = repo_root / db_file
    if not p.exists():
        raise HTTPException(status_code=500, detail=f"SQLite file not found: {db_file}")
    
    conn = sqlite3.connect(str(p))
    conn.row_factory = sqlite3.Row
    return conn

def _get_best_category(row: dict) -> Optional[str]:
    """Extracts a single, most descriptive category from a data row."""
    if isinstance(row.get('category'), str) and row['category']:
        return row['category']
        
    osm_tags = ('leisure', 'tourism', 'historic', 'amenity', 'shop', 'sport')
    for tag in osm_tags:
        value = row.get(tag)
        if isinstance(value, str) and value:
            return value.replace('_', ' ').title()
            
    return 'General Attraction'


@router.get("/attractions")
async def get_attractions(limit: int = 10):
    """Return up to `limit` attractions from the local SQLite file (table `attractions`)."""
    conn = _get_db_conn()
    try:
        cur = conn.execute("SELECT * FROM attractions")
        rows = [dict(r) for r in cur.fetchall()]
        rows = _dedupe_rows_by_id(rows)
        rows = rows[:limit]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

    return {"count": len(rows), "rows": rows}


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
    conn = _get_db_conn()
    try:
        cur = conn.execute("SELECT leisure, tourism, historic, amenity, shop, sport FROM attractions")
        rows = cur.fetchall()
        counts = {}
        for row in rows:
            cat = _get_best_category(row)
            if cat:
                counts[cat] = counts.get(cat, 0) + 1
        
        top_sorted = sorted(counts.items(), key=lambda item: item[1], reverse=True)
        top = top_sorted[:limit]
        
        return {"top_categories": top, "samples": "Sampling disabled in this debug endpoint"}
    finally:
        conn.close()


@router.get("/all_categories")
def get_all_categories():
    """
    Scans the entire attractions database and returns a sorted list of all
    unique categories based on OSM tags.
    """
    conn = _get_db_conn()
    all_categories = set()
    try:
        cur = conn.execute("SELECT category, leisure, tourism, historic, amenity, shop, sport FROM attractions")
        rows = cur.fetchall()
        for row in rows:
            best_cat = _get_best_category(dict(row))
            if best_cat:
                all_categories.add(best_cat)
                
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()
        
    return sorted(list(all_categories))

# --- MODIFIED: Added :path to handle '/' in item_id ---
@router.get("/attraction/{item_id:path}")
def get_attraction_details(item_id: str):
    """
    Fetches all data for a single attraction by its ID.
    """
    conn = _get_db_conn()
    try:
        # --- MODIFIED: Removed osm_id and @id from query ---
        query = 'SELECT * FROM attractions WHERE id = ? LIMIT 1'
        cur = conn.execute(query, (item_id,))
        # --- END MODIFICATION ---
        
        row = cur.fetchone()
        
        if row is None:
            raise HTTPException(status_code=404, detail="Attraction not found")
            
        return dict(row)
        
    except Exception as e:
        logging.getLogger('app.api.router').exception(f'Error fetching details for {item_id}')
        if not isinstance(e, HTTPException):
             raise HTTPException(status_code=500, detail=str(e))
        raise e
    finally:
        conn.close()


class OptimizeRequest(BaseModel):
    attraction_ids: List[str]
    departure: Optional[List[float]] = None  # [lat, lon]
    arrival: Optional[List[float]] = None


@router.post("/optimize")
def optimize_route(req: OptimizeRequest):
    """Given a list of attraction ids, lookup coordinates and call Google Directions API with optimize:true."""
    api_key = os.getenv('GOOGLE_MAPS_API_KEY')
    conn = _get_db_conn()
    
    id_to_attraction = {}
    try:
        # --- MODIFIED: Removed osm_id and @id from query ---
        placeholders = ','.join('?' for _ in req.attraction_ids)
        q = f"SELECT * FROM attractions WHERE id IN ({placeholders})"
        cur = conn.execute(q, tuple(req.attraction_ids))
        # --- END MODIFICATION ---
        
        rows = [dict(r) for r in cur.fetchall()]
        
        for r in rows:
            a = Attraction.from_row(r)
            if a.id:
                 id_to_attraction[a.id] = a
            
    finally:
        conn.close()

    # Re-order attractions based on the user's requested ID list
    attractions = []
    for user_id in req.attraction_ids:
        if user_id in id_to_attraction:
            attractions.append(id_to_attraction[user_id])

    if not attractions:
        raise HTTPException(status_code=404, detail="No attractions found for provided ids")

    seen_coords = set()
    coords = []
    coord_to_attraction_map = {} # Map 'lat,lon' string to attraction object
    
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

    # Local TSP fallback
    if len(waypoint_strs) > MAX_WAYPOINTS:
        start_t = time.time()
        order = local_greedy_tsp(coords)
        order = two_opt(order, coords, max_iters=2000) # Increased iters
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

    # --- Google Directions API ---
    origin_str = f"{req.departure[0]},{req.departure[1]}" if req.departure else waypoint_strs[0]
    destination_str = f"{req.arrival[0]},{req.arrival[1]}" if req.arrival else waypoint_strs[-1]
    
    intermediate_strs = []
    if len(waypoint_strs) > 0:
        intermediate_strs = waypoint_strs
        if req.departure: # Use all attractions as waypoints
            pass 
        else: # First attraction is origin
            intermediate_strs = intermediate_strs[1:]
        
        if req.arrival: # All attractions are waypoints
            pass
        else: # Last attraction is destination
            intermediate_strs = intermediate_strs[:-1]

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

    # Make the request to Google
    try:
        resp = requests.get(prepared['url'], params=params, timeout=15)
        resp.raise_for_status()
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=str(e))

    res_json = resp.json()

    # --- ADD orderedAttractions to the response ---
    if res_json.get('routes') and res_json['routes'][0].get('waypoint_order'):
        waypoint_order = res_json['routes'][0]['waypoint_order'] # Indices of intermediate_strs
        
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
    trashed_ids: Optional[List[str]] = Field(default_factory=list) # For Trash feature


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
        # --- MODIFIED: Removed osm_id and @id from filter ---
        rows = [r for r in rows if r.get('id') not in trashed_set]
        # --- END MODIFICATION ---

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

            score = 0
            if requested_tokens:
                name_part = r.get('name', '') or ''
                cat_part = best_cat or ''
                combined_text = name_part.lower() + ' ' + cat_part.lower()
                
                if not requested_tokens:
                    score = 1
                else:
                    for token in requested_tokens:
                        if token == cat_part.lower(): # Exact category match
                            score = 1
                            break
            else:
                 score = 1 # Always score 1 if no categories are selected
            
            if score > 0:
                candidates.append((score, t, dist_km, r))

    candidates.sort(key=lambda x: x[1]) 

    rows_ordered = [c[3] for c in candidates] 
    rows_ordered = _dedupe_rows_by_id(rows_ordered)

    limit_n = int(req.limit or 10)
    if limit_n <= 0:
        return {"count": 0, "rows": [], "start": a_coord, "end": b_coord}

    selected_rows = rows_ordered[:limit_n]
    
    return {"count": len(selected_rows), "rows": selected_rows, "start": a_coord, "end": b_coord}