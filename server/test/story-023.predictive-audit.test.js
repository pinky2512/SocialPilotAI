// STORY-023 — Audit Logging for Predictive Analytics.
//
// Acceptance:
//  - An EXPLICIT predictive-insight request is audited (with actor + result).
//  - An EXPLICIT recommendation request is audited.
//  - Dashboard polling (updateDashboard) does NOT audit — no log flooding.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, analytics, email, seed, get, all;

before(async () => {
  db = await import('../src/db/index.js');
  analytics = await import('../src/agents/analyticsAgent.js');
  email = await import('../src/agents/emailCampaignAgent.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get, all } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

function campaign() {
  const m = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  return email.createEmailCampaign({ userId: m, name: 'C', subject: 'S', body: 'B' });
}

test('explicit predictive request is audited with actor', () => {
  const c = campaign();
  analytics.generatePredictiveInsights({ campaignId: c.id, actorId: 7, audit: true });
  const entry = get("SELECT * FROM audit_log WHERE action = 'analytics.predictive_generated'");
  assert.ok(entry);
  assert.equal(entry.user_id, 7);
  assert.equal(JSON.parse(entry.details).campaignId, c.id);
});

test('explicit recommendation request is audited', () => {
  const c = campaign();
  analytics.generateRecommendations({ campaignId: c.id, actorId: 9, audit: true });
  const entry = get("SELECT * FROM audit_log WHERE action = 'analytics.recommendations_generated'");
  assert.ok(entry);
  assert.equal(entry.user_id, 9);
});

test('dashboard polling does NOT write audit entries (no flooding)', () => {
  const c = campaign();
  analytics.recordEngagementEvent({ campaignId: c.id, recipient: 'a@x.com', eventType: 'delivered' });
  const before = all("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'analytics.%'")[0].n;
  // simulate several dashboard refreshes
  analytics.updateDashboard();
  analytics.updateDashboard();
  analytics.updateDashboard();
  const after = all("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'analytics.%'")[0].n;
  assert.equal(before, after, 'dashboard refresh must not add predictive-analytics audit entries');
});

test('non-audited predictive call writes nothing', () => {
  const c = campaign();
  analytics.generatePredictiveInsights({ campaignId: c.id }); // audit defaults false
  const n = all("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'analytics.predictive_generated'")[0].n;
  assert.equal(n, 0);
});
