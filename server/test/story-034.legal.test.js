// STORY-034 — Display Privacy Policy and Terms of Service.
//
// Acceptance:
//  - The legal documents are served with a version + date.
//  - Both the Privacy Policy and Terms of Service are present and non-trivial.
//  - The endpoint is public (no x-user-id required).

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let createApp, getLegal;

before(async () => {
  ({ createApp } = await import('../src/app.js'));
  ({ getLegal } = await import('../src/trust/legal.js'));
});

test('legal documents carry a version and date and both docs', () => {
  const l = getLegal();
  assert.ok(l.version);
  assert.ok(l.updatedAt);
  assert.match(l.privacyPolicy, /Privacy Policy/);
  assert.match(l.termsOfService, /Terms of Service/);
  assert.ok(l.privacyPolicy.length > 200);
  assert.ok(l.termsOfService.length > 200);
});

test('GET /api/legal is public (no auth header)', async () => {
  const app = createApp();
  const { createServer } = await import('node:http');
  const server = createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/legal`); // no x-user-id
  const json = await res.json();
  server.close();
  assert.equal(res.status, 200);
  assert.ok(json.legal.privacyPolicy);
});
