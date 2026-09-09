// STORY-036 — Role-Based Access Control for Content Approval.
//
// Acceptance:
//  - Approving/rejecting a held item requires content:approve (Administrator).
//  - A campaign_manager (who creates + submits) is refused (403) and the denial
//    is audited as access.denied.
//  - An administrator can approve; the item advances past the gate.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, seed, get, createApp, can, PERMISSIONS, content, governance;

before(async () => {
  db = await import('../src/db/index.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get } = db);
  ({ createApp } = await import('../src/app.js'));
  ({ can, PERMISSIONS } = await import('../src/auth/permissions.js'));
  content = await import('../src/agents/contentGenerationAgent.js');
  governance = await import('../src/agents/governanceAgent.js');
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

// Create a draft and submit it into the approval gate; return the approval id.
function heldApproval() {
  const managerId = idFor('campaign_manager');
  const draft = content.generateContent({ creatorId: managerId, prompt: 'A summer sale post', platform: 'twitter' });
  const approval = governance.submitForApproval({ contentId: draft.id, requestedBy: managerId });
  return { approvalId: approval.id, contentId: draft.id };
}

test('permission matrix: only administrator holds content:approve', () => {
  assert.equal(can('campaign_manager', PERMISSIONS.CONTENT_APPROVE), false);
  assert.equal(can('administrator', PERMISSIONS.CONTENT_APPROVE), true);
});

test('manager submitting is allowed but approving is forbidden (403, audited)', async () => {
  const app = createApp();
  const { approvalId } = heldApproval();

  const res = await http(app, {
    method: 'POST', path: `/api/approvals/${approvalId}/approve`, userId: idFor('campaign_manager'),
  });
  assert.equal(res.status, 403);

  const denied = get("SELECT * FROM audit_log WHERE action = 'access.denied' ORDER BY id DESC LIMIT 1");
  assert.equal(JSON.parse(denied.details).permission, 'content:approve');
});

test('rejecting is also forbidden for a manager', async () => {
  const app = createApp();
  const { approvalId } = heldApproval();
  const res = await http(app, {
    method: 'POST', path: `/api/approvals/${approvalId}/reject`, userId: idFor('campaign_manager'), body: { reason: 'no' },
  });
  assert.equal(res.status, 403);
});

test('administrator can approve; content advances past the gate', async () => {
  const app = createApp();
  const { approvalId, contentId } = heldApproval();

  const res = await http(app, {
    method: 'POST', path: `/api/approvals/${approvalId}/approve`, userId: idFor('administrator'),
  });
  assert.equal(res.status, 200);
  assert.equal(get('SELECT status FROM content WHERE id = ?', [contentId]).status, 'approved');
});
