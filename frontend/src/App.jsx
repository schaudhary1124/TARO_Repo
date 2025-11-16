import React, {useEffect, useState, useMemo, useRef} from 'react'
import { 
  listAttractions, 
  optimize, 
  searchBetween, 
  getAllCategories, 
  getAttractionDetails,
  submitRating,
  deleteRating,
  getTrip, // Necessary for loading saved trips
  createTrip // Necessary for saving the current state
} from './api'
import CreatableSelect from 'react-select/creatable'
import Map from './Map'
import './styles.css'
import { useAuth } from './AuthProvider'
import IssueReporter from './IssueReporter'
import SavedTrips from './SavedTrips' // The component that lists/loads trips


// --- localStorage Helpers ---
const RATING_STORAGE_KEY = 'taro_ratings';

function getMyRatings() {
  try {
    const ratings = localStorage.getItem(RATING_STORAGE_KEY);
    return ratings ? JSON.parse(ratings) : {};
  } catch (e) {
    console.error("Could not parse ratings from localStorage", e);
    return {};
  }
}

function getMyRating(attractionId) {
  if (!attractionId) return 0;
  return getMyRatings()[attractionId] || 0; // Return 0 if not rated
}

function setMyRating(attractionId, rating) {
  if (!attractionId) return;
  const ratings = getMyRatings();
  ratings[attractionId] = rating;
  localStorage.setItem(RATING_STORAGE_KEY, JSON.stringify(ratings));
}

function normalizeCategory(a) {
  if (!a) return a;
  const cat =
    a.category ||
    a.tourism || a.historic || a.leisure || a.amenity ||
    null;
  // Store a stable category field so sorting/badges work
  return { ...a, category: cat || 'attraction' };
}

// --- End Helpers ---


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

// --- NEW: Reusable Star Rating Component (Modified for layout) ---
function StarRating({ averageRating, ratingCount, myRating, onRating }) {
  const [hover, setHover] = useState(0);
  const displayRating = myRating > 0 ? myRating : Math.round(averageRating || 0);

  return (
    <div className="star-rating-container">
      <div className="star-rating">
        {[...Array(5)].map((_, index) => {
          const ratingValue = index + 1;
          return (
            <button
              type="button"
              key={ratingValue}
              className={ratingValue <= (hover || displayRating) ? "star-on" : "star-off"}
              onClick={() => onRating(ratingValue)}
              onMouseEnter={() => setHover(ratingValue)}
              onMouseLeave={() => setHover(0)}
            >
              <span className="star">★</span>
            </button>
          );
        })}
      </div>
      <div className="star-rating-text">
        {(averageRating ?? 0).toFixed(1)} stars ({ratingCount || 0} ratings)
      </div>
    </div>
  );
}

// --- END NEW STAR COMPONENT ---


// --- MODIFIED: Attraction Details Modal Component ---
function AttractionModal({ token, user, attraction, onClose, onRatingSubmitted }) {

  if (!attraction) return null;

  const { 
    id, name, wikipedia, 
    tourism, historic, leisure, amenity, opening_hours,
    website_url,
    average_rating, rating_count,
    summary,
    // Extract enrichment metadata for display
    ai_source,
    ai_updated_at,
    // NEW: Address fields (address now holds the best address from the API)
    address, 
    road, city, country,
    lat, lon
  } = attraction;

  // Logic for wiki link, website link, and tags (kept the same)
  const wikiLink = wikipedia
    ? `https://${(wikipedia.includes(':') ? wikipedia.split(':')[0] : 'en')}.wikipedia.org/wiki/${(wikipedia.includes(':') ? wikipedia.split(':')[1] : wikipedia)}`
    : null;

  const websiteLink = website_url || null;

  const tags = [tourism, historic, leisure, amenity]
    .filter(Boolean)
    .map(String)
    .map(tag => tag.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));

  const myRating = getMyRating(id);

  const handleRate = async (newRating) => {
    try {
      // Requires login (backend enforces). We'll also keep local storage UX.
      const result = await submitRating(token, id, newRating);
      setMyRating(id, newRating);

      // Merge aggregate rating result into modal data
      // result = { attraction_id, user_rating, rating_count, average_rating }
      onRatingSubmitted({
        ...attraction,
        average_rating: result.average_rating,
        rating_count: result.rating_count
      });
    } catch (err) {
      console.error('Failed to submit rating:', err);
      alert(err.message || 'Rating failed');
    }
  };

    const [removing, setRemoving] = useState(false);

  async function handleRemoveRating() {
    try {
      setRemoving(true);
      const res = await deleteRating(token, id); // id already destructured from attraction

      // remove from local storage
      const ratings = getMyRatings();
      delete ratings[id];
      localStorage.setItem('taro_ratings', JSON.stringify(ratings));

      // update modal + list aggregates
      onRatingSubmitted({
        ...attraction,
        average_rating: res.average_rating,
        rating_count: res.rating_count,
      });

      alert(res.deleted ? 'Your rating was removed.' : 'You had no rating to remove.');
    } catch (e) {
      console.error('Failed to remove rating:', e);
      alert(e.message || 'Failed to remove rating');
    } finally {
      setRemoving(false);
    }
  }
  
  // Logic for category badge (similar to card logic)
  const rawCategory = tourism || historic || leisure || amenity || 'attraction';
  const categoryLabel = String(rawCategory).replace(/_/g, ' ').toLowerCase();
  const colorFor = (cat) => {
      if (!cat) return '#6b7280';
      const c = String(cat).toLowerCase();
      if (c.includes('park') || c.includes('nature')) return '#10b981';
      if (c.includes('museum')) return '#3b82f6';
      if (c.includes('amuse') || c.includes('ride')) return '#ef4444';
      if (c.includes('histor')) return '#f59e0b';
      if (c.includes('relig')) return '#6366f1';
      return '#6b7280';
  };
  const badgeStyle = { backgroundColor: colorFor(categoryLabel) };
  
    // NEW: detect fallback / generic AI
  const normalizedSource = (ai_source || '').toString().toLowerCase();
  const isFallbackSource =
    normalizedSource === 'fallback' || normalizedSource === 'osm';

  const isBlandSummary =
    !summary ||
    summary.trim().length < 24 ||
    summary.toLowerCase().includes('popular with visitors') ||
    summary.toLowerCase().includes('popular tourist destination') || 
    // New check: if the summary is just a generic sentence about the category
    summary.toLowerCase().includes(categoryLabel + ' popular with visitors'); 


  const shouldShowAi = !!summary && !isFallbackSource && !isBlandSummary;

  
  // NEW: Determine display address. Use the 'address' field returned by the API (which prioritizes AI)
  const displayAddress = address || (lat && lon ? `Lat: ${lat?.toFixed(4)}, Lon: ${lon?.toFixed(4)}` : null);


  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose}>×</button>
        <h2>{name || "Details"}</h2>
        <span className="cat-badge" style={badgeStyle}>
          {categoryLabel}
        </span>

        {/* --- Grid Details (Location, Hours, etc.) --- */}
        <div className="modal-grid-details">
          <div className="modal-detail-block">
            <strong>Location</strong>
            {/* FIX: Show the best address string or coordinates */}
            {displayAddress ? (
                <p>{displayAddress}</p>
            ) : (
                <p>Lat: {lat?.toFixed(4)}, Lon: {lon?.toFixed(4)}</p>
            )}
          </div>

          <div className="modal-detail-block">
            <strong>My Rating</strong>
            <StarRating
              averageRating={average_rating}
              ratingCount={rating_count}
              myRating={myRating}
              onRating={handleRate}
            />
          </div>
          
          {opening_hours && (
            <div className="modal-detail-block">
              <strong>Opening Hours</strong>
              <p>{opening_hours}</p>
            </div>
          )}

          {tags.length > 0 && (
            <div className="modal-detail-block">
              <strong>Tags</strong>
              <p>{tags.join(', ')}</p>
            </div>
          )}
        </div>
        
        <div className="attraction-modal-actions">
           {user && !user.guest && myRating > 0 && (
              <button className="btn" onClick={handleRemoveRating} disabled={removing}>
                {removing ? 'Removing…' : 'Remove my rating'}
              </button>
            )}
        </div>

        {/* --- AI Section (Summary) --- */}
        {/* FIX: Only show AI section if a summary exists AND it's not a bland fallback */}
        {shouldShowAi && (
          <div className="modal-ai-section">
            <h3>✨ AI-Powered Insights</h3>
            <p>{summary}</p>
            {(ai_source && ai_updated_at) && (
              <p style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '8px', fontStyle: 'italic' }}>
                Source: {ai_source} (Last enriched: {new Date(ai_updated_at * 1000).toLocaleDateString()})
              </p>
            )}
          </div>
        )}


        {/* --- Links --- */}
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
  );
}
// --- END MODIFIED MODAL ---


// --- NEW: Account Dropdown Component ---
function AccountDropdown({ user, logout, onAuth }) {
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const dropdownRef = useRef(null);

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await onAuth(email, password);
      setIsOpen(false); // Close on success
      setEmail('');
      setPassword('');
    } catch (err) {
      setError(err.message || 'Authentication failed');
    }
  };
  
  // Click away to close
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [dropdownRef]);

  // --- Styles for the dropdown (inline to keep it in one file) ---
  const styles = {
    container: { position: 'relative', display: 'inline-block' },
    menu: {
      position: 'absolute',
      top: 'calc(100% + 8px)', // 8px spacing
      right: 0,
      backgroundColor: 'var(--card-bg)', // Use theme variables
      border: '1px solid var(--border-color)',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      padding: '16px',
      width: '250px',
      zIndex: 100,
      color: 'var(--text-primary)'
    },
    userInfo: { 
      marginBottom: '12px', 
      fontSize: '0.9em',
      wordBreak: 'break-all'
    },
    form: { 
      display: 'flex', 
      flexDirection: 'column', 
      gap: '10px' 
    },
    formTitle: {
      margin: 0, 
      fontWeight: 500,
      fontSize: '1em'
    },
    error: { 
      color: 'var(--danger, #e53e3e)', 
      fontSize: '0.9em' 
    },
    button: {
      fontWeight: 500
    },
    fullWidthBtn: {
      width: '100%'
    }
  };

  return (
    <div style={styles.container} ref={dropdownRef}>
      <button className="btn" onClick={() => setIsOpen(!isOpen)} style={styles.button}>
        👤 Account ▾
      </button>
      
      {isOpen && (
        <div style={styles.menu}>
          {!!user ? (
            <>
              <div style={styles.userInfo}>
                <strong>{user.email}</strong>
              </div>
              <button 
                className="btn" 
                style={styles.fullWidthBtn} 
                onClick={() => { logout(); setIsOpen(false); }}
              >
                Logout
              </button>
            </>
          ) : (
            <form style={styles.form} onSubmit={handleAuthSubmit}>
              <p style={styles.formTitle}>Sign in or create an account</p>
              <input
                type="email"
                className="input" // Use existing class
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                type="password"
                className="input" // Use existing class
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {error && <div style={styles.error}>{error}</div>}
              <button type="submit" className="btn primary" style={styles.fullWidthBtn}>
                Login / Register
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
// --- END Account Dropdown ---


const setDocumentTheme = (theme) => {
    document.documentElement.className = `theme-${theme}`
}

export default function App(){
  const [allAttractions, setAllAttractions] = useState([]) 
  const [visibleAttractions, setVisibleAttractions] = useState([]) // This list will be sorted
  const [loading, setLoading] = useState(false)
  const [optResult, setOptResult] = useState(null)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [radiusKm, setRadiusKm] = useState('5')
  const [limit, setLimit] = useState('10')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [routeRequest, setRouteRequest] = useState(null)
  const [categoryOptions, setCategoryOptions] = useState([])
  const [selectedCategories, setSelectedCategories] = useState([])
  const [lockedIds, setLockedIds] = useState(new Set())
  const [trashedIds, setTrashedIds] = useState(new Set())
  const [modalData, setModalData] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [theme, setTheme] = useState('light')
  const { user, token, login, register, logout } = useAuth()
  const [viewMode, setViewMode] = useState('list') // 'map' or 'list'
  const [showIssue, setShowIssue] = useState(false)
  const [showTrips, setShowTrips] = useState(false) // State for Saved Trips Modal
  const [removing, setRemoving] = useState(false);


  useEffect(() => {
    setDocumentTheme(theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(current => current === 'light' ? 'dark' : 'light')
  }

  // --- MODIFIED: customStyles ---
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
    }), // <-- Comma is here
    option: (provided, state) => ({
      ...provided,
      backgroundColor: state.isFocused
        ? (theme === 'dark' ? 'var(--accent)' : '#deebff')
        : (theme === 'dark' ? 'var(--card-bg)' : 'white'),
      color: state.isFocused
        ? 'white'
        : (theme === 'dark' ? 'var(--text-primary)' : 'var(--text-primary)'),
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
  // --- END MODIFIED: customStyles ---

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
    const url = new URL('https://www.google.com/maps/dir/');
    url.searchParams.set('api', '1');
    url.searchParams.set('travelmode', 'driving');
    url.searchParams.set('origin', origin);
    url.searchParams.set('destination', destination);
    if (waypointsArr.length > 0) {
      url.searchParams.set('waypoints', waypointsArr.join('|'));
    }
    return `https://www.google.com/maps/dir/?${url.searchParams.toString()}`;
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
      // Backend now returns a sorted list of top categories
      const options = cats.map(c => ({ value: c, label: c }));
      setCategoryOptions(options);
    }).catch(console.error);

    listAttractions(20).then(r=>{
      const rows = r.rows || []
      const deduped = []
      const seen = new Set()
      rows.forEach(x=>{
        if(x.id && !seen.has(x.id)){
          seen.add(x.id)
          deduped.push(x)
        }
      })
      setAllAttractions(deduped);
    }).catch(console.error).finally(()=>setLoading(false))
  },[])
  
  // --- MODIFIED: Sort visible list by category ---
  useEffect(() => {
    const lockedAttractions = allAttractions.filter(a => lockedIds.has(a.id));
    const otherAttractions = allAttractions.filter(a => !lockedIds.has(a.id) && !trashedIds.has(a.id));
    
    // Sort the "other" attractions by category
    otherAttractions.sort((a, b) => {
      const catA = a.category || 'Z'; // 'Z' to sort uncategorized to the bottom
      const catB = b.category || 'Z';
      if (catA === catB) {
          return (a.name || '').localeCompare(b.name || ''); // Sort by name if categories are same
      }
      return catA.localeCompare(catB);
    });
    
    setVisibleAttractions([...lockedAttractions, ...otherAttractions]);
  }, [allAttractions, lockedIds, trashedIds]);
  // --- END MODIFICATION ---

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
      // Ensure we send an array of strings
      categories: categoriesArray, 
      trashed_ids: Array.from(trashedIds)
    }
    
    // --- API CALL ---
    const API_ROOT = import.meta.env.VITE_API_BASE || '';
    const url = `${API_ROOT}/api/search_between`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      let errDetail = 'Unknown API error';
      try {
        const errJson = await res.json();
        // Capture specific FastAPI validation/detail message
        errDetail = errJson.detail || JSON.stringify(errJson); 
      } catch {
        // Fallback to HTTP status text
        errDetail = `HTTP Error ${res.status}: ${res.statusText}`;
      }
      throw new Error(errDetail);
    }
    // --- END API CALL ---

    const j = await res.json();

    // Support both wrapped and plain response shapes
    const result = (j && j.status === 'ok' && j.result) ? j.result : j;
    const rows = Array.isArray(result.rows) ? result.rows : [];


    // --- Core Logic ---
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

    // --- REMOVED: Bulk enrichment logic. Data enrichment now relies ONLY on the details page click.

    setAllAttractions(deduped)
  }catch(err){
    console.error('Search failed:', err)
    // Display the more specific error detail captured above
    alert('Search failed: ' + (err.message || 'The request failed to complete.'));
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

  // --- NEW: Reusable Authentication Handler ---
  const handleAuthentication = async (email, password) => {
    if (!email || !password) {
      throw new Error('Email and password are required.');
    }
    try {
      // Try login first
      await login(email, password);
      alert(`Welcome back, ${email}! You are now signed in.`);
    } catch {
      // If login fails, try register
      try {
        await register(email, password);
        alert(`Account created! Welcome, ${email}! You are now signed in.`);
      } catch (err) {
        // Re-throw the specific error
        throw new Error(err.message || 'Authentication failed');
      }
    }
  };
  // --- END Reusable Handler ---
  
  const handleAttractionDoubleClick = async (attraction) => {
    const id = attraction.id;
    if (!id) {
      console.error("Attraction has no ID, cannot fetch details.", attraction);
      return;
    }

    // Split into type and numeric ID
    const [osmType, osmId] = id.split('/');
    if (!osmType || !osmId) {
      console.error("Invalid attraction ID format:", id);
      alert("Invalid attraction ID format. Unable to get details.");
      return;
    }

    setModalLoading(true);
    setModalData(null); 
    try {
      // This is the call that triggers the single-item enrichment in the backend
      const details = await getAttractionDetails(osmType, osmId);
      setModalData(details);
    } catch (error) {
      console.error("Failed to get attraction details:", error);
      alert(error.message);
    } finally {
      setModalLoading(false);
    }
  };

  
  const handleRatingSubmitted = (updatedAttraction) => {
    setModalData(updatedAttraction); 
    setAllAttractions(currentAttractions => 
      currentAttractions.map(attr => 
        attr.id === updatedAttraction.id ? updatedAttraction : attr
      )
    );
  };

// App.jsx — replace your currentSelection useMemo with this one
const currentSelection = useMemo(() => ({
  start,
  end,
  radius_km: Number(radiusKm) || null,
  limit: Number(limit) || null,
  categories: selectedCategories.map(c => c.value),
  trashed_ids: Array.from(trashedIds),
  attractions: visibleAttractions.map((a, i) => ({
    id: a.id,
    locked: lockedIds.has(a.id),
    position: i,
  })),
}), [start, end, radiusKm, limit, selectedCategories, trashedIds, visibleAttractions, lockedIds]);


// --- NEW/RESTORED: onLoadTrip handler logic ---
const onLoadTrip = async (tripId) => {
  if (!token) return; // Should not happen as button is disabled, but safety check.
  
  const tr = await getTrip(token, tripId);

  // --- 1) Basic fields / filters
  setStart(tr.start || '');
  setEnd(tr.end || '');
  if (tr.radius_km != null) setRadiusKm(String(tr.radius_km));
  if (tr.limit != null) setLimit(String(tr.limit));
  if (tr.categories) setSelectedCategories(tr.categories.map(c => ({ value: c, label: c })));
  if (tr.trashed_ids) setTrashedIds(new Set(tr.trashed_ids));

  // --- 2) IDs from the trip
  const loaded = Array.isArray(tr.attractions) ? tr.attractions : [];
  const loadedIds = loaded.map(x => x.attraction_id);
  const loadedLockedIds = new Set(loaded.filter(x => x.locked).map(x => x.attraction_id));

  // Keep anything CURRENTLY locked that isn’t in the saved trip
  const carryLocked = allAttractions.filter(a => lockedIds.has(a.id) && !loadedIds.includes(a.id));

  // Helper: fetch details for one id
  const fetchOne = async (id) => {
    const [osmType, osmId] = String(id).split('/');
    if (!osmType || !osmId) return null;
    try {
      const d = await getAttractionDetails(osmType, osmId); 
      return d;
    } catch (e) {
      console.warn('Failed to fetch details for', id, e);
      return null;
    }
  };

  // --- 3) Build saved list strictly in saved order
  const savedList = [];
  for (const id of loadedIds) {
    const existing = allAttractions.find(a => a.id === id && (a.name || a.title));
    if (existing) {
      savedList.push(normalizeCategory(existing));
    } else {
      const det = await fetchOne(id);
      if (det) savedList.push(normalizeCategory(det));
    }
  }

  // --- 4) Replace (do NOT merge) – final list = [carryLocked] + [savedList]
  const finalList = [...carryLocked.map(normalizeCategory), ...savedList];
  setAllAttractions(finalList);


  // Update locks/selections
  setLockedIds(new Set([...loadedLockedIds]));
  setSelectedIds(new Set(loadedIds));

  setShowTrips(false); // Close the modal
};
// --- END NEW/RESTORED onLoadTrip handler logic ---

// --- NEW: Save current trip function ---
const handleSaveCurrent = () => {
    if (!user || user.guest) {
        alert("Please log in to save your current route.");
        return;
    }
    
    // Open the SavedTrips modal, which handles the saving logic via a form
    // The SavedTrips component receives currentSelection and decides if it needs a title input
    setShowTrips(true);
};
// --- END NEW: Save current trip function ---


  return (
    <div className="app-root">
      {(modalData || modalLoading) && (
        <AttractionModal
          token={token}
          user={user}
          attraction={modalData}
          onClose={() => setModalData(null)}
          onRatingSubmitted={(updated) => {
            setModalData(updated);
            setAllAttractions(curr => curr.map(a => a.id === updated.id ? { ...a, ...updated } : a));
          }}
        />
      )}
      
      {/* --- ADDED BACK: Saved Trips Modal/Overlay --- */}
      {showTrips && (
        <div className="modal-backdrop" onClick={() => setShowTrips(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-btn" onClick={() => setShowTrips(false)}>×</button>
            <SavedTrips
              token={token} // Pass token for API calls within SavedTrips
              currentSelection={currentSelection}
              onLoadTrip={(tripId) => {
                onLoadTrip(tripId);
                setShowTrips(false);
              }}
              onClose={() => setShowTrips(false)} // Pass the close function
            />
          </div>
        </div>
      )}


      {/* === MODIFIED: Header === */}
      <header className="app-header">
        {/* Left-aligned TARO Logo/Title */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--accent)', marginRight: '8px' }}>TARO</div>
          <div style={{ fontSize: '14px', color: 'var(--muted)' }}>Tourist Attraction Route Optimizer</div>
        </div>

        {/* Right-aligned Map/List Toggle + Account Dropdown */}
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          
          {/* Saved Trips Button (Opens the Modal) */}
          <button 
            className="btn" 
            onClick={() => setShowTrips(true)} // Toggles the visibility state
            disabled={!user || user.guest}
          >
            Saved Trips
          </button>
          
          {/* Report Issue Button (Moved to align with toggle) */}
          <button className="btn" onClick={() => setShowIssue(true)}>Report issue</button>
          
          {/* Map/List Toggle */}
          <div className="view-toggle-group">
            <button 
              className={`btn ${viewMode === 'map' ? 'active-toggle' : 'toggle'}`}
              onClick={() => setViewMode('map')}
              title="Map View"
            >
              <span style={{ fontSize: '18px', lineHeight: 1 }}>🗺️</span> Map
            </button>
            <button 
              className={`btn ${viewMode === 'list' ? 'active-toggle' : 'toggle'}`}
              onClick={() => setViewMode('list')}
              title="List View"
            >
              <span style={{ fontSize: '18px', lineHeight: 1 }}>📜</span> List
            </button>
          </div>
          
          <AccountDropdown 
            user={user} 
            logout={logout} 
            onAuth={handleAuthentication} 
          />
        </div>
      </header>
      {/* === END MODIFIED Header === */}


      <main className="app-main">
        {/* === Report Issue Modal === */}
        {showIssue && (
          <IssueReporter 
            onClose={() => setShowIssue(false)} 
            prefill={{ subject: 'General', context: {} }} 
          />
        )}

        {/* === Planner View (Now the only view) */}
        <div className="planner-container">

            {/* LEFT: Controls/Sidebar */}
            <aside className="controls-sidebar">
                <form onSubmit={handleSearchBetween}> {/* Form controls the submission */}
                    <div className="search-row">
                        <div className="inputs">
                            <input className="input" placeholder="Start address" value={start} onChange={e => setStart(e.target.value)} />
                            <input className="input" placeholder="End address" value={end} onChange={e => setEnd(e.target.value)} />
                            <input className="input small" placeholder="Radius km" value={radiusKm} onChange={e => setRadiusKm(e.target.value)} />
                            <input className="input small" placeholder="Limit" value={limit} onChange={e => setLimit(e.target.value)} />
                            
                            <div className="category-box">
                                <CreatableSelect
                                    isMulti
                                    styles={customStyles} 
                                    options={categoryOptions}
                                    value={selectedCategories}
                                    onChange={(vals) => { setSelectedCategories(vals || []); }}
                                    placeholder={categoryOptions.length ? 'Filter or create categories...' : 'Loading categories...'}
                                    isDisabled={categoryOptions.length === 0} 
                                />
                            </div>
                        </div>

                        <button className="btn primary" type="submit" disabled={isSearchDisabled} style={{ width: '100%', marginTop: '8px' }}>
                            Search between
                        </button>
                    </div>
                </form>

                <div className="controls" style={{ justifyContent: 'flex-start', marginBottom: '20px' }}>
                    <div className="button-group">
                        <button className="btn" onClick={handleSelectAll}>Select all ({selectedIds.size})</button>
                        <button className="btn" onClick={handleDeselectAll}>Deselect all</button>
                        <button className="btn primary" onClick={handleOptimize} disabled={selectedIds.size === 0}>
                            Optimize Route ({selectedIds.size})
                        </button>
                    </div>
                </div>

                {/* Quick Stats Block */}
                <div style={{ marginTop: '20px', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                    <h3 style={{ margin: '0 0 10px', fontSize: '1em' }}>Quick Stats</h3>
                    <p style={{ margin: '4px 0', fontSize: '0.9em' }}>Total Attractions: <strong>{allAttractions.length}</strong></p>
                    <p style={{ margin: '4px 0', fontSize: '0.9em' }}>In Route: <strong>{selectedIds.size}</strong></p>
                    
                    {/* --- NEW: Save Current Button (Below Quick Stats) --- */}
                    <button 
                      className="btn primary" 
                      onClick={handleSaveCurrent}
                      disabled={!user || user.guest || selectedIds.size === 0}
                      style={{ width: '100%', marginTop: '12px' }}
                    >
                      ⭐ Save Current Route ({selectedIds.size})
                    </button>
                    {/* --- END NEW BUTTON --- */}
                </div>
                
                {optResult && (
                    <div className="opt-result">
                        <h3 style={{fontSize: '1em'}}>Optimized Route</h3>
                        <RouteLink routeResult={optResult} />
                        <details>
                            <summary style={{fontSize: '0.9em', cursor: 'pointer', color: 'var(--muted)'}}>Show Raw Result</summary>
                            <pre className="opt-pre">{JSON.stringify(optResult, null, 2)}</pre>
                        </details>
                    </div>
                )}
            </aside>

            {/* RIGHT: Content Area (Map or List) */}
            <section className="content-area-main">
                <div className="map-area" style={{ display: viewMode === 'map' ? 'block' : 'none' }}>
                    <Map
                        attractions={visibleAttractions}
                        selectedIds={Array.from(selectedIds)}
                        start={start}
                        end={end}
                        routeRequest={routeRequest}
                        onRouteRendered={handleRouteRendered}
                    />
                </div>
                
                <aside className="sidebar" style={{ display: viewMode === 'list' ? 'block' : 'none' }}>
                    <h2 className="attraction-list-title">All Attractions</h2>

                    {loading && <p>Loading...</p>}

                    {!loading && visibleAttractions.length === 0 && (
                      <p className="attraction-empty">
                        No attractions match your current filters yet.
                        Try widening the radius, increasing the limit, or changing categories.
                      </p>
                    )}

                    {!loading && visibleAttractions.length > 0 && (
                        <div className="attraction-list-container">
                            <ul className="attraction-list">
                                {visibleAttractions.map((a) => {
                                    const rawCategory =
                                      a.category ||
                                      a.tourism ||
                                      a.historic ||
                                      a.leisure ||
                                      a.amenity ||
                                      'attraction';

                                    const categoryLabel = String(rawCategory)
                                      .replace(/_/g, ' ')
                                      .toLowerCase();

                                    const colorFor = (cat) => {
                                      if (!cat) return '#6b7280';
                                      const c = String(cat).toLowerCase();
                                      if (c.includes('park') || c.includes('nature'))
                                        return '#10b981'; // green
                                      if (c.includes('museum')) return '#3b82f6'; // blue
                                      if (c.includes('amuse') || c.includes('ride'))
                                        return '#ef4444'; // red
                                      if (c.includes('histor')) return '#f59e0b'; // amber
                                      if (c.includes('relig')) return '#6366f1'; // indigo
                                      return '#6b7280';
                                    };

                                    const badgeStyle = { backgroundColor: colorFor(categoryLabel) };

                                    const isLocked = lockedIds.has(a.id);
                                    const isSelected = selectedIds.has(a.id);

                                    // Best-effort address (will just hide if we don’t have these fields)
                                    const addressParts = [
                                      a.address,
                                      a.road,
                                      a.city,
                                      a.town,
                                      a.village,
                                      a.state,
                                      a.country,
                                    ].filter(Boolean);
                                    const address = addressParts.join(', ');

                                    // Optional visit duration and rating chips (only shown if present)
                                    const durationMin =
                                      a.visit_minutes ||
                                      a.duration_min ||
                                      a.default_visit_min ||
                                      a.default_visit_duration ||
                                      a.estimated_visit_minutes ||
                                      a.estimated_visit_duration ||
                                      null;

                                    const hasRating =
                                      typeof a.average_rating === 'number' &&
                                      !Number.isNaN(a.average_rating);
                                    const ratingText = hasRating
                                      ? a.average_rating.toFixed(1)
                                      : null;

                                    return (
                                      <li
                                        key={a.id}
                                        className={`attraction-item attraction-card ${
                                          isLocked ? 'locked' : ''
                                        }`}
                                        onDoubleClick={() => handleAttractionDoubleClick(a)}
                                        title="Double-click for details"
                                      >
                                        {/* Card header: name + category pill */}
                                        <div className="attraction-card-header">
                                          <div className="attraction-card-title-block">
                                            <h3 className="attraction-name">
                                              {a.name || a.title || a.id}
                                            </h3>
                                            {address && (
                                              <div className="attraction-address">
                                                <span className="card-icon">📍</span>
                                                <span className="card-text">{address}</span>
                                              </div>
                                            )}
                                          </div>

                                          <span
                                            className="cat-badge card-category-pill"
                                            style={badgeStyle}
                                          >
                                            {categoryLabel}
                                          </span>
                                        </div>

                                        {/* Meta chips row */}
                                        {(durationMin || ratingText) && (
                                          <div className="attraction-card-meta">
                                            {durationMin && (
                                              <span className="meta-chip">
                                                <span className="card-icon">⏱</span>
                                                <span className="card-text">{durationMin} min</span>
                                              </span>
                                            )}
                                            {ratingText && (
                                              <span className="meta-chip">
                                                <span className="card-icon">⭐</span>
                                                <span className="card-text">{ratingText}</span>
                                              </span>
                                            )}
                                          </div>
                                        )}

                                        {/* Footer: select + controls */}
                                        <div className="attraction-card-footer">
                                          <label className="select-toggle">
                                            <input
                                              type="checkbox"
                                              checked={isSelected}
                                              onChange={() => handleToggleSelect(a.id)}
                                            />
                                            <span className="select-label">
                                              {isSelected ? 'Selected' : 'Add to route'}
                                            </span>
                                          </label>

                                          <div className="card-footer-actions">
                                            <button
                                              className={`item-btn ${isLocked ? 'active' : ''}`}
                                              type="button"
                                              title={
                                                isLocked ? 'Unlock attraction' : 'Lock attraction'
                                              }
                                              onClick={() => handleToggleLock(a.id)}
                                            >
                                              {isLocked ? '🔒' : '🔓'}
                                            </button>
                                            <button
                                              className="item-btn trash"
                                              type="button"
                                              title="Trash attraction"
                                              onClick={() => handleToggleTrash(a.id)}
                                            >
                                              🗑️
                                            </button>
                                            {a.website_url && (
                                              <a
                                                className="external-link"
                                                href={a.website_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                title="Open website"
                                              >
                                                🔗
                                              </a>
                                            )}
                                          </div>
                                        </div>

                                        {/* View Details button (nice big tap target) */}
                                        <button
                                          type="button"
                                          className="btn primary card-details-btn"
                                          onClick={() => handleAttractionDoubleClick(a)}
                                        >
                                          View Details
                                        </button>
                                      </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}
                </aside>

            </section>
        </div>
      </main>

      {/* --- NEW: Fixed Theme Slider --- */}
      <div style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: 1000
      }}>
        <ThemeSlider currentTheme={theme} toggleTheme={toggleTheme} />
      </div>

    </div>
  )
}