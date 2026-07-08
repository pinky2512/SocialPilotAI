// STORY-012 — Track Email Engagement Metrics.
//
// Acceptance:
//  - Engagement events (delivered/open/click/bounce/unsubscribe) can be recorded.
//  - Unknown event types and unknown campaigns are rejected.
//  - Per-campaign metrics aggregate counts and derive rates from delivered count.
//  - Unique opens/clicks are counted distinctly from total events.

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
  const manager = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  return email.createEmailCampaign({ userId: manager, name: 'C', subject: 'S', body: 'B', audience: 'all' });
}

test('records an engagement event', () => {
  const c = campaign();
  const e = analytics.recordEngagementEvent({ campaignId: c.id, recipient: 'a@x.com', eventType: 'open' });
  assert.equal(e.event_type, 'open');
  assert.equal(e.campaign_id, c.id);
});

test('rejects unknown event type and unknown campaign', () => {
  const c = campaign();
  assert.throws(() => analytics.recordEngagementEvent({ campaignId: c.id, eventType: 'nope' }), /unknown engagement/);
  assert.throws(() => analytics.recordEngagementEvent({ campaignId: 9999, eventType: 'open' }), /not found/);
});

test('metrics aggregate counts and rates', () => {
  const c = campaign();
  // 10 delivered, 4 unique opens (one double-open), 2 clicks, 1 bounce
  for (let i = 0; i < 10; i++) analytics.recordEngagementEvent({ campaignId: c.id, recipient: `u${i}@x.com`, eventType: 'delivered' });
  ['u0', 'u1', 'u2', 'u3'].forEach((u) => analytics.recordEngagementEvent({ campaignId: c.id, recipient: `${u}@x.com`, eventType: 'open' }));
  analytics.recordEngagementEvent({ campaignId: c.id, recipient: 'u0@x.com', eventType: 'open' }); // repeat open
  ['u0', 'u1'].forEach((u) => analytics.recordEngagementEvent({ campaignId: c.id, recipient: `${u}@x.com`, eventType: 'click' }));
  analytics.recordEngagementEvent({ campaignId: c.id, recipient: 'u9@x.com', eventType: 'bounce' });

  const m = analytics.campaignMetrics(c.id);
  assert.equal(m.counts.delivered, 10);
  assert.equal(m.counts.opens, 5);        // total open events
  assert.equal(m.counts.uniqueOpens, 4);  // distinct recipients
  assert.equal(m.counts.clicks, 2);
  assert.equal(m.rates.openRate, 40);     // 4/10
  assert.equal(m.rates.clickRate, 20);    // 2/10
  assert.equal(m.rates.bounceRate, 10);   // 1/10
});

test('batch ingest records multiple events', () => {
  const c = campaign();
  const n = analytics.ingestEngagementBatch([
    { campaignId: c.id, recipient: 'a@x.com', eventType: 'delivered' },
    { campaignId: c.id, recipient: 'a@x.com', eventType: 'open' },
  ]);
  assert.equal(n, 2);
  assert.equal(analytics.campaignMetrics(c.id).counts.opens, 1);
});

test('metrics with no events return zeroed rates (no divide-by-zero)', () => {
  const c = campaign();
  const m = analytics.campaignMetrics(c.id);
  assert.equal(m.rates.openRate, 0);
  assert.equal(m.counts.delivered, 0);
});
