import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

// R0 session model: pick which seeded user you act as. The chosen id is sent as
// the x-user-id header by the API client. Real OAuth/JWT login arrives with the
// Security & Access Control Agent stories; this provider is the seam it replaces.
const SEEDED_USERS = [
  { id: 1, name: 'Casey Manager', role: 'campaign_manager' },
  { id: 2, name: 'Riley Creator', role: 'content_creator' },
  { id: 3, name: 'Dana Analyst', role: 'data_analyst' },
  { id: 4, name: 'Morgan Leader', role: 'marketing_leadership' },
  { id: 5, name: 'Alex Admin', role: 'platform_admin' },
];

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [userId, setUserId] = useState(2); // default: content creator
  const [permissions, setPermissions] = useState([]);
  const user = SEEDED_USERS.find((u) => u.id === userId);

  // Load the acting user's permissions from the backend (RBAC source of truth).
  useEffect(() => {
    api.me(userId)
      .then((r) => setPermissions(r.permissions || []))
      .catch(() => setPermissions([]));
  }, [userId]);

  const can = (permission) => permissions.includes(permission);

  return (
    <SessionContext.Provider value={{ user, userId, setUserId, users: SEEDED_USERS, permissions, can }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
