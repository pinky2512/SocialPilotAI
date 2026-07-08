// STORY-010 — Role-Based Access Control for Social Media Features.
//
// Acceptance:
//  - The permission matrix grants social permissions per role.
//  - Denied attempts are recorded in the append-only audit log (access.denied).
//  - HTTP routes enforce RBAC: 403 for a role lacking the permission, success
//    for a role that has it.
//  - platform_admin (wildcard) can do everything.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, seed, get, createApp, can, PERMISSIONS;

before(async () => {
  db = await import('../src/db/index.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get } = db);
  ({ createApp } = await import('../src/app.js'));
  ({ can, PERMISSIONS } = await import('../src/auth/permissions.js'));
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

const idFor = (role) => get('SELECT id FROM users WHERE role = ?', [role]).id;

// Minimal in-process HTTP helper against the Express app.
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

test('permission matrix: content_creator can schedule but not connect/publish', () => {
  assert.equal(can('content_creator', PERMISSIONS.SOCIAL_SCHEDULE), true);
  assert.equal(can('content_creator', PERMISSIONS.SOCIAL_CONNECT), false);
  assert.equal(can('content_creator', PERMISSIONS.SOCIAL_PUBLISH), false);
});

test('platform_admin wildcard grants every social permission', () => {
  assert.equal(can('platform_admin', PERMISSIONS.SOCIAL_CONNECT), true);
  assert.equal(can('platform_admin', PERMISSIONS.SOCIAL_PUBLISH), true);
  assert.equal(can('platform_admin', PERMISSIONS.SOCIAL_APPROVE), true);
});

test('route enforces RBAC: content_creator is forbidden from connecting accounts', async () => {
  const app = createApp();
  const res = await http(app, {
    method: 'POST', path: '/api/social/accounts', userId: idFor('content_creator'),
    body: { platform: 'twitter', handle: '@x' },
  });
  assert.equal(res.status, 403);
  assert.match(res.json.error, /forbidden/);
});

test('a denied attempt is audited as access.denied', async () => {
  const app = createApp();
  await http(app, {
    method: 'POST', path: '/api/social/accounts', userId: idFor('data_analyst'),
    body: { platform: 'twitter', handle: '@x' },
  });
  const denied = get("SELECT * FROM audit_log WHERE action = 'access.denied' ORDER BY id DESC LIMIT 1");
  assert.ok(denied, 'denial must be recorded');
  assert.equal(JSON.parse(denied.details).permission, 'social:connect');
});

test('route allows RBAC: campaign_manager can connect an account', async () => {
  const app = createApp();
  const res = await http(app, {
    method: 'POST', path: '/api/social/accounts', userId: idFor('campaign_manager'),
    body: { platform: 'twitter', handle: '@brand' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.account.platform, 'twitter');
});

test('publish is forbidden for content_creator but allowed for campaign_manager', async () => {
  const app = createApp();
  const creator = await http(app, { method: 'POST', path: '/api/social/publish-due', userId: idFor('content_creator') });
  assert.equal(creator.status, 403);
  const manager = await http(app, { method: 'POST', path: '/api/social/publish-due', userId: idFor('campaign_manager') });
  assert.equal(manager.status, 200);
});

test('GET /api/me returns the acting role permissions', async () => {
  const app = createApp();
  const res = await http(app, { path: '/api/me', userId: idFor('data_analyst') });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.permissions, ['social:view']);
});
