// STORY-016 — Update Lead Scores in Real-Time.
//
// Acceptance:
//  - With real-time scoring enabled, recording an engagement event immediately
//    updates the affected lead's score (no manual scoreLead call needed).
//  - Further engagement keeps the score current in real time.
//  - When disabled, scores are NOT auto-updated (opt-in behavior).

import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, leads, analytics, email, seed, get;

before(async () => {
  db = await import('../src/db/index.js');
  leads = await import('../src/agents/leadScoringAgent.js');
  analytics = await import('../src/agents/analyticsAgent.js');
  email = await import('../src/agents/emailCampaignAgent.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

afterEach(() => {
  leads.disableRealtimeScoring();
});

function campaign() {
  const m = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  return email.createEmailCampaign({ userId: m, name: 'C', subject: 'S', body: 'B' });
}

test('engagement updates the lead score in real time', () => {
  leads.enableRealtimeScoring();
  const c = campaign();
  analytics.recordEngagementEvent({ campaignId: c.id, recipient: 'rt@x.com', eventType: 'open' });
  let lead = get('SELECT * FROM leads WHERE email = ?', ['rt@x.com']);
  assert.ok(lead, 'lead created reactively');
  assert.equal(lead.score, 5);

  analytics.recordEngagementEvent({ campaignId: c.id, recipient: 'rt@x.com', eventType: 'click' });
  lead = get('SELECT * FROM leads WHERE email = ?', ['rt@x.com']);
  assert.equal(lead.score, 20, 'score kept current in real time');
});

test('enableRealtimeScoring is idempotent (single update per event)', () => {
  leads.enableRealtimeScoring();
  leads.enableRealtimeScoring(); // second call must not double-subscribe
  const c = campaign();
  analytics.recordEngagementEvent({ campaignId: c.id, recipient: 'once@x.com', eventType: 'click' });
  const audits = db.all("SELECT * FROM audit_log WHERE action = 'lead.scored'");
  assert.equal(audits.length, 1, 'exactly one re-score per event');
});

test('when disabled, engagement does not auto-score', () => {
  // (real-time not enabled here)
  const c = campaign();
  analytics.recordEngagementEvent({ campaignId: c.id, recipient: 'noauto@x.com', eventType: 'open' });
  const lead = get('SELECT * FROM leads WHERE email = ?', ['noauto@x.com']);
  assert.equal(lead, undefined, 'no reactive scoring when disabled');
});
