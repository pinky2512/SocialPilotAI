import { useState } from 'react';
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
    </section>
  );
}
