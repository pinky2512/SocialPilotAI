import { useEffect, useState } from 'react';
import { useSession } from '../session.jsx';
import { api } from '../api.js';

// R1 — Social Media: connect accounts (STORY-004), schedule multi-platform posts
// with per-platform preview (STORY-005/006), and publish approved posts (STORY-007).
export default function Social() {
  const { userId, user, permissions } = useSession();
  const [accounts, setAccounts] = useState([]);
  const [content, setContent] = useState([]);
  const [posts, setPosts] = useState([]);
  const [error, setError] = useState('');

  async function refresh() {
    try {
      const [a, c, p] = await Promise.all([
        api.listAccounts(userId),
        api.listContent(userId),
        api.listPosts(userId),
      ]);
      setAccounts(a.accounts);
      setContent(c.content);
      setPosts(p.posts);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
  }, [userId]);

  return (
    <div>
      <div className="perms-banner">
        <strong>{user.role}</strong> permissions:{' '}
        {permissions.length ? permissions.map((p) => <span className="tag" key={p}>{p}</span>) : <em>none</em>}
      </div>
      {error && <div className="error">{error}</div>}
      <Accounts userId={userId} accounts={accounts} onChanged={refresh} />
      <Scheduler userId={userId} accounts={accounts} content={content} onChanged={refresh} />
      <Posts userId={userId} posts={posts} onChanged={refresh} />
    </div>
  );
}

function Accounts({ userId, accounts, onChanged }) {
  const { can } = useSession();
  const canConnect = can('social:connect');
  const [platform, setPlatform] = useState('twitter');
  const [handle, setHandle] = useState('');
  const [error, setError] = useState('');

  async function connect(e) {
    e.preventDefault();
    setError('');
    try {
      await api.connectAccount(userId, { platform, handle });
      setHandle('');
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <section className="panel">
      <h2>Connected accounts</h2>
      {canConnect ? (
        <form onSubmit={connect} className="row">
          <label>
            Platform
            <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="twitter">Twitter/X</option>
              <option value="linkedin">LinkedIn</option>
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
            </select>
          </label>
          <label>
            Handle
            <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@brand" required />
          </label>
          <button type="submit" disabled={!handle.trim()}>Connect</button>
        </form>
      ) : (
        <p className="hint">Your role can view accounts but not connect them.</p>
      )}
      {error && <div className="error">{error}</div>}
      <div className="cards">
        {accounts.map((a) => (
          <div className="card" key={a.id}>
            <div className="card-head">
              <span className={`status status-${a.status === 'connected' ? 'approved' : 'rejected'}`}>{a.status}</span>
              <span className="cid">{a.platform}</span>
            </div>
            <p className="body">{a.handle}</p>
            {a.status === 'connected' && canConnect && (
              <div className="card-actions">
                <button className="ghost" onClick={() => api.disconnectAccount(userId, a.id).then(onChanged)}>
                  Disconnect
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Scheduler({ userId, accounts, content, onChanged }) {
  const { can } = useSession();
  const [contentId, setContentId] = useState('');
  const [selected, setSelected] = useState([]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [previews, setPreviews] = useState([]);
  const [error, setError] = useState('');

  const canSchedule = can('social:schedule');
  const connected = accounts.filter((a) => a.status === 'connected');
  const chosenContent = content.find((c) => c.id === Number(contentId));

  useEffect(() => {
    if (!chosenContent) return setPreviews([]);
    const platforms = [...new Set(connected.filter((a) => selected.includes(a.id)).map((a) => a.platform))];
    if (platforms.length === 0) return setPreviews([]);
    api.preview(userId, chosenContent.content_text, platforms).then((r) => setPreviews(r.previews)).catch(() => {});
  }, [contentId, selected.join(','), userId]);

  function toggle(id) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function schedule() {
    setError('');
    try {
      await api.schedulePost(userId, {
        contentId: Number(contentId),
        accountIds: selected,
        scheduledAt: scheduledAt || null,
      });
      setSelected([]);
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  if (!canSchedule) {
    return (
      <section className="panel">
        <h2>Schedule a multi-platform post</h2>
        <p className="hint">Your role does not have permission to schedule posts.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Schedule a multi-platform post</h2>
      <p className="hint">Posts are adapted per platform and held for approval before publishing.</p>
      <div className="row">
        <label>
          Content
          <select value={contentId} onChange={(e) => setContentId(e.target.value)}>
            <option value="">Select content…</option>
            {content.map((c) => (
              <option key={c.id} value={c.id}>#{c.id} · {c.content_text.slice(0, 40)}…</option>
            ))}
          </select>
        </label>
        <label>
          Publish at (optional)
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </label>
      </div>
      <div className="chips">
        {connected.map((a) => (
          <button
            key={a.id}
            className={selected.includes(a.id) ? 'chip on' : 'chip'}
            onClick={() => toggle(a.id)}
          >
            {a.platform} · {a.handle}
          </button>
        ))}
        {connected.length === 0 && <span className="hint">Connect an account first.</span>}
      </div>
      {previews.length > 0 && (
        <div className="cards">
          {previews.map((p) => (
            <div className="card" key={p.platform}>
              <div className="card-head">
                <span className="status status-draft">{p.platform}</span>
                <span className="cid">{p.adapted.length} chars</span>
              </div>
              <p className="body">{p.adapted}</p>
              {!p.validation.ok && <div className="error">{p.validation.issues.join('; ')}</div>}
            </div>
          ))}
        </div>
      )}
      {error && <div className="error">{error}</div>}
      <div className="card-actions">
        <button className="primary" disabled={!contentId || selected.length === 0} onClick={schedule}>
          Schedule for approval
        </button>
      </div>
    </section>
  );
}

function Posts({ userId, posts, onChanged }) {
  const { can } = useSession();
  const canPublish = can('social:publish');
  return (
    <section className="panel">
      <div className="card-head">
        <h2>Posts</h2>
        {canPublish && (
          <button onClick={() => api.publishDue(userId).then(onChanged)}>Publish due (approved)</button>
        )}
      </div>
      {posts.length === 0 && <p className="hint">No posts yet.</p>}
      <div className="cards">
        {posts.map((p) => (
          <div className="card" key={p.id}>
            <div className="card-head">
              <span className={`status status-${p.status}`}>{p.status.replace('_', ' ')}</span>
              <span className="cid">{p.platform} #{p.id}</span>
            </div>
            <p className="body">{p.post_text}</p>
            {p.scheduled_at && <p className="hint">Scheduled: {p.scheduled_at}</p>}
            {p.status === 'approved' && canPublish && (
              <div className="card-actions">
                <button className="primary" onClick={() => api.publishPost(userId, p.id).then(onChanged)}>
                  Publish now
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
