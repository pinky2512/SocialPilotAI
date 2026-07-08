// STORY-014 — Assign Lead Scores Based on Engagement Data.
//
// Acceptance:
//  - A lead's score is derived from their email engagement (weighted).
//  - Scores are clamped to 0–100.
//  - Scoring upserts the lead and is audited (before/after).
//  - scoreAllLeads scores every recipient with engagement data.

import { test, before, beforeEach } from 'node:test';
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

function campaign() {
  const m = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  return email.createEmailCampaign({ userId: m, name: 'C', subject: 'S', body: 'B' });
}

test('score reflects weighted engagement', () => {
  const c = campaign();
  const who = 'lead@x.com';
  analytics.recordEngagementEvent({ campaignId: c.id, recipient: who, eventType: 'delivered' }); // +1
  analytics.recordEngagementEvent({ campaignId: c.id, recipient: who, eventType: 'open' });      // +5
  analytics.recordEngagementEvent({ campaignId: c.id, recipient: who, eventType: 'click' });     // +15
  const lead = leads.scoreLead({ email: who });
  assert.equal(lead.score, 21);
});

test('score is clamped to 0 (negative engagement)', () => {
  const c = campaign();
  const who = 'churn@x.com';
  analytics.recordEngagementEvent({ campaignId: c.id, recipient: who, eventType: 'unsubscribe' }); // -40
  const lead = leads.scoreLead({ email: who });
  assert.equal(lead.score, 0);
});

test('score is clamped to 100 (heavy engagement)', () => {
  const c = campaign();
  const who = 'superfan@x.com';
  for (let i = 0; i < 20; i++) analytics.recordEngagementEvent({ campaignId: c.id, recipient: who, eventType: 'click' }); // 300 raw
  const lead = leads.scoreLead({ email: who });
  assert.equal(lead.score, 100);
});

test('scoring upserts the lead and audits before/after', () => {
  const c = campaign();
  const who = 'a@x.com';
  analytics.recordEngagementEvent({ campaignId: c.id, recipient: who, eventType: 'open' });
  leads.scoreLead({ email: who });
  analytics.recordEngagementEvent({ campaignId: c.id, recipient: who, eventType: 'click' });
  const updated = leads.scoreLead({ email: who });
  assert.equal(updated.score, 20);
  const audits = db.all("SELECT * FROM audit_log WHERE action = 'lead.scored'");
  assert.equal(audits.length, 2);
  assert.equal(JSON.parse(audits[1].details).before, 5);
  assert.equal(JSON.parse(audits[1].details).after, 20);
});

test('scoreAllLeads scores every recipient with engagement', () => {
  const c = campaign();
  analytics.recordEngagementEvent({ campaignId: c.id, recipient: 'a@x.com', eventType: 'open' });
  analytics.recordEngagementEvent({ campaignId: c.id, recipient: 'b@x.com', eventType: 'click' });
  const scored = leads.scoreAllLeads();
  assert.equal(scored.length, 2);
  const list = leads.listLeads();
  assert.equal(list[0].score >= list[1].score, true, 'sorted by score desc');
});
