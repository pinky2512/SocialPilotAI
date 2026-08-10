// STORY-035 — Process Data Export Requests Efficiently.
//
// Acceptance:
//  - An export request is queued as 'pending' and audited.
//  - Pending requests are processed in one batch; results are stored so a later
//    fetch does not recompute.
//  - A processed request exposes its stored result and is 'completed'.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, privacy, analytics, email, seed, get;

before(async () => {
  db = await import('../src/db/index.js');
  privacy = await import('../src/trust/privacy.js');
  analytics = await import('../src/agents/analyticsAgent.js');
  email = await import('../src/agents/emailCampaignAgent.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

function seedSubject(addr) {
  const m = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  const c = email.createEmailCampaign({ userId: m, name: 'C', subject: 'S', body: 'B' });
  analytics.recordEngagementEvent({ campaignId: c.id, recipient: addr, eventType: 'open' });
}

test('queuing an export request creates a pending, audited record', () => {
  const req = privacy.createExportRequest({ subject: 'a@x.com', requestedBy: 2 });
  assert.equal(req.status, 'pending');
  assert.equal(req.result, null);
  assert.ok(get("SELECT * FROM audit_log WHERE action = 'data.export_requested'"));
});

test('pending requests are processed in one batch and results stored', () => {
  seedSubject('a@x.com');
  seedSubject('b@x.com');
  privacy.createExportRequest({ subject: 'a@x.com', requestedBy: 2 });
  privacy.createExportRequest({ subject: 'b@x.com', requestedBy: 2 });

  const r = privacy.processPendingExports({ processedBy: 2 });
  assert.equal(r.processed, 2);

  // No pending left; both completed with stored results.
  assert.equal(privacy.listExportRequests().every((x) => x.status === 'completed'), true);
  const one = privacy.getExportRequest(1);
  assert.equal(one.status, 'completed');
  assert.ok(one.result && one.result.engagementEvents.length >= 1);
  assert.ok(get("SELECT * FROM audit_log WHERE action = 'data.export_processed'"));
});

test('processing again is a no-op (nothing pending)', () => {
  privacy.createExportRequest({ subject: 'a@x.com', requestedBy: 2 });
  privacy.processPendingExports({ processedBy: 2 });
  const again = privacy.processPendingExports({ processedBy: 2 });
  assert.equal(again.processed, 0);
});
