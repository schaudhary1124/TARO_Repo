import React, {useEffect, useState} from 'react'
import { listAttractions, optimize, searchBetween } from './api'
import CreatableSelect from 'react-select/creatable'
import Map from './Map'
import './styles.css'

// Custom component for the theme switch
function ThemeSlider({ currentTheme, toggleTheme }){
  const isDark = currentTheme === 'dark'
  return (
    <div className="theme-slider-container">
      <span className="theme-label">Light ☀️</span>
      <label className="switch" title={`Switch to ${isDark ? 'Light' : 'Dark'} Mode`}>
        <input type="checkbox" checked={isDark} onChange={toggleTheme} />
        <span className="slider round"></span>
      </label>
      <span className="theme-label">🌙 Dark</span>
    </div>
  )
}

// Function to handle reading/setting the theme on the document element
const setDocumentTheme = (theme) => {
    document.documentElement.className = `theme-${theme}`
}

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
  
  
  // Initialize theme state and apply to document element
  const [theme, setTheme] = useState('light')

  useEffect(() => {
    // Apply the theme class whenever the theme state changes
    setDocumentTheme(theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(current => current === 'light' ? 'dark' : 'light')
  }

  // NEW: Custom styles function for react-select, using theme state
  const customStyles = {
    // Control (the input box)
    control: (provided, state) => ({
      ...provided,
      backgroundColor: theme === 'dark' ? 'var(--card-bg)' : 'white',
      borderColor: theme === 'dark' ? 'var(--border-color)' : 'var(--border-color)',
      boxShadow: 'none',
      color: theme === 'dark' ? 'var(--text-primary)' : 'var(--text-primary)',
      '&:hover': {
        borderColor: theme === 'dark' ? 'var(--accent)' : 'var(--accent)',
      }
    }),
    // Input text color
    input: (provided) => ({
        ...provided,
        color: theme === 'dark' ? 'var(--text-primary)' : 'var(--text-primary)',
    }),
    // Menu (the dropdown container)
    menu: (provided) => ({
      ...provided,
      backgroundColor: theme === 'dark' ? 'var(--card-bg)' : 'white', 
      // CORRECTED LINE: Fixed template literal syntax
      border: `1px solid ${theme === 'dark' ? 'var(--border-color)' : 'var(--border-color)'}`,
    }),
    // Option (each item in the dropdown)
    option: (provided, state) => ({
      ...provided,
      backgroundColor: state.isFocused
        ? (theme === 'dark' ? 'var(--accent)' : '#deebff') // Focused/Hovered color
        : (theme === 'dark' ? 'var(--card-bg)' : 'white'), // Default color
      color: state.isFocused
        ? 'white'
        : (theme === 'dark' ? 'var(--text-primary)' : 'var(--text-primary)'), // Default text color
      '&:active': {
        backgroundColor: theme === 'dark' ? 'var(--accent)' : '#b3d4ff',
      },
    }),
    // Placeholder text
    placeholder: (provided) => ({
        ...provided,
        color: theme === 'dark' ? 'var(--muted)' : 'var(--muted)',
    }),
    // Multi-value container (the badges once selected)
    multiValue: (provided) => ({
        ...provided,
        backgroundColor: theme === 'dark' ? 'var(--border-color)' : '#e6e6e6',
    }),
    // Multi-value label (text within the badge)
    multiValueLabel: (provided) => ({
        ...provided,
        color: theme === 'dark' ? 'var(--text-primary)' : 'var(--text-primary)',
    }),
  };


  const generateGoogleMapsUrl = (routeResult) => {
  if (!routeResult || !routeResult.orderedAttractions) return null;

  const orderedStops = routeResult.orderedAttractions
    .map(a => a.lat && a.lon ? `${a.lat},${a.lon}` : null)
    .filter(Boolean);

  if (orderedStops.length < 2) return null;

  const origin = orderedStops[0];
  const destination = orderedStops[orderedStops.length - 1];
  const waypoints = orderedStops.slice(1, -1).join('|');

  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('travelmode', 'driving');
  url.searchParams.set('origin', origin);
  url.searchParams.set('destination', destination);
  if (waypoints) url.searchParams.set('waypoints', waypoints);

  return url.toString();
};


  
  // NEW: Component to render the Google Maps link
  const RouteLink = ({ routeResult }) => {
    const mapsUrl = generateGoogleMapsUrl(routeResult);
    if (!mapsUrl) return null;

    return (
      <p style={{ marginTop: '16px' }}>
        <a 
          href={mapsUrl} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="btn primary" 
          style={{ textDecoration: 'none' }}
        >
          Open Route in Google Maps 🗺️
        </a>
      </p>
    );
  };

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
      // Clear optResult so we can wait for the Map component to call onRouteRendered
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
      const uniqueCats = res.unique_categories || []
      const options = uniqueCats.sort().map(c=>({ value: c, label: c }))
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

  function handleSelectAll(){
    setSelectedIds(attractions.map(a=>a.id))
  }

  function handleDeselectAll(){
    setSelectedIds([])
  }
  
  // NEW: Update onRouteRendered to capture the ordered route from the Map component
  function handleRouteRendered(route) {
      setRouteRequest(null);
      if (route) {
          // Assuming the route object contains the ordered list of attractions
          setOptResult({
              orderedAttractions: route.orderedAttractions,
              // Add other relevant route info here if available from the Map component
          });
      }
  }

  return (
    <div className="app-root">
      <header className="app-header">
        TARO — Route Optimizer
        <ThemeSlider currentTheme={theme} toggleTheme={toggleTheme} />
      </header>

      <main className="app-main">
        <div className="card">
          <div className="search-row">
            <div className="inputs">
  {/* Start address with location autofill */}
  <div className="input-with-icon" style={{ position: 'relative' }}>
    <input
      className="input"
      placeholder="Start address"
      value={start}
      onChange={e => setStart(e.target.value)}
    />
    <button
      type="button"
      title="Use current location"
      onClick={() => {
        if (!navigator.geolocation) {
          alert("Geolocation is not supported by your browser.");
          return;
        }

        navigator.geolocation.getCurrentPosition(
          async (position) => {
            const { latitude, longitude } = position.coords;
            try {
              const res = await fetch(
                `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`
              );
              const data = await res.json();
              const address = data.display_name || `${latitude}, ${longitude}`;
              setStart(address);
            } catch {
              setStart(`${latitude}, ${longitude}`);
            }
          },
          (error) => {
            console.error(error);
            alert("Unable to retrieve your location.");
          }
        );
      }}
      style={{
        position: 'absolute',
        right: '6px',
        top: '50%',
        transform: 'translateY(-50%)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--text-secondary)',
        fontSize: '1.1em'
      }}
    >
      📍
    </button>
  </div>

  {/* Rest of your inputs stay the same */}
  <input
    className="input"
    placeholder="End address"
    value={end}
    onChange={e => setEnd(e.target.value)}
  />
  <input
    className="input small"
    placeholder="radius km"
    value={radiusKm}
    onChange={e => setRadiusKm(e.target.value)}
  />
  <input
    className="input small"
    placeholder="limit"
    value={limit}
    onChange={e => setLimit(e.target.value)}
  />
  <button
    className="btn primary"
    type="button"
    onClick={handleSearchBetween}
    disabled={isSearchDisabled}
  >
    Search between
  </button>
</div>

            <div className="category-box">
              <CreatableSelect
                isMulti
                styles={customStyles} // Apply the theme-aware styles here
                options={categoryOptions}
                value={categoryOptions.filter(o=>selectedCategories.includes(o.value))}
                onChange={(vals)=>{
                  const valsArr = Array.isArray(vals) ? vals.map(v=>v.value) : []
                  setSelectedCategories(valsArr)
                }}
                placeholder={categoryOptions.length ? 'Filter or create categories...' : 'No categories available'}
                isDisabled={isSearchDisabled}
              />
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
                onRouteRendered={handleRouteRendered} // Use the new handler
              />
            </section>
          </div>

          {optResult && (
            <div className="opt-result">
              <h2>Optimized Route Result</h2>
              {/* NEW: Render the Google Maps Link */}
              <RouteLink routeResult={optResult} /> 
              <pre className="opt-pre">{JSON.stringify(optResult, null, 2)}</pre>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}