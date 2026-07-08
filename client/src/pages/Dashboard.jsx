import { useEffect, useRef, useState } from 'react';
import { useSession } from '../session.jsx';
import { api } from '../api.js';

// STORY-018 — Real-Time Metrics Dashboard. Polls the dashboard snapshot every
// few seconds so metrics update live as engagement arrives. STORY-017 predicted
// rates are shown alongside actuals.
const POLL_MS = 5000;

export default function Dashboard() {
  const { userId } = useSession();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [live, setLive] = useState(true);
  const timer = useRef(null);

  async function load() {
    try {
      const { dashboard } = await api.dashboard(userId);
      setD(dashboard);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
    if (live) {
      timer.current = setInterval(load, POLL_MS);
      return () => clearInterval(timer.current);
    }
  }, [userId, live]);

  return (
    <div>
      <section className="panel">
        <div className="card-head">
          <h2>
            Real-time metrics{' '}
            <span className={`live-dot ${live ? 'on' : ''}`} title={live ? 'live' : 'paused'} />
          </h2>
          <div className="card-actions">
            <button onClick={() => setLive((v) => !v)}>{live ? 'Pause' : 'Resume'} live</button>
            <button onClick={load}>Refresh</button>
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        {d && (
          <>
            <p className="hint">Updated {new Date(d.generatedAt).toLocaleTimeString()} · auto-refresh every {POLL_MS / 1000}s</p>
            <div className="kpis">
              <Kpi label="Campaigns" value={d.totals.campaigns} />
              <Kpi label="Sent" value={d.totals.sent} />
              <Kpi label="Pending approval" value={d.totals.pendingApproval} />
              <Kpi label="Leads" value={d.totals.leads} />
              <Kpi label="Delivered" value={d.totals.delivered} />
              <Kpi label="Open rate" value={`${d.overallRates.openRate}%`} />
              <Kpi label="Click rate" value={`${d.overallRates.clickRate}%`} />
            </div>
          </>
        )}
      </section>

      {d && (
        <section className="panel">
          <h2>Per-campaign performance & forecast</h2>
          <table className="audit">
            <thead>
              <tr><th>Campaign</th><th>Status</th><th>Delivered</th><th>Open %</th><th>Click %</th><th>Predicted open %</th></tr>
            </thead>
            <tbody>
              {d.campaigns.map((c) => (
                <tr key={c.campaignId}>
                  <td>{c.name}</td>
                  <td><span className={`status status-${c.status}`}>{c.status.replace('_', ' ')}</span></td>
                  <td>{c.delivered}</td>
                  <td>{c.openRate}%</td>
                  <td>{c.clickRate}%</td>
                  <td className="muted">{c.predicted.openRate}%</td>
                </tr>
              ))}
              {d.campaigns.length === 0 && <tr><td colSpan={6} className="muted">No campaigns yet.</td></tr>}
            </tbody>
          </table>
        </section>
      )}
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
