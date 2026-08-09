import { useEffect, useState } from 'react';
import { useSession } from '../session.jsx';
import { api } from '../api.js';

// STORY-030 — per-user notification inbox (e.g. content pending your approval).
export default function Notifications() {
  const { userId } = useSession();
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');

  async function refresh() {
    try {
      const { notifications } = await api.notifications(userId);
      setItems(notifications);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
  }, [userId]);

  async function readOne(id) {
    await api.markNotificationRead(userId, id);
    refresh();
  }
  async function readAll() {
    await api.markAllNotificationsRead(userId);
    refresh();
  }

  return (
    <section className="panel">
      <div className="card-head">
        <h2>Notifications</h2>
        <button onClick={readAll}>Mark all read</button>
      </div>
      {error && <div className="error">{error}</div>}
      {items.length === 0 && <p className="hint">No notifications.</p>}
      <ul className="rec-list">
        {items.map((n) => (
          <li key={n.id} style={{ opacity: n.is_read ? 0.55 : 1 }}>
            <span className={`status status-${n.is_read ? 'draft' : 'pending_approval'}`}>
              {n.is_read ? 'read' : 'new'}
            </span>
            <strong> {n.message}</strong>
            <div className="hint">
              {n.entity_type ? `${n.entity_type} #${n.entity_id} · ` : ''}{n.created_at}
              {!n.is_read && <button className="ghost" style={{ marginLeft: 8 }} onClick={() => readOne(n.id)}>Mark read</button>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
