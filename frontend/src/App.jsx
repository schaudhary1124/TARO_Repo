import React, {useEffect, useState, useMemo} from 'react'
import { listAttractions, optimize, searchBetween, getAllCategories, getAttractionDetails } from './api'
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

// --- NEW: Attraction Details Modal Component ---
function AttractionModal({ attraction, onClose }) {
  if (!attraction) return null;

  // Extract useful data.
  const { name, wikipedia, website, tourism, historic, leisure, amenity, opening_hours } = attraction;
  
  // --- **** THIS IS THE FIX **** ---
  // Added the missing '$' to correctly interpolate the variable
  // --- FIXED VERSION ---
const wikiLink = wikipedia
  ? `https://${
      wikipedia.includes(':')
        ? wikipedia.split(':')[0] // "en" part before ":"
        : 'en'
    }.wikipedia.org/wiki/${
      wikipedia.includes(':')
        ? wikipedia.split(':')[1]
        : wikipedia
    }`
  : null;

  // --- **** END FIX **** ---
  
  // Use 'website' or the OSM 'website_url' tag
  const websiteLink = attraction.website_url || website;
  
  // Defensively handle non-string tags to prevent runtime crash
  const tags = [tourism, historic, leisure, amenity]
    .filter(Boolean) // Filter out null/undefined
    .map(String)     // Convert all values (e.g., numbers, etc.) to strings
    .map(tag => tag.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())); // Safely replace/capitalize

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose}>×</button>
        <h2>{name || "Details"}</h2>
        
        <div className="modal-details">
          {tags.length > 0 && (
            <p><strong>Tags:</strong> {tags.join(', ')}</p>
          )}
          {opening_hours && (
            <p><strong>Hours:</strong> {opening_hours}</p>
          )}
          
          <div className="modal-links">
            {websiteLink && (
              <a href={websiteLink} target="_blank" rel="noopener noreferrer" className="btn">
                Visit Website 🌐
              </a>
            )}
            {wikiLink && (
              <a href={wikiLink} target="_blank" rel="noopener noreferrer" className="btn">
                Read Wikipedia 📖
              </a>
            )}
          </div>
        </div>
        
      </div>
    </div>
  );
}
// --- END NEW MODAL ---


// Function to handle reading/setting the theme on the document element
const setDocumentTheme = (theme) => {
    document.documentElement.className = `theme-${theme}`
}

export default function App(){
  const [allAttractions, setAllAttractions] = useState([]) // Holds all results
  const [visibleAttractions, setVisibleAttractions] = useState([]) // Holds filtered/locked results
  const [loading, setLoading] = useState(false)
  const [optResult, setOptResult] = useState(null)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [radiusKm, setRadiusKm] = useState('5')
  const [limit, setLimit] = useState('10')
  const [selectedIds, setSelectedIds] = useState(new Set()) // Use a Set for easier logic
  const [routeRequest, setRouteRequest] = useState(null)
  const [categoryOptions, setCategoryOptions] = useState([])
  const [selectedCategories, setSelectedCategories] = useState([])
  
  const [lockedIds, setLockedIds] = useState(new Set())
  const [trashedIds, setTrashedIds] = useState(new Set())
  
  // --- NEW: State for Modal ---
  const [modalData, setModalData] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  // --- END NEW STATE ---
  
  const [theme, setTheme] = useState('light')

  useEffect(() => {
    setDocumentTheme(theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(current => current === 'light' ? 'dark' : 'light')
  }

  // Custom styles for react-select, using theme state
  const customStyles = {
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
    input: (provided) => ({
        ...provided,
        color: theme === 'dark' ? 'var(--text-primary)' : 'var(--text-primary)',
    }),
    menu: (provided) => ({
      ...provided,
      backgroundColor: theme === 'dark' ? 'var(--card-bg)' : 'white', 
      border: `1px solid ${theme === 'dark' ? 'var(--border-color)' : 'var(--border-color)'}`
    }), 
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
    placeholder: (provided) => ({
        ...provided,
        color: theme === 'dark' ? 'var(--muted)' : 'var(--muted)',
    }),
    multiValue: (provided) => ({
        ...provided,
        backgroundColor: theme === 'dark' ? 'var(--border-color)' : '#e6e6e6',
    }),
    multiValueLabel: (provided) => ({
        ...provided,
        color: theme === 'dark' ? 'var(--text-primary)' : 'var(--text-primary)',
    }),
  };

  const generateGoogleMapsUrl = (routeResult) => {
    if (!routeResult || !routeResult.orderedAttractions) return null;

    const orderedStops = routeResult.orderedAttractions
      .map(a => {
        if (a && a.lat !== undefined && a.lon !== undefined) {
          const lat = Number(a.lat);
          const lon = Number(a.lon);
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            return `${lat},${lon}`;
          }
        }
        const name = a && (a.name || a.title);
        return name ? encodeURIComponent(name) : null;
      })
      .filter(Boolean);

    if (orderedStops.length < 2) return null;

    const origin = orderedStops[0];
    const destination = orderedStops[orderedStops.length - 1];
    const waypointsArr = orderedStops.slice(1, -1);

    const url = new URL('http://maps.google.com/mapfiles/ms/icons/blue-dot.png3');
    url.searchParams.set('api', '1');
    url.searchParams.set('travelmode', 'driving');
    url.searchParams.set('origin', origin);
    url.searchParams.set('destination', destination);
    if (waypointsArr.length > 0) {
      url.searchParams.set('waypoints', waypointsArr.join('|'));
    }

    return url.toString();
  };
  
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
    setLoading(true);
    getAllCategories().then(cats => {
      const options = cats.map(c => ({ value: c, label: c }));
      setCategoryOptions(options);
    }).catch(console.error);

    listAttractions(20).then(r=>{
      const rows = r.rows || []
      const seen = new Set()
      const deduped = []
      rows.forEach(x=>{
        if(!seen.has(x.id)){
          seen.add(x.id)
          deduped.push(x)
        }
      })
      setAllAttractions(deduped);
    }).catch(console.error).finally(()=>setLoading(false))
  },[])
  
  useEffect(() => {
    const lockedAttractions = allAttractions.filter(a => lockedIds.has(a.id));
    const otherAttractions = allAttractions.filter(a => !lockedIds.has(a.id) && !trashedIds.has(a.id));
    setVisibleAttractions([...lockedAttractions, ...otherAttractions]);
  }, [allAttractions, lockedIds, trashedIds]);

  async function handleOptimize(){
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
        alert("Please select at least one attraction to optimize.");
        return;
    }
    
    const payload = { 
      attraction_ids: ids, 
      departure: start ? [0,0] : undefined, 
      arrival: end ? [0,0] : undefined 
    }
    
    if (import.meta.env.VITE_GOOGLE_MAPS_KEY) {
      setRouteRequest({ start, end, ids: Array.from(selectedIds) }) 
      setOptResult(null) 
      return
    }
    
    const res = await optimize(payload)
    setOptResult(res)
  }
  
  async function runSearchBetween(categoriesArray){
    try{
      setLoading(true)
      const payload = { 
        start, 
        end, 
        radius_km: Number(radiusKm || 5), 
        limit: Number(limit || 10), 
        categories: categoriesArray,
        trashed_ids: Array.from(trashedIds)
      }
      const res = await searchBetween(payload)
      const rows = res.rows || []
      
      const lockedAttractions = allAttractions.filter(a => lockedIds.has(a.id));
      
      const seen = new Set(lockedIds); 
      const deduped = [...lockedAttractions]; 
      
      rows.forEach(x=>{
        const id = x.id;
        if(id && !seen.has(id)){
          seen.add(id)
          deduped.push(x)
        }
      })
      
      setAllAttractions(deduped)
      
    }catch(err){
      console.error(err)
      alert('Search failed: ' + (err.message || err))
    }finally{
      setLoading(false)
    }
  }

  async function handleSearchBetween(e){
    if (e && e.preventDefault) e.preventDefault()
    await runSearchBetween(selectedCategories.map(c => c.value))
  }

  function handleSelectAll(){
    setSelectedIds(new Set(visibleAttractions.map(a=>a.id)))
  }

  function handleDeselectAll(){
    setSelectedIds(new Set())
  }
  
  function handleRouteRendered(route) {
      setRouteRequest(null);
      if (route && route.orderedAttractions) {
          setOptResult({
              orderedAttractions: route.orderedAttractions,
          });
      }
  }
  
  const handleToggleLock = (id) => {
    const newLockedIds = new Set(lockedIds);
    if (newLockedIds.has(id)) {
      newLockedIds.delete(id);
    } else {
      newLockedIds.add(id);
    }
    setLockedIds(newLockedIds);
  };

  const handleToggleTrash = (id) => {
    const newTrashedIds = new Set(trashedIds);
    if (newTrashedIds.has(id)) {
      newTrashedIds.delete(id);
    } else {
      newTrashedIds.add(id);
      const newSelected = new Set(selectedIds);
      newSelected.delete(id);
      setSelectedIds(newSelected);
      
      const newLocked = new Set(lockedIds);
      newLocked.delete(id);
      setLockedIds(newLocked);
    }
    setTrashedIds(newTrashedIds);
  };
  
  const handleToggleSelect = (id) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };
  
  // --- NEW: Double-click handler to fetch details ---
  const handleAttractionDoubleClick = async (attraction) => {
    // Use the primary 'id' from the attraction object
    const id = attraction.id;
    if (!id) {
      console.error("Attraction has no ID, cannot fetch details.", attraction);
      return;
    }
    
    setModalLoading(true);
    setModalData(null); // Clear old data
    try {
      const details = await getAttractionDetails(id);
      setModalData(details);
    } catch (error) {
      console.error("Failed to get attraction details:", error);
      alert(error.message);
    } finally {
      setModalLoading(false);
    }
  };
  // --- END NEW HANDLER ---

  return (
    <div className="app-root">
      {/* --- NEW: Render Modal --- */}
      {(modalData || modalLoading) && (
        <AttractionModal
          attraction={modalData}
          onClose={() => setModalData(null)}
        />
      )}
      {/* --- END MODAL --- */}
    
      <header className="app-header">
        TARO — Route Optimizer
        <ThemeSlider currentTheme={theme} toggleTheme={toggleTheme} />
      </header>

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
                styles={customStyles} 
                options={categoryOptions}
                value={selectedCategories}
                onChange={(vals)=>{
                  setSelectedCategories(vals || []) 
                }}
                placeholder={categoryOptions.length ? 'Filter or create categories...' : 'Loading categories...'}
                isDisabled={categoryOptions.length === 0} 
              />
            </div>
          </div>

          <div className="controls">
            <div className="button-group">
              <button className="btn" onClick={handleSelectAll}>Select all</button>
              <button className="btn" onClick={handleDeselectAll}>Deselect all</button>
              <button className="btn primary" onClick={handleOptimize} disabled={selectedIds.size === 0}>Optimize</button>
            </div>
          </div>

          <div className="split">
            <aside className="sidebar">
              {loading && <p>Loading...</p>}
              {!loading && (
                <div className="attraction-list-container">
                  <ul className="attraction-list">
                    {visibleAttractions.map(a=> {
                      const category = a.category || a.cat || null
                      const colorFor = (cat) => {
                        if(!cat) return '#6b7280'
                        const c = String(cat).toLowerCase() 
                        if(c.includes('park')) return '#10b981' // green
                        if(c.includes('museum')) return '#3b82f6' // blue
                        if(c.includes('amuse') || c.includes('ride')) return '#ef4444' // red
                        if(c.includes('histor')) return '#f59e0b' // amber
                        return '#6b7280' // muted
                      }
                      const badgeStyle = { backgroundColor: colorFor(category) }
                      
                      const isLocked = lockedIds.has(a.id);
                      
                      return (
                        // --- NEW: Added onDoubleClick ---
                        <li 
                          key={a.id} 
                          className={`attraction-item ${isLocked ? 'locked' : ''}`}
                          onDoubleClick={() => handleAttractionDoubleClick(a)}
                          title="Double-click for details"
                        >
                          <label>
                            <input type="checkbox" checked={selectedIds.has(a.id)} onChange={() => handleToggleSelect(a.id)} />
                            <span className="attraction-title">{a.name || a.title || a.id}</span>
                            <span className="cat-badge" style={badgeStyle}>{category || 'Uncategorized'}</span>
                          </label>
                          <div className="item-controls">
                            <button 
                              className={`item-btn ${isLocked ? 'active' : ''}`} 
                              title={isLocked ? "Unlock Attraction" : "Lock Attraction"}
                              onClick={() => handleToggleLock(a.id)}
                            >
                              {isLocked ? '🔒' : '🔓'}
                            </button>
                            <button 
                              className="item-btn trash" 
                              title="Trash Attraction"
                              onClick={() => handleToggleTrash(a.id)}
                            >
                              🗑️
                            </button>
                            {a.website_url && (
                              <a className="external-link" href={a.website_url} target="_blank" rel="noopener noreferrer">🔗</a>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </aside>

            <section className="map-area">
              <Map
                attractions={visibleAttractions} 
                selectedIds={Array.from(selectedIds)} 
                start={start}
                end={end}
                routeRequest={routeRequest}
                onRouteRendered={handleRouteRendered} 
              />
            </section>
          </div>

          {optResult && (
            <div className="opt-result">
              <h2>Optimized Route Result</h2>
              <RouteLink routeResult={optResult} /> 
              <pre className="opt-pre">{JSON.stringify(optResult, null, 2)}</pre>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}