// STORY-020 — Unified Dashboard for Campaign Metrics.
//
// Acceptance:
//  - A single overview spans content, social, email, engagement, and leads.
//  - Status breakdowns and totals are correct across channels.
//  - Pending approvals are surfaced.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, analytics, email, content, social, gov, seed, get;

before(async () => {
  db = await import('../src/db/index.js');
  analytics = await import('../src/agents/analyticsAgent.js');
  email = await import('../src/agents/emailCampaignAgent.js');
  content = await import('../src/agents/contentGenerationAgent.js');
  social = await import('../src/agents/socialMediaAgent.js');
  gov = await import('../src/agents/governanceAgent.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

test('overview spans all channels with totals and status breakdowns', () => {
  const creator = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  const manager = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;

  const c = content.generateContent({ creatorId: creator, prompt: 'Hello' });
  const acct = social.connectAccount({ userId: manager, platform: 'twitter', handle: '@b' });
  social.schedulePost({ userId: manager, contentId: c.id, accountIds: [acct.id] });
  const camp = email.createEmailCampaign({ userId: manager, name: 'N', subject: 'S', body: 'B' });
  analytics.recordEngagementEvent({ campaignId: camp.id, recipient: 'a@x.com', eventType: 'delivered' });
  analytics.recordEngagementEvent({ campaignId: camp.id, recipient: 'a@x.com', eventType: 'open' });

  const o = analytics.unifiedOverview();
  assert.equal(o.content.total, 1);
  assert.equal(o.content.byStatus.draft, 1);
  assert.equal(o.social.total, 1);
  assert.equal(o.social.byStatus.pending_approval, 1); // schedule holds for approval
  assert.equal(o.email.total, 1);
  assert.equal(o.engagement.delivered, 1);
  assert.equal(o.engagement.openRate, 100);
  assert.ok(o.generatedAt);
});

test('overview surfaces pending approvals count', () => {
  const creator = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  const c = content.generateContent({ creatorId: creator, prompt: 'x' });
  gov.submitForApproval({ contentId: c.id, requestedBy: creator });
  const o = analytics.unifiedOverview();
  assert.equal(o.approvals.pending, 1);
});

test('empty system yields zeroed overview (no divide-by-zero)', () => {
  const o = analytics.unifiedOverview();
  assert.equal(o.content.total, 0);
  assert.equal(o.engagement.openRate, 0);
});
