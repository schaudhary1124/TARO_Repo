const API_ROOT = import.meta.env.VITE_API_BASE || ''

export async function getAllCategories(){
  const res = await fetch(`${API_ROOT}/api/all_categories`)
  if(!res.ok) throw new Error('Failed to list categories')
  const j = await res.json()
  if(j && j.status === 'ok' && j.result){
    return j.result
  }
  return j
}

// --- NEW: Function to get full details for one attraction ---
export async function getAttractionDetails(attractionId){
  if (!attractionId) throw new Error('No attraction ID provided');
  
  const res = await fetch(`${API_ROOT}/api/attraction/${attractionId}`)
  if(!res.ok) {
    const errorBody = await res.json();
    throw new Error(errorBody.detail || 'Failed to fetch attraction details');
  }
  const j = await res.json()
  if(j && j.status === 'ok' && j.result){
    return j.result
  }
  return j
}
// --- END NEW FUNCTION ---

export async function listAttractions(limit=10){
  const res = await fetch(`${API_ROOT}/api/attractions?limit=${limit}`)
  if(!res.ok) throw new Error('Failed to list')
  const j = await res.json()
  if(j && j.status === 'ok' && j.result){
    return j.result
  }
  return j
}

export async function optimize(payload){
  const res = await fetch(`${API_ROOT}/api/optimize`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  })
  if(!res.ok) throw new Error('Optimize failed')
  const j = await res.json()
  if(j && j.status === 'ok' && j.result){
    return j.result
  }
  return j
}

export async function searchBetween(payload){
  const res = await fetch(`${API_ROOT}/api/search_between`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  })
  if(!res.ok) throw new Error('Search failed')
  const j = await res.json()
  if(j && j.status === 'ok' && j.result){
    return j.result
  }
  return j
}

export function getClientGoogleKey(){
  return import.meta.env.VITE_GOOGLE_MAPS_KEY || ''
}