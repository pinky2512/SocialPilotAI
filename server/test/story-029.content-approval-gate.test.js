// STORY-029 — Human Approval Gates for AI-Generated Content.
//
// Acceptance:
//  - AI-generated content is marked with its source (model/template).
//  - Content can be published ONLY from status 'approved' (it passed the human
//    approval gate); draft/pending/rejected cannot be published.
//  - Publishing is audited; the whole path (draft -> approve -> publish) works.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, agent, gov, seed, get;

before(async () => {
  db = await import('../src/db/index.js');
  agent = await import('../src/agents/contentGenerationAgent.js');
  gov = await import('../src/agents/governanceAgent.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

const manager = () => get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
const admin = () => get('SELECT id FROM users WHERE role = ?', ['administrator']).id;

test('generated content records its source (template here)', () => {
  const c = agent.generateContent({ creatorId: manager(), prompt: 'Hi' });
  const row = get('SELECT * FROM content WHERE id = ?', [c.id]);
  assert.equal(row.source, 'template');
});

test('content cannot be published before approval', () => {
  const c = agent.generateContent({ creatorId: manager(), prompt: 'Hi' });
  assert.throws(() => agent.publishContent({ contentId: c.id }), /only approved content/);
  gov.submitForApproval({ contentId: c.id, requestedBy: manager() });
  assert.throws(() => agent.publishContent({ contentId: c.id }), /only approved content/); // pending_approval
});

test('approved content publishes and is audited', () => {
  const c = agent.generateContent({ creatorId: manager(), prompt: 'Hi' });
  const approval = gov.submitForApproval({ contentId: c.id, requestedBy: manager() });
  gov.decide({ approvalId: approval.id, approverId: admin(), decision: 'approved' });

  const published = agent.publishContent({ contentId: c.id, userId: admin() });
  assert.equal(published.status, 'published');
  assert.ok(get("SELECT * FROM audit_log WHERE action = 'content.published'"));
});

test('rejected content cannot be published', () => {
  const c = agent.generateContent({ creatorId: manager(), prompt: 'Hi' });
  const approval = gov.submitForApproval({ contentId: c.id, requestedBy: manager() });
  gov.decide({ approvalId: approval.id, approverId: admin(), decision: 'rejected' });
  assert.throws(() => agent.publishContent({ contentId: c.id }), /only approved content/);
});
