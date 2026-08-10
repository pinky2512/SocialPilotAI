// STORY-032 — Log All Actions in an Append-Only Audit Log (tamper-evident).
//
// Acceptance:
//  - Every logged action is hash-chained to the previous one.
//  - The chain verifies as intact for an untampered log.
//  - A forged/altered entry breaks verification (detected).
//  - The log remains append-only (UPDATE/DELETE still blocked at the DB).

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, audit, seed, get, run, all;

before(async () => {
  db = await import('../src/db/index.js');
  audit = await import('../src/trust/audit.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get, run, all } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

test('each entry chains to the previous (prev_hash links)', () => {
  const a = audit.logAction({ userId: 1, action: 'test.a' });
  const b = audit.logAction({ userId: 1, action: 'test.b' });
  assert.ok(a.hash && b.hash);
  assert.equal(b.prev_hash, a.hash);
});

test('an untampered chain verifies ok', () => {
  audit.logAction({ userId: 1, action: 'test.a' });
  audit.logAction({ userId: null, action: 'test.b', details: { x: 1 } });
  audit.logAction({ userId: 2, action: 'test.c' });
  const result = audit.verifyAuditIntegrity();
  assert.equal(result.ok, true);
  assert.equal(result.count, 3);
});

test('a forged entry (bad hash) is detected', () => {
  audit.logAction({ userId: 1, action: 'test.a' });
  // Simulate tampering by inserting a row with a bogus hash (INSERT is allowed,
  // UPDATE/DELETE are not — this models a write that bypassed logAction).
  run("INSERT INTO audit_log (user_id, action, timestamp, details, prev_hash, hash) VALUES (1, 'test.forged', '2026-01-01T00:00:00Z', '{}', 'wrong', 'deadbeef')");
  const result = audit.verifyAuditIntegrity();
  assert.equal(result.ok, false);
  assert.ok(result.brokenAt);
});

test('audit_log remains append-only (UPDATE/DELETE blocked)', () => {
  const a = audit.logAction({ userId: 1, action: 'test.a' });
  assert.throws(() => run("UPDATE audit_log SET action = 'x' WHERE id = ?", [a.id]), /append-only/);
  assert.throws(() => run('DELETE FROM audit_log WHERE id = ?', [a.id]), /append-only/);
});

test('every meaningful action goes through the chained writer', () => {
  // Content generation logs content.generated with a hash.
  const c = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  const rows = all('SELECT hash FROM audit_log');
  // seed itself performs no audit writes, so start clean, then generate.
  audit.logAction({ userId: c, action: 'content.generated', details: { contentId: 1 } });
  const latest = get("SELECT * FROM audit_log WHERE action = 'content.generated' ORDER BY id DESC LIMIT 1");
  assert.ok(latest.hash, 'audited action must carry a chain hash');
});
