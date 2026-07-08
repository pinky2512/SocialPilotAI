// STORY-015 — Segment Audiences Based on Lead Scores.
//
// Acceptance:
//  - Leads are assigned a segment by score band (hot/warm/cold/dormant).
//  - segmentAudience returns per-segment counts and is audited.
//  - Leads can be listed by segment for targeting.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, leads, seed, run, get;

before(async () => {
  db = await import('../src/db/index.js');
  leads = await import('../src/agents/leadScoringAgent.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ run, get } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

// Insert leads directly with known scores.
function seedLeads(pairs) {
  for (const [email, score] of pairs) {
    run('INSERT INTO leads (email, score) VALUES (?, ?)', [email, score]);
  }
}

test('segmentForScore maps score bands correctly', () => {
  assert.equal(leads.segmentForScore(90), 'hot');
  assert.equal(leads.segmentForScore(70), 'hot');
  assert.equal(leads.segmentForScore(55), 'warm');
  assert.equal(leads.segmentForScore(10), 'cold');
  assert.equal(leads.segmentForScore(0), 'dormant');
});

test('segmentAudience assigns segments and returns counts', () => {
  seedLeads([['hot@x.com', 85], ['warm@x.com', 50], ['cold@x.com', 20], ['dormant@x.com', 0]]);
  const result = leads.segmentAudience();
  assert.deepEqual(result.segments, { hot: 1, warm: 1, cold: 1, dormant: 1 });
  assert.equal(result.total, 4);
  assert.equal(get('SELECT segment FROM leads WHERE email = ?', ['hot@x.com']).segment, 'hot');
});

test('segmentation is audited with the summary', () => {
  seedLeads([['a@x.com', 90]]);
  leads.segmentAudience();
  const audit = get("SELECT * FROM audit_log WHERE action = 'audience.segmented' ORDER BY id DESC LIMIT 1");
  assert.ok(audit);
  assert.equal(JSON.parse(audit.details).segments.hot, 1);
});

test('leadsInSegment returns only that segment, high score first', () => {
  seedLeads([['a@x.com', 95], ['b@x.com', 75], ['c@x.com', 30]]);
  leads.segmentAudience();
  const hot = leads.leadsInSegment('hot');
  assert.equal(hot.length, 2);
  assert.equal(hot[0].score >= hot[1].score, true);
});
