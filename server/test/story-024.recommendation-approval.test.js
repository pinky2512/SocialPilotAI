// STORY-024 — Approval Gate for Predictive Recommendations.
//
// Acceptance:
//  - Proposing a recommendation holds it at the approval gate
//    (status pending_approval; a pending approval_processes row is opened).
//  - A recommendation reaches 'approved' ONLY via a human decision; reject ->
//    'rejected'. Nothing is auto-adopted.
//  - The recommendation appears in the unified pending queue (kind=recommendation).
//  - Propose + decisions are audited.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, gov, email, seed, get;

before(async () => {
  db = await import('../src/db/index.js');
  gov = await import('../src/agents/governanceAgent.js');
  email = await import('../src/agents/emailCampaignAgent.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

const manager = () => get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
const admin = () => get('SELECT id FROM users WHERE role = ?', ['administrator']).id;

function propose() {
  const c = email.createEmailCampaign({ userId: manager(), name: 'C', subject: 'S', body: 'B' });
  return gov.proposeRecommendation({
    campaignId: c.id,
    type: 'improve-subject',
    message: 'Test stronger subject lines.',
    rationale: 'Open rate below baseline.',
    priority: 'high',
    requestedBy: manager(),
  });
}

test('proposing holds the recommendation for approval', () => {
  const { recommendation, approval } = propose();
  assert.equal(recommendation.status, 'pending_approval');
  assert.equal(approval.status, 'pending');
  const gate = get("SELECT * FROM approval_processes WHERE recommendation_id = ? AND status = 'pending'", [recommendation.id]);
  assert.ok(gate);
  assert.ok(get("SELECT * FROM audit_log WHERE action = 'recommendation.proposed'"));
});

test('a recommendation is adopted only after human approval', () => {
  const { recommendation } = propose();
  const gate = get('SELECT id FROM approval_processes WHERE recommendation_id = ?', [recommendation.id]);
  const result = gov.decide({ approvalId: gate.id, approverId: admin(), decision: 'approved' });
  assert.equal(result.kind, 'recommendation');
  assert.equal(get('SELECT status FROM predictive_recommendations WHERE id = ?', [recommendation.id]).status, 'approved');
  assert.ok(get("SELECT * FROM audit_log WHERE action = 'approval.approved'"));
});

test('rejecting marks the recommendation rejected', () => {
  const { recommendation } = propose();
  const gate = get('SELECT id FROM approval_processes WHERE recommendation_id = ?', [recommendation.id]);
  gov.decide({ approvalId: gate.id, approverId: admin(), decision: 'rejected', reason: 'not now' });
  assert.equal(get('SELECT status FROM predictive_recommendations WHERE id = ?', [recommendation.id]).status, 'rejected');
});

test('proposed recommendation appears in the unified pending queue', () => {
  const { recommendation } = propose();
  const pending = gov.listPending();
  const rec = pending.find((p) => p.kind === 'recommendation');
  assert.ok(rec);
  assert.equal(rec.recommendation_id, recommendation.id);
});

test('propose requires type and message', () => {
  assert.throws(() => gov.proposeRecommendation({ requestedBy: manager(), message: 'x' }));
  assert.throws(() => gov.proposeRecommendation({ requestedBy: manager(), type: 'x' }));
});
