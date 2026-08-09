// STORY-030 — Notify Users of Pending Content Approvals.
//
// Acceptance:
//  - Submitting content for approval notifies the approver(s) (administrators).
//  - Notifications are per-recipient, unread by default, and can be read.
//  - The manager who submitted is not spammed (only approvers are notified).

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, agent, gov, notif, seed, get;

before(async () => {
  db = await import('../src/db/index.js');
  agent = await import('../src/agents/contentGenerationAgent.js');
  gov = await import('../src/agents/governanceAgent.js');
  notif = await import('../src/trust/notifications.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

const manager = () => get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
const admin = () => get('SELECT id FROM users WHERE role = ?', ['administrator']).id;

test('submitting content notifies the administrator', () => {
  const c = agent.generateContent({ creatorId: manager(), prompt: 'Hi' });
  gov.submitForApproval({ contentId: c.id, requestedBy: manager() });

  assert.equal(notif.unreadCount(admin()), 1);
  const list = notif.listForUser(admin());
  assert.equal(list[0].type, 'content_approval_pending');
  assert.equal(list[0].entity_id, c.id);
});

test('the submitting manager is not notified', () => {
  const c = agent.generateContent({ creatorId: manager(), prompt: 'Hi' });
  gov.submitForApproval({ contentId: c.id, requestedBy: manager() });
  assert.equal(notif.unreadCount(manager()), 0);
});

test('notifications can be marked read', () => {
  const c = agent.generateContent({ creatorId: manager(), prompt: 'Hi' });
  gov.submitForApproval({ contentId: c.id, requestedBy: manager() });
  const list = notif.listForUser(admin());
  notif.markRead(admin(), list[0].id);
  assert.equal(notif.unreadCount(admin()), 0);
});

test('mark-all-read clears the inbox', () => {
  const c1 = agent.generateContent({ creatorId: manager(), prompt: 'a' });
  const c2 = agent.generateContent({ creatorId: manager(), prompt: 'b' });
  gov.submitForApproval({ contentId: c1.id, requestedBy: manager() });
  gov.submitForApproval({ contentId: c2.id, requestedBy: manager() });
  assert.equal(notif.unreadCount(admin()), 2);
  notif.markAllRead(admin());
  assert.equal(notif.unreadCount(admin()), 0);
});
