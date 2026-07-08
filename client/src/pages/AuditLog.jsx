import { useEffect, useState } from 'react';
import { useSession } from '../session.jsx';
import { api } from '../api.js';

// Read-only view of the append-only audit log (STORY-009 surface). Every
// meaningful action across the system is recorded here and can never be edited
// or deleted. Filter by category to focus the trail.
const FILTERS = [
  { label: 'All', value: '' },
  { label: 'Content', value: 'content.' },
  { label: 'Approvals', value: 'approval.' },
  { label: 'Social', value: 'social.' },
  { label: 'Governance', value: 'governance.' },
];

export default function AuditLog() {
  const { userId } = useSession();
  const [entries, setEntries] = useState([]);
  const [prefix, setPrefix] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    setError('');
    try {
      const { entries } = await api.audit(userId, { prefix: prefix || undefined, limit: 200 });
      setEntries(entries);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
  }, [userId, prefix]);

  return (
    <section className="panel">
      <div className="card-head">
        <h2>Audit log</h2>
        <button onClick={refresh}>Refresh</button>
      </div>
      <p className="hint">
        Append-only record of every meaningful action (who · what · when · details). Immutable — entries can
        never be edited or deleted.
      </p>
      <div className="chips">
        {FILTERS.map((f) => (
          <button key={f.value} className={prefix === f.value ? 'chip on' : 'chip'} onClick={() => setPrefix(f.value)}>
            {f.label}
          </button>
        ))}
      </div>
      {error && <div className="error">{error}</div>}
      <table className="audit">
        <thead>
          <tr>
            <th>#</th>
            <th>Action</th>
            <th>User</th>
            <th>When</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{e.id}</td>
              <td><span className="tag">{e.action}</span></td>
              <td>{e.user_id ?? 'system/agent'}</td>
              <td className="muted">{e.timestamp}</td>
              <td className="details">{summarize(e.details)}</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr><td colSpan={5} className="muted">No audit entries yet — generate and approve some content.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function summarize(details) {
  if (!details || typeof details !== 'object') return '';
  const parts = [];
  for (const [k, v] of Object.entries(details)) {
    if (v == null) continue;
    let val = typeof v === 'string' ? v : JSON.stringify(v);
    if (val.length > 40) val = val.slice(0, 40) + '…';
    parts.push(`${k}: ${val}`);
  }
  return parts.join(' · ');
}
