import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useSession } from './session.jsx';
import ContentStudio from './pages/ContentStudio.jsx';
import ApprovalQueue from './pages/ApprovalQueue.jsx';
import Social from './pages/Social.jsx';
import Email from './pages/Email.jsx';
import Analytics from './pages/Analytics.jsx';
import Audience from './pages/Audience.jsx';
import AuditLog from './pages/AuditLog.jsx';

export default function App() {
  const { user, users, setUserId } = useSession();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◆</span> Social Pilot <span className="ai">AI</span>
        </div>
        <nav className="nav">
          <NavLink to="/studio">Content Studio</NavLink>
          <NavLink to="/social">Social</NavLink>
          <NavLink to="/email">Email</NavLink>
          <NavLink to="/analytics">Analytics</NavLink>
          <NavLink to="/audience">Audience</NavLink>
          <NavLink to="/approvals">Approval Queue</NavLink>
          <NavLink to="/audit">Audit Log</NavLink>
        </nav>
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
          <Route path="/" element={<Navigate to="/studio" replace />} />
          <Route path="/studio" element={<ContentStudio />} />
          <Route path="/social" element={<Social />} />
          <Route path="/email" element={<Email />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/audience" element={<Audience />} />
          <Route path="/approvals" element={<ApprovalQueue />} />
          <Route path="/audit" element={<AuditLog />} />
        </Routes>
      </main>

      <footer className="foot">
        Trust Before Intelligence — every AI action is drafted, held for human approval, and audited.
      </footer>
    </div>
  );
}
