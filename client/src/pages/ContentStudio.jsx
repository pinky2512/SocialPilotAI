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
  const [documents, setDocuments] = useState([]);
  const [documentId, setDocumentId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [learning, setLearning] = useState(null);

  async function refresh() {
    try {
      const [{ content }, { documents }, { learning }] = await Promise.all([
        api.listContent(userId),
        api.listDocuments(userId),
        api.feedbackSummary(userId),
      ]);
      setItems(content);
      setDocuments(documents);
      setLearning(learning);
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
      await api.generateContent(userId, { prompt, platform, tone, documentId: documentId || undefined });
      setPrompt('');
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Optional: upload a product brief/spec (PDF or text) to ground generation
  // for a new product the AI has no knowledge of.
  async function onUploadDoc(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const { document } = await api.uploadDocument(userId, { filename: file.name, mime: file.type, dataUrl });
      await refresh();
      setDocumentId(String(document.id)); // auto-select the just-uploaded doc
    } catch (err) {
      setError(err.message);
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
            <label>
              Ground on document (optional)
              <select value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
                <option value="">None</option>
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>#{d.id} · {d.filename}</option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={busy || !prompt.trim()}>
              {busy ? 'Generating…' : 'Generate draft'}
            </button>
          </div>
          <div className="card-actions">
            <label className="upload-btn">
              Upload product document (PDF/text)
              <input type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" onChange={onUploadDoc} disabled={busy} hidden />
            </label>
            {documentId && <span className="hint">✓ grounding on document #{documentId} — the AI will use only its facts.</span>}
          </div>
        </form>
        <p className="hint">New product the AI doesn't know? Upload its brief/spec sheet and the copy is written from those facts.</p>
        {error && <div className="error">{error}</div>}
      </section>

      {/* STORY-031 — AI learning from user feedback. 👍/👎 on each draft feeds
          this summary; the guidance below is injected into the NEXT generation. */}
      <section className="panel">
        <h2>Learning from feedback</h2>
        <p className="hint">
          Rate drafts with 👍 / 👎 below. Negative feedback becomes guidance that shapes future AI drafts.
        </p>
        {learning ? (
          <div>
            <div className="kpis">
              <div className="kpi"><div className="kpi-value">{learning.up}</div><div className="kpi-label">👍 Positive</div></div>
              <div className="kpi"><div className="kpi-value">{learning.down}</div><div className="kpi-label">👎 Negative</div></div>
              <div className="kpi"><div className="kpi-value">{learning.total}</div><div className="kpi-label">Total ratings</div></div>
            </div>
            <p className="hint" style={{ marginTop: 10 }}>
              <strong>Guidance applied to new drafts:</strong>{' '}
              {learning.guidance
                ? <span style={{ color: 'var(--accent-2)' }}>{learning.guidance}</span>
                : <em>none yet — give a 👎 with a comment to steer future drafts.</em>}
            </p>
          </div>
        ) : (
          <p className="hint">No feedback yet.</p>
        )}
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

  async function publish() {
    setError('');
    try {
      await api.publishContent(userId, item.id);
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  async function feedback(rating) {
    setError('');
    try {
      const comment = rating === 'down' ? (window.prompt('What was wrong? (helps future AI drafts)') || '') : '';
      await api.contentFeedback(userId, item.id, rating, comment);
      onChanged(); // refresh the "Learning from feedback" summary above
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
        {item.status === 'approved' && !editing && (
          <button className="primary" onClick={publish}>Publish</button>
        )}
        {!editing && (
          <span className="fb">
            <button className="ghost" title="Good draft" onClick={() => feedback('up')}>👍</button>
            <button className="ghost" title="Needs work — improves future drafts" onClick={() => feedback('down')}>👎</button>
          </span>
        )}
      </div>
    </div>
  );
}
