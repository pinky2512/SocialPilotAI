// STORY-019 — Recommendations for Optimizing Future Campaigns.
//
// Acceptance:
//  - Low open rate -> "improve subject" recommendation.
//  - High bounce rate -> "clean list" recommendation.
//  - Small sample -> "gather data" only.
//  - Healthy campaign -> "on track".
//  - Each recommendation carries a rationale + priority.

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
function deliver(id, n) { for (let i = 0; i < n; i++) analytics.recordEngagementEvent({ campaignId: id, recipient: `u${i}@x.com`, eventType: 'delivered' }); }
function evt(id, type, n, offset = 0) { for (let i = 0; i < n; i++) analytics.recordEngagementEvent({ campaignId: id, recipient: `u${i + offset}@x.com`, eventType: type }); }

const types = (r) => r.recommendations.map((x) => x.type);

test('small sample yields only a gather-data recommendation', () => {
  const c = campaign();
  deliver(c.id, 20);
  const r = analytics.generateRecommendations({ campaignId: c.id });
  assert.deepEqual(types(r), ['gather-data']);
});

test('low open + low click yields improve-subject and strengthen-cta', () => {
  // Establish a high baseline with a strong prior campaign.
  const prior = campaign('prior'); deliver(prior.id, 100); evt(prior.id, 'open', 50); evt(prior.id, 'click', 20);
  // Target campaign underperforms.
  const c = campaign('weak'); deliver(c.id, 100); evt(c.id, 'open', 10); evt(c.id, 'click', 1);
  const t = types(analytics.generateRecommendations({ campaignId: c.id }));
  assert.ok(t.includes('improve-subject'));
  assert.ok(t.includes('strengthen-cta'));
});

test('high bounce rate yields clean-list', () => {
  const c = campaign(); deliver(c.id, 100); evt(c.id, 'open', 40); evt(c.id, 'click', 10);
  evt(c.id, 'bounce', 5, 200); // 5% bounce
  const t = types(analytics.generateRecommendations({ campaignId: c.id }));
  assert.ok(t.includes('clean-list'));
});

test('healthy campaign is on-track and recs carry rationale + priority', () => {
  const c = campaign(); deliver(c.id, 100); evt(c.id, 'open', 25); evt(c.id, 'click', 4);
  const r = analytics.generateRecommendations({ campaignId: c.id });
  assert.deepEqual(types(r), ['on-track']);
  assert.ok(r.recommendations[0].rationale);
  assert.ok(['low', 'medium', 'high'].includes(r.recommendations[0].priority));
});
