import { useEffect, useState } from 'react';
import { useSession } from '../session.jsx';
import { api } from '../api.js';

// STORY-014 (scores) + STORY-015 (segments). Rescore leads from engagement,
// segment the audience, and view leads ranked by score with their segment.
const SEGMENT_TONE = { hot: 'approved', warm: 'pending_approval', cold: 'draft', dormant: 'rejected' };

export default function Audience() {
  const { userId } = useSession();
  const [leads, setLeads] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const { leads } = await api.listLeads(userId);
      setLeads(leads);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
  }, [userId]);

  async function rescore() {
    setBusy(true); setError('');
    try {
      await api.scoreAllLeads(userId);
      await refresh();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function segment() {
    setBusy(true); setError('');
    try {
      const res = await api.segmentAudience(userId);
      setSummary(res.segments);
      await refresh();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <section className="panel">
      <div className="card-head">
        <h2>Audience & lead scoring</h2>
        <div className="card-actions">
          <button disabled={busy} onClick={rescore}>Rescore from engagement</button>
          <button className="primary" disabled={busy} onClick={segment}>Segment audience</button>
        </div>
      </div>
      <p className="hint">
        Lead scores are derived from email engagement; segments group leads by score band for targeting.
      </p>
      {error && <div className="error">{error}</div>}

      {summary && (
        <div className="kpis">
          {Object.entries(summary).map(([name, count]) => (
            <div className="kpi" key={name}>
              <div className="kpi-value">{count}</div>
              <div className="kpi-label" style={{ textTransform: 'capitalize' }}>{name}</div>
            </div>
          ))}
        </div>
      )}

      <table className="audit">
        <thead>
          <tr><th>Lead</th><th>Score</th><th>Segment</th></tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr key={l.id}>
              <td>{l.email}{l.name ? ` (${l.name})` : ''}</td>
              <td>
                <div className="meter-row" style={{ gridTemplateColumns: '1fr 40px' }}>
                  <div className="meter-track">
                    <div className="meter-fill meter-accent" style={{ width: `${l.score}%` }} />
                  </div>
                  <div className="meter-pct">{l.score}</div>
                </div>
              </td>
              <td>{l.segment ? <span className={`status status-${SEGMENT_TONE[l.segment] || 'draft'}`}>{l.segment}</span> : <span className="muted">—</span>}</td>
            </tr>
          ))}
          {leads.length === 0 && (
            <tr><td colSpan={3} className="muted">No leads yet — simulate engagement on the Analytics page, then Rescore.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
