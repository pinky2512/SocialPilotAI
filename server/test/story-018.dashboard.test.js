// STORY-018 — Real-Time Metrics Dashboard.
//
// Acceptance:
//  - updateDashboard aggregates totals + overall rates across campaigns.
//  - It reflects the latest engagement each call (so polling = real time).
//  - It includes predicted rates per campaign and a fresh timestamp.

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

test('dashboard aggregates totals and overall rates', () => {
  const c = campaign();
  for (let i = 0; i < 10; i++) analytics.recordEngagementEvent({ campaignId: c.id, recipient: `u${i}@x.com`, eventType: 'delivered' });
  for (let i = 0; i < 5; i++) analytics.recordEngagementEvent({ campaignId: c.id, recipient: `u${i}@x.com`, eventType: 'open' });

  const d = analytics.updateDashboard();
  assert.equal(d.totals.campaigns, 1);
  assert.equal(d.totals.delivered, 10);
  assert.equal(d.totals.opens, 5);
  assert.equal(d.overallRates.openRate, 50);
  assert.ok(d.generatedAt);
});

test('dashboard reflects new engagement on the next call (real-time)', () => {
  const c = campaign();
  analytics.recordEngagementEvent({ campaignId: c.id, recipient: 'a@x.com', eventType: 'delivered' });
  const before = analytics.updateDashboard().totals.opens;
  analytics.recordEngagementEvent({ campaignId: c.id, recipient: 'a@x.com', eventType: 'open' });
  const after = analytics.updateDashboard().totals.opens;
  assert.equal(before, 0);
  assert.equal(after, 1);
});

test('dashboard includes per-campaign predicted rates', () => {
  const c = campaign('with-pred');
  for (let i = 0; i < 250; i++) analytics.recordEngagementEvent({ campaignId: c.id, recipient: `u${i}@x.com`, eventType: 'delivered' });
  for (let i = 0; i < 100; i++) analytics.recordEngagementEvent({ campaignId: c.id, recipient: `u${i}@x.com`, eventType: 'open' });
  const d = analytics.updateDashboard();
  const row = d.campaigns.find((x) => x.campaignId === c.id);
  assert.ok(row.predicted.openRate > 0);
});
