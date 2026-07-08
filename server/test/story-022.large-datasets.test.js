// STORY-022 — Handling Large Datasets in Real-Time Dashboard.
//
// Acceptance:
//  - Aggregates stay correct and are computed in the DB over large event sets.
//  - Lead listing and audit querying support limit/offset pagination.
//  - Performance-supporting indexes exist.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, analytics, leads, audit, email, seed, get, all, run;

before(async () => {
  db = await import('../src/db/index.js');
  analytics = await import('../src/agents/analyticsAgent.js');
  leads = await import('../src/agents/leadScoringAgent.js');
  audit = await import('../src/trust/audit.js');
  email = await import('../src/agents/emailCampaignAgent.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get, all, run } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

test('metrics stay correct over a large engagement set', () => {
  const m = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  const c = email.createEmailCampaign({ userId: m, name: 'Big', subject: 'S', body: 'B' });
  // 2,000 delivered, 1,000 opens
  const events = [];
  for (let i = 0; i < 2000; i++) events.push({ campaignId: c.id, recipient: `u${i}@x.com`, eventType: 'delivered' });
  for (let i = 0; i < 1000; i++) events.push({ campaignId: c.id, recipient: `u${i}@x.com`, eventType: 'open' });
  analytics.ingestEngagementBatch(events);

  const metrics = analytics.campaignMetrics(c.id);
  assert.equal(metrics.counts.delivered, 2000);
  assert.equal(metrics.counts.uniqueOpens, 1000);
  assert.equal(metrics.rates.openRate, 50);
});

test('lead listing paginates with a stable total', () => {
  for (let i = 0; i < 120; i++) run('INSERT INTO leads (email, score) VALUES (?, ?)', [`l${i}@x.com`, i % 100]);
  const page1 = leads.listLeads({ limit: 50, offset: 0 });
  const page2 = leads.listLeads({ limit: 50, offset: 50 });
  assert.equal(page1.length, 50);
  assert.equal(page2.length, 50);
  assert.notEqual(page1[0].id, page2[0].id);
  assert.equal(leads.countLeads(), 120);
});

test('audit querying paginates with a total', () => {
  for (let i = 0; i < 30; i++) audit.logAction({ userId: null, action: 'test.event', details: { i } });
  const first = audit.queryAudit({ action: 'test.event', limit: 10, offset: 0 });
  const second = audit.queryAudit({ action: 'test.event', limit: 10, offset: 10 });
  assert.equal(first.length, 10);
  assert.equal(second.length, 10);
  assert.notEqual(first[0].id, second[0].id);
  assert.equal(audit.countAudit({ action: 'test.event' }), 30);
});

test('performance indexes exist', () => {
  const idx = all("SELECT name FROM sqlite_master WHERE type = 'index'").map((r) => r.name);
  assert.ok(idx.includes('idx_engagement_campaign_type'));
  assert.ok(idx.includes('idx_leads_score'));
  assert.ok(idx.includes('idx_audit_action'));
});
