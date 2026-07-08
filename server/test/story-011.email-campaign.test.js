// STORY-011 — Create and Schedule Email Campaign.
//
// Acceptance:
//  - A campaign can be created (status 'draft') and scheduled.
//  - Scheduling HOLDS the campaign at the approval gate (pending_approval).
//  - A campaign can only be SENT after human approval (gate enforcement).
//  - All actions are audited; send is also logged to integration_logs.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, email, gov, seed, get;

before(async () => {
  db = await import('../src/db/index.js');
  email = await import('../src/agents/emailCampaignAgent.js');
  gov = await import('../src/agents/governanceAgent.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

const manager = () => get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
const leader = () => get('SELECT id FROM users WHERE role = ?', ['marketing_leadership']).id;

function draftCampaign() {
  return email.createEmailCampaign({
    userId: manager(), name: 'July Newsletter', subject: 'Big updates', body: 'Hello!', audience: 'all-subscribers',
  });
}

test('create produces a draft campaign', () => {
  const c = draftCampaign();
  assert.equal(c.status, 'draft');
  assert.equal(c.subject, 'Big updates');
  assert.ok(get("SELECT * FROM audit_log WHERE action = 'email.campaign_created'"));
});

test('scheduling holds the campaign for approval', () => {
  const c = draftCampaign();
  const { campaign } = email.scheduleEmail({ userId: manager(), campaignId: c.id, scheduledAt: '2026-08-01T09:00:00Z' });
  assert.equal(campaign.status, 'pending_approval');
  assert.equal(campaign.scheduled_at, '2026-08-01T09:00:00Z');
  const gate = get("SELECT * FROM approval_processes WHERE email_campaign_id = ? AND status = 'pending'", [c.id]);
  assert.ok(gate);
});

test('a campaign cannot be sent before approval', () => {
  const c = draftCampaign();
  email.scheduleEmail({ userId: manager(), campaignId: c.id });
  assert.throws(() => email.sendEmail({ campaignId: c.id }), /only approved campaigns/);
});

test('an approved campaign can be sent and is fully logged', () => {
  const c = draftCampaign();
  email.scheduleEmail({ userId: manager(), campaignId: c.id });
  const gate = get('SELECT id FROM approval_processes WHERE email_campaign_id = ?', [c.id]);
  gov.decide({ approvalId: gate.id, approverId: leader(), decision: 'approved' });

  const sent = email.sendEmail({ userId: leader(), campaignId: c.id });
  assert.equal(sent.status, 'sent');
  assert.ok(sent.sent_at);
  assert.ok(get("SELECT * FROM integration_logs WHERE integration_type = 'email' AND action = 'send' AND status = 'success'"));
  assert.ok(get("SELECT * FROM audit_log WHERE action = 'email.campaign_sent'"));
});

test('a rejected campaign can be rescheduled and resubmitted', () => {
  const c = draftCampaign();
  email.scheduleEmail({ userId: manager(), campaignId: c.id });
  let gate = get('SELECT id FROM approval_processes WHERE email_campaign_id = ?', [c.id]);
  gov.decide({ approvalId: gate.id, approverId: leader(), decision: 'rejected', reason: 'fix subject' });
  assert.equal(get('SELECT status FROM email_campaigns WHERE id = ?', [c.id]).status, 'rejected');

  email.scheduleEmail({ userId: manager(), campaignId: c.id });
  assert.equal(get('SELECT status FROM email_campaigns WHERE id = ?', [c.id]).status, 'pending_approval');
});

test('email campaign appears in the unified pending queue with kind=email', () => {
  const c = draftCampaign();
  email.scheduleEmail({ userId: manager(), campaignId: c.id });
  const pending = gov.listPending();
  const em = pending.find((p) => p.kind === 'email');
  assert.ok(em);
  assert.equal(em.email_campaign_id, c.id);
});
