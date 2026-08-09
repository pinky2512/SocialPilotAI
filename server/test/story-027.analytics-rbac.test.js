// STORY-027 — Role-Based Access Control for Analytics Features.
//
// Acceptance:
//  - Both roles can VIEW analytics (analytics:view).
//  - Writing engagement telemetry requires analytics:ingest (Administrator only);
//    a campaign_manager is refused (403) and the denial is audited.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, seed, get, createApp, can, PERMISSIONS, email;

before(async () => {
  db = await import('../src/db/index.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get } = db);
  ({ createApp } = await import('../src/app.js'));
  ({ can, PERMISSIONS } = await import('../src/auth/permissions.js'));
  email = await import('../src/agents/emailCampaignAgent.js');
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

const idFor = (role) => get('SELECT id FROM users WHERE role = ?', [role]).id;

async function http(app, { method = 'GET', path, userId, body }) {
  const { createServer } = await import('node:http');
  const server = createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(userId ? { 'x-user-id': String(userId) } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  server.close();
  return { status: res.status, json };
}

test('permission matrix: manager can view analytics, cannot ingest', () => {
  assert.equal(can('campaign_manager', PERMISSIONS.ANALYTICS_VIEW), true);
  assert.equal(can('campaign_manager', PERMISSIONS.ANALYTICS_INGEST), false);
  assert.equal(can('administrator', PERMISSIONS.ANALYTICS_INGEST), true);
});

test('both roles can read the dashboard', async () => {
  const app = createApp();
  const mgr = await http(app, { path: '/api/analytics/dashboard', userId: idFor('campaign_manager') });
  const adm = await http(app, { path: '/api/analytics/dashboard', userId: idFor('administrator') });
  assert.equal(mgr.status, 200);
  assert.equal(adm.status, 200);
});

test('ingest is forbidden for manager, allowed for administrator', async () => {
  const app = createApp();
  const c = email.createEmailCampaign({ userId: idFor('campaign_manager'), name: 'C', subject: 'S', body: 'B' });

  const mgr = await http(app, {
    method: 'POST', path: '/api/analytics/email/events', userId: idFor('campaign_manager'),
    body: { campaignId: c.id, recipient: 'a@x.com', eventType: 'open' },
  });
  assert.equal(mgr.status, 403);

  const denied = get("SELECT * FROM audit_log WHERE action = 'access.denied' ORDER BY id DESC LIMIT 1");
  assert.equal(JSON.parse(denied.details).permission, 'analytics:ingest');

  const adm = await http(app, {
    method: 'POST', path: '/api/analytics/email/events', userId: idFor('administrator'),
    body: { campaignId: c.id, recipient: 'a@x.com', eventType: 'open' },
  });
  assert.equal(adm.status, 201);
});
