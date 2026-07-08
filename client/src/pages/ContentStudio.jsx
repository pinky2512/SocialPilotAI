import { useEffect, useState } from 'react';
import { useSession } from '../session.jsx';
import { api } from '../api.js';

// STORY-001 (generate) + STORY-003 (seamless editing) + STORY-002 (submit).
export default function ContentStudio() {
  const { userId } = useSession();
  const [prompt, setPrompt] = useState('');
  const [platform, setPlatform] = useState('twitter');
  const [tone, setTone] = useState('professional');
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const { content } = await api.listContent(userId);
      setItems(content);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
  }, [userId]);

  async function onGenerate(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.generateContent(userId, { prompt, platform, tone });
      setPrompt('');
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="studio">
      <section className="panel">
        <h2>Generate a draft</h2>
        <p className="hint">
          The Content Generation Agent drafts content. Nothing publishes — every draft is held for
          human approval.
        </p>
        <form onSubmit={onGenerate} className="gen-form">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should this post be about?"
            rows={3}
            required
          />
          <div className="row">
            <label>
              Platform
              <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
                <option value="twitter">Twitter/X</option>
                <option value="linkedin">LinkedIn</option>
                <option value="instagram">Instagram</option>
                <option value="facebook">Facebook</option>
                <option value="generic">Generic</option>
              </select>
            </label>
            <label>
              Tone
              <select value={tone} onChange={(e) => setTone(e.target.value)}>
                <option value="professional">Professional</option>
                <option value="friendly">Friendly</option>
              </select>
            </label>
            <button type="submit" disabled={busy || !prompt.trim()}>
              {busy ? 'Generating…' : 'Generate draft'}
            </button>
          </div>
        </form>
        {error && <div className="error">{error}</div>}
      </section>

      <section className="panel">
        <h2>Your content</h2>
        {items.length === 0 && <p className="hint">No content yet — generate a draft above.</p>}
        <div className="cards">
          {items.map((c) => (
            <DraftCard key={c.id} item={c} userId={userId} onChanged={refresh} />
          ))}
        </div>
      </section>
    </div>
  );
}

function DraftCard({ item, userId, onChanged }) {
  const [text, setText] = useState(item.content_text);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setText(item.content_text), [item.content_text]);

  const editable = ['draft', 'rejected', 'pending_approval'].includes(item.status);

  async function save() {
    setError('');
    try {
      await api.editContent(userId, item.id, text);
      setEditing(false);
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  async function submit() {
    setError('');
    try {
      await api.submitForApproval(userId, item.id);
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className={`status status-${item.status}`}>{item.status.replace('_', ' ')}</span>
        <span className="cid">#{item.id}</span>
      </div>
      {editing ? (
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} />
      ) : (
        <p className="body">{item.content_text}</p>
      )}
      {error && <div className="error">{error}</div>}
      <div className="card-actions">
        {editable && !editing && (
          <button onClick={() => setEditing(true)}>Edit</button>
        )}
        {editing && (
          <>
            <button onClick={save} disabled={!text.trim()}>Save</button>
            <button className="ghost" onClick={() => { setEditing(false); setText(item.content_text); }}>
              Cancel
            </button>
          </>
        )}
        {['draft', 'rejected'].includes(item.status) && !editing && (
          <button className="primary" onClick={submit}>Submit for approval</button>
        )}
      </div>
    </div>
  );
}
