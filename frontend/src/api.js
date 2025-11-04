const API_ROOT = import.meta.env.VITE_API_BASE || ''

export async function listAttractions(limit=10){
  const res = await fetch(`${API_ROOT}/api/attractions?limit=${limit}`)
  if(!res.ok) throw new Error('Failed to list')
  const j = await res.json()
  // normalized envelope {status, result} may be present depending on server middleware
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
