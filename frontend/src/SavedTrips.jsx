import React, { useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import { listTrips, createTrip, deleteTrip } from './api';

export default function SavedTrips({ currentSelection, onLoadTrip, onClose }){
  const { token } = useAuth();
  const [rows, setRows] = useState([]);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    listTrips(token)
      .then(r => setRows(r.rows))
      .catch(e => console.error("Failed to list trips:", e))
      .finally(() => setLoading(false));
  };
  useEffect(() => { refresh(); }, [token]);

  async function handleSave(){
    setSaving(true);
    try {
        const trip = {
            title: title || 'My Trip',
            start: currentSelection.start ?? null,
            end: currentSelection.end ?? null,
            radius_km: currentSelection.radius_km ?? null,
            limit: currentSelection.limit ?? null,
            categories: currentSelection.categories ?? [],
            trashed_ids: currentSelection.trashed_ids ?? [],
            attractions: (currentSelection.attractions || []).map((a, i) => ({
            id: a.id,
            locked: !!a.locked,
            position: a.position ?? i,
            })),
        };
        await createTrip(token, trip);
        setTitle('');
        await refresh();
        // --- NEW: Close modal on successful save ---
        if (onClose) onClose(); 
        // --- END NEW ---
    } catch(e) {
        alert(e.message || "Failed to save trip.");
    } finally {
        setSaving(false);
    }
  }
  
  // Wrapped onLoadTrip handler to close the modal
  const handleLoad = async (tripId) => {
    try {
        await onLoadTrip(tripId);
        if (onClose) onClose(); // Close the modal after successfully loading
    } catch(e) {
        alert(e.message || "Failed to load trip.");
    }
  }


  return (
    // Replaced outer div with card content
    <div className="saved-trips-content"> 
      <h2 style={{marginTop:0}}>Saved Trips</h2>
      <div className="inputs" style={{margin:'8px 0'}}>
        <input className="input" placeholder="Trip title" value={title} onChange={e=>setTitle(e.target.value)} />
        <button className="btn primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save current'}
        </button>
      </div>
      
      {loading && <p>Loading trips...</p>}
      
      {!loading && rows.length === 0 ? <p>No trips yet.</p> :
        !loading && (
        <ul className="attraction-list">
          {rows.map(t => (
            <li key={t.id} className="attraction-item attraction-card">
              <span style={{fontWeight:600}}>{t.title}</span>
              <div className="card-footer-actions">
                <button className="item-btn" onClick={()=>handleLoad(t.id)}>📥 Load</button>
                <button className="item-btn trash" onClick={()=>deleteTrip(token, t.id).then(refresh)}>🗑️</button>
              </div>
            </li>
          ))}
        </ul>
        )
      }
    </div>
  );
}