// STORY-017 — Predictive Analytics for Campaign Performance.
//
// Acceptance:
//  - Insights blend observed engagement with a historical baseline.
//  - Confidence scales with delivered sample size.
//  - Projected opens/clicks derive from predicted rates.
//  - A no-data campaign falls back to baseline priors with low confidence.

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

function campaign(name = 'C') {
  const m = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  return email.createEmailCampaign({ userId: m, name, subject: 'S', body: 'B' });
}

function engage(campaignId, n, opens, clicks) {
  for (let i = 0; i < n; i++) analytics.recordEngagementEvent({ campaignId, recipient: `u${i}@x.com`, eventType: 'delivered' });
  for (let i = 0; i < opens; i++) analytics.recordEngagementEvent({ campaignId, recipient: `u${i}@x.com`, eventType: 'open' });
  for (let i = 0; i < clicks; i++) analytics.recordEngagementEvent({ campaignId, recipient: `u${i}@x.com`, eventType: 'click' });
}

test('no-data campaign uses baseline priors with low confidence', () => {
  const c = campaign();
  const ins = analytics.generatePredictiveInsights({ campaignId: c.id });
  assert.equal(ins.confidence, 'low');
  assert.equal(ins.predicted.openRate, 20); // default baseline
  assert.equal(ins.trend, 'no-data');
});

test('high-sample campaign trusts observed rates (high confidence)', () => {
  const c = campaign();
  engage(c.id, 300, 150, 30); // 50% open, 10% click over 300 delivered
  const ins = analytics.generatePredictiveInsights({ campaignId: c.id });
  assert.equal(ins.confidence, 'high');
  // observed weight is 1 at >=200 delivered -> predicted ~ observed
  assert.ok(Math.abs(ins.predicted.openRate - 50) < 1);
  assert.equal(ins.projected.opens, Math.round((ins.predicted.openRate / 100) * 300));
});

test('confidence tiers by sample size', () => {
  const c1 = campaign('small'); engage(c1.id, 30, 15, 3);
  const c2 = campaign('medium'); engage(c2.id, 120, 60, 12);
  assert.equal(analytics.generatePredictiveInsights({ campaignId: c1.id }).confidence, 'low');
  assert.equal(analytics.generatePredictiveInsights({ campaignId: c2.id }).confidence, 'medium');
});

test('baseline averages across campaigns with data', () => {
  const c1 = campaign('a'); engage(c1.id, 100, 40, 4);  // 40% open
  const c2 = campaign('b'); engage(c2.id, 100, 20, 2);  // 20% open
  const baseline = analytics.historicalBaseline();
  assert.equal(baseline.sampleCampaigns, 2);
  assert.equal(baseline.openRate, 30); // (40+20)/2
});
