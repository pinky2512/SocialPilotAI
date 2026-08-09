import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useSession } from './session.jsx';
import { api } from './api.js';
import Notifications from './pages/Notifications.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ContentStudio from './pages/ContentStudio.jsx';
import ApprovalQueue from './pages/ApprovalQueue.jsx';
import Social from './pages/Social.jsx';
import Email from './pages/Email.jsx';
import Analytics from './pages/Analytics.jsx';
import Audience from './pages/Audience.jsx';
import Trust from './pages/Trust.jsx';
import AuditLog from './pages/AuditLog.jsx';

export default function App() {
  const { user, users, setUserId, userId } = useSession();
  const [unread, setUnread] = useState(0);

  // STORY-030 — poll the acting user's unread notification count.
  useEffect(() => {
    let alive = true;
    const load = () => api.notifications(userId, true)
      .then((r) => alive && setUnread(r.unread))
      .catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => { alive = false; clearInterval(t); };
  }, [userId]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◆</span> Social Pilot <span className="ai">AI</span>
        </div>
        <nav className="nav">
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/studio">Content Studio</NavLink>
          <NavLink to="/social">Social</NavLink>
          <NavLink to="/email">Email</NavLink>
          <NavLink to="/analytics">Analytics</NavLink>
          <NavLink to="/audience">Audience</NavLink>
          <NavLink to="/approvals">Approval Queue</NavLink>
          <NavLink to="/trust">Trust</NavLink>
          <NavLink to="/audit">Audit Log</NavLink>
        </nav>
        <NavLink to="/notifications" className="bell" title="Notifications">
          🔔{unread > 0 && <span className="badge">{unread}</span>}
        </NavLink>
        <div className="who">
          <label>Acting as&nbsp;</label>
          <select value={user.id} onChange={(e) => setUserId(Number(e.target.value))}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.role}
              </option>
            ))}
          </select>
        </div>
      </header>

      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/studio" element={<ContentStudio />} />
          <Route path="/social" element={<Social />} />
          <Route path="/email" element={<Email />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/audience" element={<Audience />} />
          <Route path="/trust" element={<Trust />} />
          <Route path="/approvals" element={<ApprovalQueue />} />
          <Route path="/audit" element={<AuditLog />} />
          <Route path="/notifications" element={<Notifications />} />
        </Routes>
      </main>

      <footer className="foot">
        Trust Before Intelligence — every AI action is drafted, held for human approval, and audited.
      </footer>
    </div>
  );
}
