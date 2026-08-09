// STORY-025 — Trust Dashboard for System Health Monitoring.
//
// Acceptance:
//  - monitorSystemHealth returns health, pending approvals, recent actions,
//    and anomalies in one snapshot.
//  - A failed agent task surfaces as an anomaly.
//  - An access.denied event surfaces as an anomaly.
//  - A clean system reports status 'healthy'.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, trust, agent, gov, seed, get, run;

before(async () => {
  db = await import('../src/db/index.js');
  trust = await import('../src/agents/trustCoordinator.js');
  agent = await import('../src/agents/contentGenerationAgent.js');
  gov = await import('../src/agents/governanceAgent.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get, run } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

test('snapshot has all four sections', () => {
  const s = trust.monitorSystemHealth();
  assert.ok(s.health);
  assert.ok(s.pendingApprovals);
  assert.ok(Array.isArray(s.recentActions));
  assert.ok(Array.isArray(s.anomalies));
  assert.ok(s.generatedAt);
});

test('clean system reports healthy', () => {
  const creator = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  agent.generateContent({ creatorId: creator, prompt: 'Hello' }); // a successful task
  const s = trust.monitorSystemHealth();
  assert.equal(s.health.status, 'healthy');
  assert.equal(s.anomalies.length, 0);
});

test('pending approvals are reflected', () => {
  const creator = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  const c = agent.generateContent({ creatorId: creator, prompt: 'x' });
  gov.submitForApproval({ contentId: c.id, requestedBy: creator });
  const s = trust.monitorSystemHealth();
  assert.equal(s.pendingApprovals.count, 1);
});

test('a failed agent task surfaces as an anomaly', () => {
  run("INSERT INTO ai_agent_tasks (agent_id, task_type, status) VALUES ('x-agent', 'doThing', 'failed')");
  const s = trust.monitorSystemHealth();
  assert.ok(s.anomalies.some((a) => a.type === 'agent_task_failed'));
  assert.notEqual(s.health.status, 'healthy');
});

test('an access.denied event surfaces as an anomaly', () => {
  run("INSERT INTO audit_log (user_id, action, details) VALUES (1, 'access.denied', ?)",
    [JSON.stringify({ role: 'campaign_manager', permission: 'social:publish' })]);
  const s = trust.monitorSystemHealth();
  assert.ok(s.anomalies.some((a) => a.type === 'access_denied'));
});
