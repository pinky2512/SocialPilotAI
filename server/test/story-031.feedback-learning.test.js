// STORY-031 — Incorporate User Feedback into AI Learning Process.
//
// Acceptance:
//  - Users can rate content up/down; ratings are stored and audited.
//  - A content rejection records an implicit 'down' signal.
//  - feedbackSummary aggregates ratings and derives guidance from recent
//    negative comments (the signal fed back into generation).

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

test('explicit feedback is stored and audited', () => {
  const c = agent.generateContent({ creatorId: manager(), prompt: 'Hi' });
  agent.recordFeedback({ contentId: c.id, userId: manager(), rating: 'up' });
  const s = agent.feedbackSummary();
  assert.equal(s.up, 1);
  assert.ok(get("SELECT * FROM audit_log WHERE action = 'content.feedback'"));
});

test('invalid rating is rejected', () => {
  const c = agent.generateContent({ creatorId: manager(), prompt: 'Hi' });
  assert.throws(() => agent.recordFeedback({ contentId: c.id, rating: 'meh' }), /up.*down/);
});

test('rejecting content records an implicit down signal', () => {
  const c = agent.generateContent({ creatorId: manager(), prompt: 'Hi' });
  const approval = gov.submitForApproval({ contentId: c.id, requestedBy: manager() });
  gov.decide({ approvalId: approval.id, approverId: admin(), decision: 'rejected', reason: 'too generic' });

  const fb = get("SELECT * FROM content_feedback WHERE content_id = ? AND source = 'implicit'", [c.id]);
  assert.ok(fb);
  assert.equal(fb.rating, 'down');
  assert.equal(fb.comment, 'too generic');
});

test('summary derives guidance from recent negative comments', () => {
  const c = agent.generateContent({ creatorId: manager(), prompt: 'Hi' });
  agent.recordFeedback({ contentId: c.id, userId: manager(), rating: 'down', comment: 'too salesy' });
  const s = agent.feedbackSummary();
  assert.equal(s.down, 1);
  assert.match(s.guidance, /too salesy/);
});
