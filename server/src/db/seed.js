// Seed script — creates a baseline set of users (one per target role) and a
// sample campaign so the app can be exercised end-to-end. Idempotent: safe to
// run repeatedly (uses email uniqueness to avoid duplicates).
//
// Run: npm run seed

import { pathToFileURL } from 'node:url';
import { getDb, get, run } from './index.js';
import { ROLES } from '../auth/roles.js';
import { hashPassword } from '../auth/password.js';

const USERS = [
  { name: 'Casey Manager',   role: ROLES.CAMPAIGN_MANAGER,     email: 'manager@socialpilot.ai' },
  { name: 'Riley Creator',   role: ROLES.CONTENT_CREATOR,      email: 'creator@socialpilot.ai' },
  { name: 'Dana Analyst',    role: ROLES.DATA_ANALYST,         email: 'analyst@socialpilot.ai' },
  { name: 'Morgan Leader',   role: ROLES.MARKETING_LEADERSHIP, email: 'leader@socialpilot.ai' },
  { name: 'Alex Admin',      role: ROLES.PLATFORM_ADMIN,       email: 'admin@socialpilot.ai' },
];

export function seed() {
  getDb();
  const password = hashPassword('password123'); // dev only

  for (const u of USERS) {
    const existing = get('SELECT id FROM users WHERE email = ?', [u.email]);
    if (!existing) {
      run(
        'INSERT INTO users (name, role, email, hashed_password) VALUES (?, ?, ?, ?)',
        [u.name, u.role, u.email, password]
      );
    }
  }

  const manager = get('SELECT id FROM users WHERE email = ?', ['manager@socialpilot.ai']);
  const existingCampaign = get('SELECT id FROM campaigns WHERE name = ?', ['Summer Launch 2026']);
  if (!existingCampaign) {
    run(
      "INSERT INTO campaigns (name, manager_id, start_date, end_date, status) VALUES (?, ?, '2026-06-01', '2026-08-31', 'active')",
      ['Summer Launch 2026', manager.id]
    );
  }

  return { users: USERS.length };
}

// Run when invoked directly (cross-platform path/URL comparison).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = seed();
  // eslint-disable-next-line no-console
  console.log(`Seeded ${result.users} users and sample campaign.`);
}
