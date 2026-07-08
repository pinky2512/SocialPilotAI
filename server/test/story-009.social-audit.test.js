// STORY-009 — Audit Log for Social Media Actions.
//
// Acceptance:
//  - Every social media action (connect, schedule, edit, approve/reject,
//    publish) produces an append-only audit entry.
//  - The audit trail for a post can be queried in order.
//  - Social actions can be filtered by prefix.
//  - The log remains append-only (no UPDATE/DELETE).

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, social, agent, gov, audit, seed, get;

before(async () => {
  db = await import('../src/db/index.js');
  social = await import('../src/agents/socialMediaAgent.js');
  agent = await import('../src/agents/contentGenerationAgent.js');
  gov = await import('../src/agents/governanceAgent.js');
  audit = await import('../src/trust/audit.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

test('a full post lifecycle produces a complete, ordered audit trail', () => {
  const manager = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  const approver = get('SELECT id FROM users WHERE role = ?', ['marketing_leadership']).id;
  const content = agent.generateContent({ creatorId: manager, prompt: 'Audit me' });
  const acct = social.connectAccount({ userId: manager, platform: 'twitter', handle: '@b' });
  const [post] = social.schedulePost({ userId: manager, contentId: content.id, accountIds: [acct.id] });
  const gate = get('SELECT id FROM approval_processes WHERE post_id = ?', [post.id]);
  gov.decide({ approvalId: gate.id, approverId: approver, decision: 'approved' });
  social.publishPost({ postId: post.id, userId: approver });

  const trail = audit.actionsForPost(post.id).map((e) => e.action);
  assert.ok(trail.includes('social.post_scheduled'));
  assert.ok(trail.includes('social.post_published'));
  // ordered ascending by id
  const ids = audit.actionsForPost(post.id).map((e) => e.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
});

test('social actions can be filtered by prefix', () => {
  const manager = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  social.connectAccount({ userId: manager, platform: 'linkedin', handle: 'BP' });
  const social1 = audit.queryAudit({ actionPrefix: 'social.' });
  assert.ok(social1.length >= 1);
  assert.ok(social1.every((e) => e.action.startsWith('social.')));
});

test('details are returned parsed as objects', () => {
  const manager = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  social.connectAccount({ userId: manager, platform: 'twitter', handle: '@x' });
  const [entry] = audit.queryAudit({ action: 'social.account_connected', limit: 1 });
  assert.equal(typeof entry.details, 'object');
  assert.equal(entry.details.platform, 'twitter');
});

test('audit action types are discoverable', () => {
  const manager = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  social.connectAccount({ userId: manager, platform: 'facebook', handle: 'FB' });
  assert.ok(audit.auditActionTypes().includes('social.account_connected'));
});
