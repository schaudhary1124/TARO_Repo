import React, { useState } from 'react';
import { useAuth } from './AuthProvider';
import { reportIssue } from './api';

export default function IssueReporter({ onClose, prefill }){
  const { token } = useAuth();
  const [subject, setSubject] = useState(prefill?.subject || '');
  const [body, setBody] = useState(prefill?.body || '');

  async function submit(){
    await reportIssue(token, subject || 'Issue', { body, context: prefill?.context || {} });
    alert('Thanks! Issue submitted.');
    onClose?.();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={e=>e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose}>×</button>
        <h3>Report an Issue</h3>
        <input className="input" placeholder="Subject" value={subject} onChange={e=>setSubject(e.target.value)} />
        <textarea className="input" rows={6} placeholder="Describe the problem…" value={body} onChange={e=>setBody(e.target.value)} />
        <div className="button-group" style={{marginTop:12}}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit}>Submit</button>
        </div>
      </div>
    </div>
  );
}
