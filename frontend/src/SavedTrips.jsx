import React, { useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import { listTrips, createTrip, deleteTrip } from './api';

export default function SavedTrips({ currentSelection, onLoadTrip }){
  const { token } = useAuth();
  const [rows, setRows] = useState([]);
  const [title, setTitle] = useState('');

  const refresh = () => listTrips(token).then(r => setRows(r.rows));
  useEffect(() => { refresh(); }, []);

  async function handleSave(){
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
    refresh();
}


  return (
    <div className="card" style={{maxWidth:900, margin:'20px auto'}}>
      <h2 style={{marginTop:0}}>Saved Trips</h2>
      <div className="inputs" style={{margin:'8px 0'}}>
        <input className="input" placeholder="Trip title" value={title} onChange={e=>setTitle(e.target.value)} />
        <button className="btn primary" onClick={handleSave}>Save current</button>
      </div>
      {rows.length === 0 ? <p>No trips yet.</p> :
        <ul className="attraction-list">
          {rows.map(t => (
            <li key={t.id} className="attraction-item">
              <span style={{fontWeight:600}}>{t.title}</span>
              <div className="item-controls">
                <button className="item-btn" onClick={()=>onLoadTrip(t.id)}>📥 Load</button>
                <button className="item-btn trash" onClick={()=>deleteTrip(token, t.id).then(refresh)}>🗑️</button>
              </div>
            </li>
          ))}
        </ul>
      }
    </div>
  );
}
