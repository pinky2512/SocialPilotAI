// STORY-004 — Connect Social Media Accounts.
//
// Acceptance:
//  - A user can connect a supported platform account; it is persisted 'connected'.
//  - The connection is recorded in integration_logs and the audit log.
//  - Unsupported platforms are rejected (and the failure is logged).
//  - Accounts can be listed and disconnected.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, social, seed, get, all;

before(async () => {
  db = await import('../src/db/index.js');
  social = await import('../src/agents/socialMediaAgent.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get, all } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

const manager = () => get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;

test('connect a supported account', () => {
  const acct = social.connectAccount({ userId: manager(), platform: 'twitter', handle: '@brand' });
  assert.equal(acct.status, 'connected');
  assert.equal(acct.platform, 'twitter');
  assert.ok(acct.access_token, 'a (placeholder) token is stored');
});

test('connection is logged to integration_logs and audit_log', () => {
  social.connectAccount({ userId: manager(), platform: 'linkedin', handle: 'BrandPage' });
  const intg = get("SELECT * FROM integration_logs WHERE integration_type = 'linkedin' AND action = 'connect'");
  assert.equal(intg.status, 'success');
  const audit = get("SELECT * FROM audit_log WHERE action = 'social.account_connected'");
  assert.ok(audit);
});

test('unsupported platform is rejected and the failure is logged', () => {
  assert.throws(() => social.connectAccount({ userId: manager(), platform: 'myspace', handle: 'x' }), /unsupported/);
  const intg = get("SELECT * FROM integration_logs WHERE integration_type = 'myspace'");
  assert.equal(intg.status, 'failed');
});

test('list and disconnect accounts', () => {
  const a = social.connectAccount({ userId: manager(), platform: 'facebook', handle: 'Brand' });
  assert.equal(social.listAccounts(manager()).length, 1);
  const off = social.disconnectAccount({ userId: manager(), accountId: a.id });
  assert.equal(off.status, 'disconnected');
});

test('reconnecting the same handle does not duplicate the account', () => {
  social.connectAccount({ userId: manager(), platform: 'twitter', handle: '@brand' });
  social.connectAccount({ userId: manager(), platform: 'twitter', handle: '@brand' });
  assert.equal(all('SELECT * FROM social_accounts').length, 1);
});
