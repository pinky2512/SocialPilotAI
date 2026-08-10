import { useEffect, useState } from 'react';
import { useSession } from '../session.jsx';
import { api } from '../api.js';

// STORY-033 — GDPR/CCPA data-subject rights (Administrator only): export or
// erase all personal data held for a contact, identified by email.
export default function Privacy() {
  const { userId, can } = useSession();
  const allowed = can('privacy:manage');
  const [subject, setSubject] = useState('');
  const [result, setResult] = useState(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  if (!allowed) {
    return (
      <section className="panel">
        <h2>Privacy &amp; data rights</h2>
        <p className="hint">Only an Administrator can export or erase personal data.</p>
      </section>
    );
  }

  async function doExport() {
    setError(''); setMsg(''); setResult(null);
    try {
      const { export: data } = await api.privacyExport(userId, subject);
      setResult(data);
    } catch (e) { setError(e.message); }
  }

  async function doDelete() {
    setError(''); setMsg(''); setResult(null);
    if (!window.confirm(`Erase all personal data for "${subject}"? This anonymizes their records and cannot be undone.`)) return;
    try {
      const r = await api.privacyDelete(userId, subject);
      setMsg(`Erased: ${r.leadsAnonymized} lead, ${r.eventsAnonymized} engagement events, ${r.userAnonymized} user record anonymized (audited).`);
    } catch (e) { setError(e.message); }
  }

  function download() {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `data-export-${subject}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section className="panel">
      <h2>Privacy &amp; data rights (GDPR / CCPA)</h2>
      <p className="hint">
        Export or erase all personal data held for a contact. Erasure anonymizes their records; the
        append-only audit log is preserved (only a subject hash is kept). Every action is audited.
      </p>
      <div className="row">
        <label style={{ flex: 1 }}>
          Subject email
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="jane@example.com" />
        </label>
        <button onClick={doExport} disabled={!subject.trim()}>Export data</button>
        <button className="danger" onClick={doDelete} disabled={!subject.trim()}>Erase data</button>
      </div>
      {error && <div className="error">{error}</div>}
      {msg && <p className="hint" style={{ color: 'var(--accent-2)' }}>{msg}</p>}
      {result && (
        <div style={{ marginTop: 12 }}>
          <div className="card-actions"><button onClick={download}>Download JSON</button></div>
          <pre className="export-json">{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}

      <ExportRequests userId={userId} subject={subject} />
    </section>
  );
}

// STORY-035 — queued export requests, processed in a batch; results are stored.
function ExportRequests({ userId, subject }) {
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState('');

  async function refresh() {
    try {
      const { requests } = await api.privacyListRequests(userId);
      setRequests(requests);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { refresh(); }, [userId]);

  async function queue() {
    setError('');
    try { await api.privacyCreateRequest(userId, subject); refresh(); }
    catch (e) { setError(e.message); }
  }
  async function process() {
    setError('');
    try { await api.privacyProcessRequests(userId); refresh(); }
    catch (e) { setError(e.message); }
  }
  async function downloadResult(id, subj) {
    const { request } = await api.privacyGetRequest(userId, id);
    if (!request.result) return;
    const blob = new Blob([JSON.stringify(request.result, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `data-export-${subj}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div style={{ marginTop: 24, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
      <div className="card-head">
        <h3 style={{ margin: 0 }}>Queued export requests</h3>
        <div className="card-actions">
          <button onClick={queue} disabled={!subject.trim()}>Queue export for “{subject || '…'}”</button>
          <button className="primary" onClick={process}>Process pending</button>
        </div>
      </div>
      <p className="hint">Requests are queued and processed in a batch; results are stored so downloads don't recompute.</p>
      {error && <div className="error">{error}</div>}
      <table className="audit">
        <thead><tr><th>#</th><th>Subject</th><th>Status</th><th>Completed</th><th></th></tr></thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td>{r.subject}</td>
              <td><span className={`status status-${r.status === 'completed' ? 'approved' : r.status === 'failed' ? 'rejected' : 'pending_approval'}`}>{r.status}</span></td>
              <td className="muted">{r.completed_at || '—'}</td>
              <td>{r.status === 'completed' && <button className="ghost" onClick={() => downloadResult(r.id, r.subject)}>Download</button>}</td>
            </tr>
          ))}
          {requests.length === 0 && <tr><td colSpan={5} className="muted">No export requests yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
