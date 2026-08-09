import { useEffect, useState } from 'react';
import { useSession } from '../session.jsx';
import { api } from '../api.js';

// STORY-013 — Visualize Email Engagement Metrics. KPI tiles + labeled meter
// bars per campaign, driven by the Analytics Agent's metrics endpoint.
export default function Analytics() {
  const { userId, can } = useSession();
  const canIngest = can('analytics:ingest');
  const [metrics, setMetrics] = useState([]);
  const [forecasts, setForecasts] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setError('');
    try {
      const [{ metrics }, { insights }] = await Promise.all([
        api.emailMetrics(userId),
        api.predictAll(userId),
      ]);
      setMetrics(metrics);
      setForecasts(insights);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
  }, [userId]);

  // Demo helper: fabricate a realistic batch of engagement events for a sent
  // campaign so the visualization has data. (In production these arrive from the
  // ESP webhook.)
  async function simulate(campaignId) {
    setBusy(true);
    setError('');
    try {
      const events = [];
      const N = 50;
      for (let i = 0; i < N; i++) {
        const r = `user${i}@example.com`;
        events.push({ campaignId, recipient: r, eventType: 'delivered' });
        if (i % 5 !== 0) events.push({ campaignId, recipient: r, eventType: 'open' }); // ~80% open
        if (i % 3 === 0) events.push({ campaignId, recipient: r, eventType: 'click' }); // ~33% click
        if (i % 25 === 0) events.push({ campaignId, recipient: r, eventType: 'bounce' });
      }
      await api.ingestEngagement(userId, events);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
    <section className="panel">
      <div className="card-head">
        <h2>Email engagement analytics</h2>
        <button onClick={refresh}>Refresh</button>
      </div>
      <p className="hint">Per-campaign engagement metrics tracked by the Analytics Agent.</p>
      {error && <div className="error">{error}</div>}
      {metrics.length === 0 && <p className="hint">No campaigns yet — create one on the Email page.</p>}

      {metrics.map((m) => (
        <div className="metric-block" key={m.campaignId}>
          <div className="card-head">
            <h3>{m.name} <span className={`status status-${m.status}`}>{m.status.replace('_', ' ')}</span></h3>
            {canIngest && (
              <button className="ghost" disabled={busy} onClick={() => simulate(m.campaignId)}>
                Simulate engagement
              </button>
            )}
          </div>

          <div className="kpis">
            <Kpi label="Delivered" value={m.counts.delivered} />
            <Kpi label="Unique opens" value={m.counts.uniqueOpens} />
            <Kpi label="Unique clicks" value={m.counts.uniqueClicks} />
            <Kpi label="Bounces" value={m.counts.bounces} />
            <Kpi label="Unsubscribes" value={m.counts.unsubscribes} />
          </div>

          <div className="meters">
            <Meter label="Open rate" pct={m.rates.openRate} tone="good" />
            <Meter label="Click rate" pct={m.rates.clickRate} tone="accent" />
            <Meter label="Bounce rate" pct={m.rates.bounceRate} tone="bad" />
            <Meter label="Unsubscribe rate" pct={m.rates.unsubscribeRate} tone="warn" />
          </div>
        </div>
      ))}
    </section>

    <section className="panel">
      <h2>Predictive forecast &amp; explainability</h2>
      <p className="hint">Each forecast explains itself — the factors and formula behind the number.</p>
      {forecasts.length === 0 && <p className="hint">No campaigns to forecast yet.</p>}
      {forecasts.map((f) => (
        <div className="metric-block" key={f.campaignId}>
          <div className="card-head">
            <h3>{f.name}</h3>
            <span className={`status status-${f.confidence === 'high' ? 'approved' : f.confidence === 'medium' ? 'pending_approval' : 'draft'}`} style={{ fontSize: 12 }}>
              {f.confidence} confidence
            </span>
          </div>
          <div className="kpis">
            <Kpi label="Predicted open %" value={`${f.predicted.openRate}%`} />
            <Kpi label="Predicted click %" value={`${f.predicted.clickRate}%`} />
            <Kpi label="Projected opens" value={f.projected.opens} />
            <Kpi label="Trend" value={f.trend.replace('-', ' ')} />
          </div>
          <details className="explain">
            <summary>Why this prediction?</summary>
            <p className="hint">{f.explanation.summary}</p>
            <p className="hint"><em>{f.explanation.method}</em></p>
            <table className="audit">
              <thead><tr><th>Factor</th><th>Value</th><th>Detail</th></tr></thead>
              <tbody>
                {f.explanation.factors.map((x, i) => (
                  <tr key={i}><td>{x.label}</td><td>{x.value}</td><td className="muted">{x.detail}</td></tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      ))}
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

function Meter({ label, pct, tone }) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div className="meter-row">
      <div className="meter-label">{label}</div>
      <div className="meter-track" role="img" aria-label={`${label}: ${pct}%`}>
        <div className={`meter-fill meter-${tone}`} style={{ width: `${width}%` }} />
      </div>
      <div className="meter-pct">{pct}%</div>
    </div>
  );
}
