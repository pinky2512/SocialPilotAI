// STORY-028 — Explainability for Predictive Analytics.
//
// Acceptance:
//  - Predictive insights include an explanation: the method (formula), the
//    blend weight, the contributing factors, and a plain-language summary.
//  - The factors reference the real inputs (observed rate, baseline, sample).

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, analytics, email, seed, get;

before(async () => {
  db = await import('../src/db/index.js');
  analytics = await import('../src/agents/analyticsAgent.js');
  email = await import('../src/agents/emailCampaignAgent.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

function campaign() {
  const m = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  return email.createEmailCampaign({ userId: m, name: 'C', subject: 'S', body: 'B' });
}

test('insights carry an explanation with method, weight, factors, summary', () => {
  const c = campaign();
  for (let i = 0; i < 200; i++) analytics.recordEngagementEvent({ campaignId: c.id, recipient: `u${i}@x.com`, eventType: 'delivered' });
  for (let i = 0; i < 100; i++) analytics.recordEngagementEvent({ campaignId: c.id, recipient: `u${i}@x.com`, eventType: 'open' });

  const ins = analytics.generatePredictiveInsights({ campaignId: c.id });
  const ex = ins.explanation;
  assert.ok(ex, 'explanation present');
  assert.match(ex.method, /Predicted rate/);
  assert.equal(typeof ex.weight, 'number');
  assert.ok(ex.factors.length >= 3);
  assert.ok(ex.factors.some((f) => /Observed open rate/.test(f.label)));
  assert.ok(ex.factors.some((f) => /baseline/i.test(f.label)));
  assert.match(ex.summary, /blends the observed/);
});

test('small-sample prediction explains the blend toward baseline', () => {
  const c = campaign();
  for (let i = 0; i < 20; i++) analytics.recordEngagementEvent({ campaignId: c.id, recipient: `u${i}@x.com`, eventType: 'delivered' });
  const ins = analytics.generatePredictiveInsights({ campaignId: c.id });
  assert.ok(ins.explanation.weight < 1, 'weight below 1 for small sample');
  const wf = ins.explanation.factors.find((f) => /Sample weight/.test(f.label));
  assert.match(wf.detail, /baseline/);
});
