// STORY-026 — Governance Score for Predictive Analytics.
//
// Acceptance:
//  - The score combines % audited, % approvals honored, and failure rate.
//  - No data => a clean 100 (nothing to govern).
//  - Undecided (pending) proposals lower the "honored" component and, below
//    threshold, produce fix recommendations.
//  - Deciding proposals raises the score.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, gov, seed, get;

before(async () => {
  db = await import('../src/db/index.js');
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

function propose() {
  return gov.proposeRecommendation({
    type: 'improve-subject', message: 'm', rationale: 'r', priority: 'high', requestedBy: manager(),
  });
}

test('no data yields a clean 100', () => {
  const g = gov.predictiveGovernanceScore();
  assert.equal(g.score, 100);
  assert.equal(g.status, 'good');
});

test('pending proposals lower honored% and score', () => {
  propose(); // proposed but not decided
  const g = gov.predictiveGovernanceScore();
  assert.equal(g.metrics.auditedPct, 100);   // always audited
  assert.equal(g.metrics.honoredPct, 0);     // 0 of 1 decided
  assert.ok(g.score < 100);
  assert.equal(g.status, 'below_threshold');
  assert.ok(g.recommendations.some((r) => /await a human decision/.test(r)));
});

test('deciding a proposal raises the score to full honored', () => {
  const { recommendation } = propose();
  const gate = get('SELECT id FROM approval_processes WHERE recommendation_id = ?', [recommendation.id]);
  gov.decide({ approvalId: gate.id, approverId: admin(), decision: 'approved' });
  const g = gov.predictiveGovernanceScore();
  assert.equal(g.metrics.honoredPct, 100);
  assert.equal(g.score, 100);
  assert.equal(g.status, 'good');
});
