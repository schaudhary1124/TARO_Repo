import React, {useEffect, useState} from 'react'
import { listAttractions, optimize, searchBetween } from './api'
import CreatableSelect from 'react-select/creatable'
import Map from './Map'
import './styles.css'

export default function App(){
  const [attractions, setAttractions] = useState([])
  const [loading, setLoading] = useState(false)
  const [optResult, setOptResult] = useState(null)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [radiusKm, setRadiusKm] = useState('5')
  const [limit, setLimit] = useState('10')
  const [selectedIds, setSelectedIds] = useState([])
  const [routeRequest, setRouteRequest] = useState(null)
  const [searchPerformed, setSearchPerformed] = useState(false)
  const [categoryOptions, setCategoryOptions] = useState([])
  const [selectedCategories, setSelectedCategories] = useState([])

  // disable search and category selection until required inputs are valid
  const isSearchDisabled = (() => {
    if (!start || !start.trim()) return true
    if (!end || !end.trim()) return true
    const r = Number(radiusKm)
    if (!Number.isFinite(r) || r <= 0) return true
    const l = Number(limit)
    if (!Number.isFinite(l) || l <= 0) return true
    return false
  })()

  useEffect(()=>{
  setLoading(true)
  listAttractions(20).then(r=>{
      // dedupe any duplicated rows by id
      const rows = r.rows || []
      const seen = new Set()
      const deduped = []
      rows.forEach(x=>{
        if(!seen.has(x.id)){
          seen.add(x.id)
          deduped.push(x)
        }
      })
      setAttractions(deduped)
    }).catch(console.error).finally(()=>setLoading(false))
  },[])

  // Category options are populated from search results; no initial fetch.

  async function handleOptimize(){
    const ids = selectedIds.length ? selectedIds : attractions.slice(0,10).map(a=>a.id)
    const payload = { attraction_ids: ids, departure: start ? undefined : undefined }
    // If we have a client-side Google Maps key we will request the route client-side.
    const clientKey = import.meta.env.VITE_GOOGLE_MAPS_KEY
    if (clientKey) {
      // instruct Map to compute route using start/end and selected attractions
      setRouteRequest({ start, end, ids })
      setOptResult(null)
      return
    }
    const res = await optimize(payload)
    setOptResult(res)
  }
  // run a search using current start/end/radius/limit and provided categories (array of strings)
  async function runSearchBetween(categoriesArray){
    try{
      setLoading(true)
      const payload = { start, end, radius_km: Number(radiusKm || 5), limit: Number(limit || 10), categories: categoriesArray }
      const res = await searchBetween(payload)
      // ensure deduplicated results
      const rows = res.rows || []
      const seen = new Set()
      const deduped = []
      rows.forEach(x=>{
        if(!seen.has(x.id)){
          seen.add(x.id)
          deduped.push(x)
        }
      })
      setAttractions(deduped)
      // derive unique categories from the returned attractions and populate the select
      const cats = new Set()
      deduped.forEach(a=>{
        const c = a.category || a.cat || null
        if(c && typeof c === 'string') cats.add(c)
      })
      const options = Array.from(cats).sort().map(c=>({ value: c, label: c }))
      setCategoryOptions(options)
      // mark that a user-initiated search completed so UI can show search-specific controls
      setSearchPerformed(true)
    }catch(err){
      console.error(err)
      alert('Search failed: ' + (err.message || err))
    }finally{
      setLoading(false)
    }
  }

  async function handleSearchBetween(e){
    if (e && e.preventDefault) e.preventDefault()
    await runSearchBetween(selectedCategories)
  }

  // Toggle a category badge and optionally re-run the last search to update results immediately
  async function handleToggleCategoryBadge(catValue){
    const exists = selectedCategories.includes(catValue)
    const newSelection = exists ? selectedCategories.filter(c=>c!==catValue) : [...selectedCategories, catValue]
    setSelectedCategories(newSelection)
    if (searchPerformed){
      await runSearchBetween(newSelection)
    }
  }

  function handleSelectAll(){
    setSelectedIds(attractions.map(a=>a.id))
  }

  function handleDeselectAll(){
    setSelectedIds([])
  }

  return (
    <div className="app-root">
      <header className="app-header">TARO — Route Optimizer</header>

      <main className="app-main">
        <div className="card">
          <div className="search-row">
            <div className="inputs">
              <input className="input" placeholder="Start address" value={start} onChange={e=>setStart(e.target.value)} />
              <input className="input" placeholder="End address" value={end} onChange={e=>setEnd(e.target.value)} />
              <input className="input small" placeholder="radius km" value={radiusKm} onChange={e=>setRadiusKm(e.target.value)} />
              <input className="input small" placeholder="limit" value={limit} onChange={e=>setLimit(e.target.value)} />
              <button className="btn primary" type="button" onClick={handleSearchBetween} disabled={isSearchDisabled}>Search between</button>
            </div>
            <div className="category-box">
              <CreatableSelect
                isMulti
                options={categoryOptions}
                value={categoryOptions.filter(o=>selectedCategories.includes(o.value))}
                onChange={(vals)=>{
                  const valsArr = Array.isArray(vals) ? vals.map(v=>v.value) : []
                  setSelectedCategories(valsArr)
                }}
                placeholder={categoryOptions.length ? 'Filter or create categories...' : 'No categories available'}
                isDisabled={isSearchDisabled}
              />
              <div className="category-badges">
                <div className="cat-header">Categories ({categoryOptions.length})</div>
                {categoryOptions.length === 0 ? (
                  <div className="no-cats">No categories yet — run a search to populate categories.</div>
                ) : (
                  categoryOptions.map(c => {
                    const active = selectedCategories.includes(c.value)
                    const className = `cat-badge small ${active ? 'active' : ''}`
                    return (
                      <button key={c.value} className={className} style={{ marginLeft: 6 }} onClick={()=>handleToggleCategoryBadge(c.value)}>{c.label}</button>
                    )
                  })
                )}
              </div>
            </div>
          </div>

          <div className="controls">
            <div className="button-group">
              <button className="btn" onClick={handleSelectAll}>Select all</button>
              <button className="btn" onClick={handleDeselectAll}>Deselect all</button>
              <button className="btn primary" onClick={handleOptimize} disabled={attractions.length===0}>Optimize</button>
            </div>
          </div>

          <div className="split">
            <aside className="sidebar">
              {loading && <p>Loading...</p>}
              {!loading && (
                <div className="attraction-list-container">
                  <ul className="attraction-list">
                    {attractions.map(a=> {
                      const category = a.category || a.cat || null
                      // simple color map
                      const colorFor = (cat) => {
                        if(!cat) return '#6b7280'
                        const c = cat.toLowerCase()
                        if(c.includes('park')) return '#10b981' // green
                        if(c.includes('museum')) return '#3b82f6' // blue
                        if(c.includes('amuse') || c.includes('ride')) return '#ef4444' // red
                        if(c.includes('histor')) return '#f59e0b' // amber
                        return '#6b7280' // muted
                      }
                      const badgeStyle = { backgroundColor: colorFor(category) }
                      return (
                        <li key={a.id} className="attraction-item">
                          <label>
                            <input type="checkbox" checked={selectedIds.includes(a.id)} onChange={e=>{
                              if (e.target.checked) setSelectedIds(s=>Array.from(new Set([...s, a.id])))
                              else setSelectedIds(s=>s.filter(x=>x!==a.id))
                            }} />
                            <span className="attraction-title">{a.name || a.title || a.id}</span>
                            <span className="cat-badge" style={badgeStyle}>{category || 'Uncategorized'}</span>
                          </label>
                          {a.website_url && (
                            <a className="external-link" href={a.website_url} target="_blank" rel="noopener noreferrer">🔗</a>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </aside>

            <section className="map-area">
              <Map
                attractions={attractions}
                selectedIds={selectedIds}
                start={start}
                end={end}
                routeRequest={routeRequest}
                onRouteRendered={() => setRouteRequest(null)}
              />
            </section>
          </div>

          {optResult && (
            <div className="opt-result">
              <h2>Optimize Result</h2>
              <pre className="opt-pre">{JSON.stringify(optResult, null, 2)}</pre>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
