// frontend/src/api.js
const API_ROOT = import.meta.env.VITE_API_BASE || '';

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// -------- Auth --------
export async function register(email, password) {
  const res = await fetch(`${API_ROOT}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) throw new Error((await res.json()).detail || 'Register failed');
  return res.json();
}

export async function login(email, password) {
  const res = await fetch(`${API_ROOT}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) throw new Error((await res.json()).detail || 'Login failed');
  return res.json();
}

export async function me(token) {
  const res = await fetch(`${API_ROOT}/api/auth/me`, {
    headers: { ...authHeaders(token) }
  });
  if (!res.ok) throw new Error('Auth check failed');
  return res.json();
}

// -------- Categories & Attractions --------
export async function getAllCategories() {
  const res = await fetch(`${API_ROOT}/api/all_categories`);
  if (!res.ok) throw new Error('Failed to list categories');
  const j = await res.json();
  return (j && j.status === 'ok' && j.result) ? j.result : j;
}

export async function listAttractions(limit = 10) {
  const res = await fetch(`${API_ROOT}/api/attractions?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to list');
  const j = await res.json();
  return (j && j.status === 'ok' && j.result) ? j.result : j;
}

// NEW path uses enriched details endpoint
// ✅ accepts (osmType, osmId) — matches App.jsx call & backend path
export async function getAttractionDetails(osmType, osmId) {
  if (!osmType || !osmId) throw new Error('Invalid attraction id');
  const res = await fetch(`${API_ROOT}/api/attractions/${osmType}/${osmId}/details`);
  if (!res.ok) {
    let err;
    try { err = await res.json(); } catch {}
    throw new Error((err && err.detail) || 'Failed to fetch details');
  }
  return res.json();
}



// NEW: ratings now require auth and only send { rating }
// ✅ accepts (token, attractionId, rating) — matches App.jsx call
export async function submitRating(token, attractionId, rating) {
  console.log('Debug → submitRating token:', token); // ✅ add this line
  if (!token) throw new Error('Login required');
  if (!attractionId) throw new Error('No attraction ID provided');

  const res = await fetch(`${API_ROOT}/api/attraction/${attractionId}/rate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // ✅ send bearer token so FastAPI sees you as authenticated
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ rating }),
  });

  if (!res.ok) {
    let err;
    try { err = await res.json(); } catch {}
    throw new Error((err && err.detail) || 'Rating failed');
  }

  return res.json(); // { attraction_id, user_rating, rating_count, average_rating }
}

export async function deleteRating(token, attractionId) {
  if (!token) throw new Error('Login required');
  if (!attractionId) throw new Error('No attraction ID provided');

  const res = await fetch(`${API_ROOT}/api/attraction/${attractionId}/rate`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    let err;
    try { err = await res.json(); } catch {}
    throw new Error((err && err.detail) || 'Delete rating failed');
  }

  return res.json(); // { attraction_id, deleted, rating_count, average_rating }
}


// -------- Route tools --------
export async function optimize(payload) {
  const res = await fetch(`${API_ROOT}/api/optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Optimize failed');
  const j = await res.json();
  return (j && j.status === 'ok' && j.result) ? j.result : j;
}

export async function searchBetween(payload) {
  const res = await fetch(`${API_ROOT}/api/search_between`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Search failed');
  const j = await res.json();
  return (j && j.status === 'ok' && j.result) ? j.result : j;
}

// -------- Trips --------
export async function listTrips(token) {
  const res = await fetch(`${API_ROOT}/api/trips`, { headers: { ...authHeaders(token) } });
  if (!res.ok) throw new Error('List trips failed');
  return res.json();
}

export async function createTrip(token, trip) {
  const res = await fetch(`${API_ROOT}/api/trips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(trip)
  });
  if (!res.ok) throw new Error('Create trip failed');
  return res.json();
}

export async function getTrip(token, tripId) {
  const res = await fetch(`${API_ROOT}/api/trips/${tripId}`, { headers: { ...authHeaders(token) } });
  if (!res.ok) throw new Error('Get trip failed');
  return res.json();
}

export async function deleteTrip(token, tripId) {
  const res = await fetch(`${API_ROOT}/api/trips/${tripId}`, {
    method: 'DELETE',
    headers: { ...authHeaders(token) }
  });
  if (!res.ok) throw new Error('Delete trip failed');
  return res.json();
}

// -------- Issues --------
export async function reportIssue(token, subject, payload) {
  const res = await fetch(`${API_ROOT}/api/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ subject, payload })
  });
  if (!res.ok) throw new Error('Issue submit failed');
  return res.json();
}

// -------- Client key --------
export function getClientGoogleKey() {
  return import.meta.env.VITE_GOOGLE_MAPS_KEY || '';
}
