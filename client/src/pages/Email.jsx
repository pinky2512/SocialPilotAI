import { useEffect, useState } from 'react';
import { useSession } from '../session.jsx';
import { api } from '../api.js';

// STORY-011 — Email campaigns: create a draft, schedule it (held for approval),
// and send once approved. Actions are gated by email permissions.
export default function Email() {
  const { userId, can } = useSession();
  const [campaigns, setCampaigns] = useState([]);
  const [error, setError] = useState('');

  async function refresh() {
    try {
      const { campaigns } = await api.listCampaigns(userId);
      setCampaigns(campaigns);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
  }, [userId]);

  return (
    <div>
      {error && <div className="error">{error}</div>}
      {can('email:create') ? (
        <CreateForm userId={userId} onChanged={refresh} />
      ) : (
        <section className="panel"><p className="hint">Your role can view campaigns but not create them.</p></section>
      )}
      <section className="panel">
        <h2>Campaigns</h2>
        <p className="hint">Campaigns are held for human approval before sending — nothing goes out automatically.</p>
        {campaigns.length === 0 && <p className="hint">No campaigns yet.</p>}
        <div className="cards">
          {campaigns.map((c) => (
            <Campaign key={c.id} c={c} userId={userId} onChanged={refresh} />
          ))}
        </div>
      </section>
    </div>
  );
}

function CreateForm({ userId, onChanged }) {
  const [form, setForm] = useState({ name: '', subject: '', body: '', audience: 'all-subscribers' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function create(e) {
    e.preventDefault();
    setError('');
    try {
      await api.createCampaign(userId, form);
      setForm({ name: '', subject: '', body: '', audience: 'all-subscribers' });
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <section className="panel">
      <h2>Create an email campaign</h2>
      <form onSubmit={create} className="gen-form">
        <div className="row">
          <label style={{ flex: 1 }}>Name<input value={form.name} onChange={set('name')} required /></label>
          <label style={{ flex: 1 }}>Audience<input value={form.audience} onChange={set('audience')} /></label>
        </div>
        <label>Subject<input value={form.subject} onChange={set('subject')} required style={{ width: '100%' }} /></label>
        <textarea placeholder="Email body…" value={form.body} onChange={set('body')} rows={4} required />
        <div className="card-actions">
          <button className="primary" type="submit">Create draft</button>
        </div>
      </form>
      {error && <div className="error">{error}</div>}
    </section>
  );
}

function Campaign({ c, userId, onChanged }) {
  const { can } = useSession();
  const [error, setError] = useState('');

  async function schedule() {
    setError('');
    try {
      await api.scheduleCampaign(userId, c.id, null);
      onChanged();
    } catch (e) { setError(e.message); }
  }
  async function send() {
    setError('');
    try {
      await api.sendCampaign(userId, c.id);
      onChanged();
    } catch (e) { setError(e.message); }
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className={`status status-${c.status}`}>{c.status.replace('_', ' ')}</span>
        <span className="cid">#{c.id}</span>
      </div>
      <p className="body"><strong>{c.name}</strong><br />{c.subject}</p>
      <p className="hint">Audience: {c.audience || '—'}{c.scheduled_at ? ` · scheduled ${c.scheduled_at}` : ''}</p>
      {error && <div className="error">{error}</div>}
      <div className="card-actions">
        {['draft', 'rejected'].includes(c.status) && can('email:create') && (
          <button onClick={schedule}>Submit for approval</button>
        )}
        {c.status === 'approved' && can('email:send') && (
          <button className="primary" onClick={send}>Send now</button>
        )}
      </div>
    </div>
  );
}
