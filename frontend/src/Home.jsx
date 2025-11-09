import React from 'react';
import { useAuth } from './AuthProvider';

export default function Home({ onEnterPlanner, onOpenTrips, onOpenAISearch, onOpenAccount }){
  const { user } = useAuth();
  return (
    <div className="card" style={{maxWidth: 900, margin: '20px auto'}}>
      <h1 style={{marginTop:0}}>TARO</h1>
      <p>Plan great routes between your start and end points. Save trips when signed in.</p>
      <div className="button-group" style={{marginTop: 8}}>
        <button className="btn primary" onClick={onEnterPlanner}>Open Planner</button>
        <button className="btn" onClick={onOpenTrips} disabled={!user || user.guest}>Saved Trips</button>
        <button className="btn" onClick={onOpenAISearch}>AI Search</button>
        <button className="btn" onClick={onOpenAccount}>{user && !user.guest ? 'Account' : 'Sign in'}</button>
      </div>
    </div>
  );
}
