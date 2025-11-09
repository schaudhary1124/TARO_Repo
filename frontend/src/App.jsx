import React, {useEffect, useState, useMemo, useRef} from 'react'
import { 
  listAttractions, 
  optimize, 
  searchBetween, 
  getAllCategories, 
  getAttractionDetails,
  submitRating 
} from './api'
import CreatableSelect from 'react-select/creatable'
import Map from './Map'
import './styles.css'
import { useAuth } from './AuthProvider'
import Home from './Home'
import SavedTrips from './SavedTrips'
import IssueReporter from './IssueReporter'
import { deleteRating } from './api';


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

// --- NEW: Reusable Star Rating Component ---
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
    average_rating, rating_count
  } = attraction;

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


  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose}>×</button>
        <h2>{name || "Details"}</h2>

        <StarRating
          averageRating={average_rating}
          ratingCount={rating_count}
          myRating={myRating}
          onRating={handleRate}
        />
        {user && !user.guest && (
          <button className="btn" onClick={handleRemoveRating} disabled={removing}>
            {removing ? 'Removing…' : 'Remove my rating'}
          </button>
        )}


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
  const [showHome, setShowHome] = useState(true)
  const [showTrips, setShowTrips] = useState(false)
  const [showIssue, setShowIssue] = useState(false)
  const [showTips, setShowTips] = useState(false)
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    setDocumentTheme(theme)
  }, [theme])

  useEffect(() => {
  if (!localStorage.getItem('taro_seen_tips')) {
    setShowTips(true);
    localStorage.setItem('taro_seen_tips', '1');
  }
}, []);

  const toggleTheme = () => {
    setTheme(current => current === 'light' ? 'dark' : 'light')
  }

  // --- MODIFIED: customStyles ---
  // This includes your fix for the comma.
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

  const currentSelection = useMemo(() => ({
    title: 'My Trip', // SavedTrips can override with user input
    start,
    end,
    radius_km: Number(radiusKm || 5),
    limit: Number(limit || 10),
    categories: selectedCategories.map(c => c.value),
    trashed_ids: Array.from(trashedIds),
    attractions: visibleAttractions.map(a => ({
      id: a.id,
      locked: lockedIds.has(a.id),
      position: undefined, // or compute if you like
    })),
  }), [start, end, radiusKm, limit, selectedCategories, trashedIds, visibleAttractions, lockedIds]);


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


      {/* === MODIFIED: Header === */}
      <header className="app-header">
        {/* Left-aligned navigation */}
        <div style={{display:'flex', gap:8, alignItems:'center'}}>
          <button className="btn" onClick={()=>{ setShowHome(true); setShowTrips(false); }}>Home</button>
          <button className="btn" onClick={()=>{ setShowHome(false); setShowTrips(false); }}>Planner</button>
          <button className="btn" onClick={()=>{ setShowTrips(true); setShowHome(false); }} disabled={!user || user.guest}>Saved Trips</button>
          <button className="btn" onClick={()=> setShowIssue(true)}>Report issue</button>
        </div>

        {/* Right-aligned Account Dropdown */}
        <div style={{display:'flex', gap:8, alignItems:'center'}}>
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

        {showTips && (
        <div className="modal-backdrop" onClick={()=>setShowTips(false)}>
          <div className="modal-content" onClick={(e)=>e.stopPropagation()}>
            <button className="modal-close-btn" onClick={()=>setShowTips(false)}>×</button>
            <h3>Quick tips</h3>
            <ul>
              <li>Enter start & end, choose categories, then “Search between”.</li>
              <li>Lock 🔒 favorites so they remain when you search again.</li>
              <li>Trash 🗑️ removes an attraction from future suggestions.</li>
              <li>Double-click an attraction for details and ratings.</li>
              <li>Sign in to save trips and load them later.</li>
            </ul>
            <div className="button-group" style={{marginTop:12}}>
              <button className="btn primary" onClick={()=>setShowTips(false)}>Got it</button>
            </div>
          </div>
        </div>
      )}


        {/* === Home Screen View === */}
        {showHome && !showTrips && (
          <Home
            onEnterPlanner={() => { setShowHome(false); }}
            onOpenTrips={() => { setShowHome(false); setShowTrips(true); }}
            onOpenAISearch={() => alert('AI Search coming soon!')}
            onOpenAccount={async () => {
              if (!!user) {
                alert(`Signed in as ${user.email}`);
                return;
              }
              
              const email = prompt('Email:');
              if (!email) return;
              const pw = prompt('Password (new users will be registered):');
              if (!pw) return;

              try {
                await handleAuthentication(email, pw);
              } catch (err) {
                alert(err.message);
              }
            }}

          />
        )}

        {/* === Saved Trips View === */}
        {!showHome && showTrips && (
          <SavedTrips
          currentSelection={currentSelection}
          onLoadTrip={async (tripId) => {
            const { getTrip } = await import('./api');
            const tr = await getTrip(token, tripId);

            // 1) Basic fields
            setStart(tr.start || '');
            setEnd(tr.end || '');

            // ⇩⇩ PASTE/KEEP THESE LINES RIGHT AFTER setEnd ⇩⇩
            if (tr.radius_km != null) setRadiusKm(String(tr.radius_km));
            if (tr.limit != null) setLimit(String(tr.limit));
            if (tr.categories) setSelectedCategories(tr.categories.map(c => ({ value: c, label: c })));
            if (tr.trashed_ids) setTrashedIds(new Set(tr.trashed_ids));
            // ⇧⇧ END OF PASTED LINES ⇧⇧

            // 2) Use attraction_id (not id)
            const loadedIds = tr.attractions.map(x => x.attraction_id);
            const lockedSet = new Set(tr.attractions.filter(x => x.locked).map(x => x.attraction_id));
            setLockedIds(lockedSet);
            setSelectedIds(new Set(loadedIds));

            // 3) Hydrate missing attractions into the sidebar list
            const present = new Set(allAttractions.map(a => a.id));
            const missing = loadedIds.filter(id => !present.has(id));

            if (missing.length > 0) {
              const { getAttractionDetails } = await import('./api');
              const fetched = [];
              for (const id of missing) {
                const [osmType, osmId] = String(id).split('/');
                if (!osmType || !osmId) continue;
                try {
                  const details = await getAttractionDetails(osmType, osmId);
                  fetched.push(details);
                } catch (e) {
                  console.warn('Failed to fetch details for', id, e);
                }
              }
              setAllAttractions(prev => {
                const seen = new Set(prev.map(a => a.id));
                const merged = [...prev];
                for (const d of fetched) {
                  if (d && d.id && !seen.has(d.id)) {
                    merged.push(d);
                    seen.add(d.id);
                  }
                }
                return merged;
              });
            }

            setShowTrips(false); // go back to Planner view
          }}
        />

        )}

        {/* === Planner View (original UI) === */}
        {!showHome && !showTrips && (
          <div className="card">

            {/* === START of your original planner UI === */}

            <div className="search-row">
              <div className="inputs">
                <input className="input" placeholder="Start address" value={start} onChange={e => setStart(e.target.value)} />
                <input className="input" placeholder="End address" value={end} onChange={e => setEnd(e.target.value)} />
                <input className="input small" placeholder="radius km" value={radiusKm} onChange={e => setRadiusKm(e.target.value)} />
                <input className="input small" placeholder="limit" value={limit} onChange={e => setLimit(e.target.value)} />
                <button className="btn primary" type="button" onClick={handleSearchBetween} disabled={isSearchDisabled}>Search between</button>
              </div>
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
                      {visibleAttractions.map(a => {
                        const category = a.category || "Other";
                        const colorFor = (cat) => {
                          if (!cat) return '#6b7280';
                          const c = String(cat).toLowerCase();
                          if (c.includes('park')) return '#10b981'; // green
                          if (c.includes('museum')) return '#3b82f6'; // blue
                          if (c.includes('amuse') || c.includes('ride')) return '#ef4444'; // red
                          if (c.includes('histor')) return '#f59e0b'; // amber
                          return '#6b7280'; // muted
                        };
                        const badgeStyle = { backgroundColor: colorFor(category) };

                        const isLocked = lockedIds.has(a.id);

                        return (
                          <li
                            key={a.id}
                            className={`attraction-item ${isLocked ? 'locked' : ''}`}
                            onDoubleClick={() => handleAttractionDoubleClick(a)}
                            title="Double-click for details"
                          >
                            <label>
                              <input 
                                type="checkbox" 
                                checked={selectedIds.has(a.id)} 
                                onChange={() => handleToggleSelect(a.id)} 
                              />
                              <span className="attraction-title">{a.name || a.title || a.id}</span>
                              <span className="cat-badge" style={badgeStyle}>{category}</span>
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
                        );
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

            {/* === END of your original planner UI === */}
          </div>
        )}
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