// STORY-033 — GDPR/CCPA Data Deletion and Export.
//
// Acceptance:
//  - Export returns everything held about a subject (by email) and is audited.
//  - Deletion anonymizes PII (lead, engagement recipients, user) and is audited;
//    the append-only log is preserved (only a subject hash is stored).
//  - After deletion the subject's PII is no longer retrievable by email.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, privacy, analytics, leads, email, seed, get;

before(async () => {
  db = await import('../src/db/index.js');
  privacy = await import('../src/trust/privacy.js');
  analytics = await import('../src/agents/analyticsAgent.js');
  leads = await import('../src/agents/leadScoringAgent.js');
  email = await import('../src/agents/emailCampaignAgent.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

const SUBJECT = 'jane@example.com';

function seedSubject() {
  const m = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  const c = email.createEmailCampaign({ userId: m, name: 'C', subject: 'S', body: 'B' });
  analytics.recordEngagementEvent({ campaignId: c.id, recipient: SUBJECT, eventType: 'delivered' });
  analytics.recordEngagementEvent({ campaignId: c.id, recipient: SUBJECT, eventType: 'open' });
  leads.scoreLead({ email: SUBJECT, name: 'Jane' });
}

test('export returns the subject data and is audited', () => {
  seedSubject();
  const out = privacy.exportSubjectData({ email: SUBJECT, requestedBy: 2 });
  assert.equal(out.subject, SUBJECT);
  assert.ok(out.lead && out.lead.email === SUBJECT);
  assert.equal(out.engagementEvents.length, 2);
  assert.ok(get("SELECT * FROM audit_log WHERE action = 'data.exported'"));
});

test('deletion anonymizes PII and is audited', () => {
  seedSubject();
  const result = privacy.deleteSubjectData({ email: SUBJECT, requestedBy: 2 });
  assert.equal(result.leadsAnonymized, 1);
  assert.equal(result.eventsAnonymized, 2);

  // PII no longer retrievable by email.
  assert.equal(get('SELECT * FROM leads WHERE email = ?', [SUBJECT]), undefined);
  assert.equal(get('SELECT COUNT(*) AS n FROM email_engagement_events WHERE recipient = ?', [SUBJECT]).n, 0);

  const del = get("SELECT * FROM audit_log WHERE action = 'data.deleted'");
  assert.ok(del);
  // The immutable log stores a hash, not the raw email.
  assert.ok(!del.details.includes(SUBJECT));
});

test('subject email is required', () => {
  assert.throws(() => privacy.exportSubjectData({ email: '' }), /required/);
  assert.throws(() => privacy.deleteSubjectData({ email: '  ' }), /required/);
});
