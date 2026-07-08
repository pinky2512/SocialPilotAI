// STORY-021 — Latency Optimization for Real-Time Dashboard.
//
// Acceptance:
//  - The dashboard/overview snapshots are cached within a short TTL (repeat
//    reads return the SAME snapshot instance → no recompute).
//  - New engagement invalidates the cache so the next read is fresh
//    (real-time correctness preserved).

import { test, before, beforeEach, afterEach } from 'node:test';
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
  analytics.invalidateAnalyticsCaches();
});

afterEach(() => {
  analytics.invalidateAnalyticsCaches();
});

test('second read within TTL is a cache hit (no recompute)', () => {
  const first = analytics.getDashboardCached();
  const second = analytics.getDashboardCached();
  assert.equal(first.hit, false, 'first is a miss');
  assert.equal(second.hit, true, 'second is a hit');
  assert.equal(first.value, second.value, 'same cached snapshot instance');
});

test('new engagement invalidates the cache -> next read recomputes', () => {
  const c = email.createEmailCampaign({ userId: get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id, name: 'C', subject: 'S', body: 'B' });
  const a = analytics.getDashboardCached();
  assert.equal(a.hit, false);
  // recording engagement publishes newCampaignData -> cache invalidated
  analytics.recordEngagementEvent({ campaignId: c.id, recipient: 'x@x.com', eventType: 'delivered' });
  const b = analytics.getDashboardCached();
  assert.equal(b.hit, false, 'invalidated -> recomputed');
  assert.notEqual(a.value, b.value);
  assert.equal(b.value.totals.delivered, 1);
});

test('overview is cached independently', () => {
  const first = analytics.getOverviewCached();
  const second = analytics.getOverviewCached();
  assert.equal(second.hit, true);
  assert.equal(first.value, second.value);
});
