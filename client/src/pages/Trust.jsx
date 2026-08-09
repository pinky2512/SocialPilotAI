import { useEffect, useRef, useState } from 'react';
import { useSession } from '../session.jsx';
import { api } from '../api.js';

// STORY-025 — Trust Dashboard. One screen: system health, pending approvals,
// recent actions, and anomalies. Polls so it reflects live state.
const POLL_MS = 5000;
const HEALTH_TONE = { healthy: 'approved', attention: 'pending_approval', degraded: 'rejected' };

export default function Trust() {
  const { userId } = useSession();
  const [t, setT] = useState(null);
  const [error, setError] = useState('');
  const timer = useRef(null);

  async function load() {
    try {
      const { trust } = await api.trust(userId);
      setT(trust);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
    timer.current = setInterval(load, POLL_MS);
    return () => clearInterval(timer.current);
  }, [userId]);

  if (error) return <section className="panel"><div className="error">{error}</div></section>;
  if (!t) return <section className="panel"><p className="hint">Loading trust snapshot…</p></section>;

  return (
    <div>
      <section className="panel">
        <div className="card-head">
          <h2>System health <span className="live-dot on" /></h2>
          <span className={`status status-${HEALTH_TONE[t.health.status] || 'draft'}`} style={{ fontSize: 13 }}>
            {t.health.status}
          </span>
        </div>
        <p className="hint">Updated {new Date(t.generatedAt).toLocaleTimeString()} · auto-refresh {POLL_MS / 1000}s</p>
        <div className="kpis">
          <Kpi label="Pending approvals" value={t.pendingApprovals.count} />
          <Kpi label="Agent tasks" value={t.health.agentTasks.total} />
          <Kpi label="Task failure rate" value={`${t.health.failureRate}%`} />
          <Kpi label="Anomalies" value={t.anomalies.length} />
        </div>
      </section>

      <section className="panel">
        <h2>Anomalies</h2>
        <p className="hint">Things routed to a human: failed agent tasks, denied access, integration errors.</p>
        {t.anomalies.length === 0 && <p className="hint">No anomalies. ✅</p>}
        <ul className="rec-list">
          {t.anomalies.map((a, i) => (
            <li key={i}>
              <span className="status status-rejected">{a.type.replace(/_/g, ' ')}</span>
              <strong> {a.message}</strong>
              <div className="hint">{a.at}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Pending approvals</h2>
        {t.pendingApprovals.count === 0 && <p className="hint">Nothing waiting. 🎉</p>}
        <table className="audit">
          <thead><tr><th>#</th><th>Kind</th><th>Preview</th></tr></thead>
          <tbody>
            {t.pendingApprovals.items.map((p) => (
              <tr key={p.approval_id}>
                <td>{p.approval_id}</td>
                <td><span className="tag">{p.kind}</span></td>
                <td className="details">{p.preview}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Recent actions</h2>
        <table className="audit">
          <thead><tr><th>#</th><th>Action</th><th>User</th><th>When</th></tr></thead>
          <tbody>
            {t.recentActions.map((e) => (
              <tr key={e.id}>
                <td>{e.id}</td>
                <td><span className="tag">{e.action}</span></td>
                <td>{e.user_id ?? 'system/agent'}</td>
                <td className="muted">{e.timestamp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Kpi({ label, value }) {
  return (
    <div className="kpi">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}
