// LLM-backed content generation (async path).
//
// Verifies the async generateContentAI persists a draft, audits it, and records
// the source — using the template fallback (useLLM:false) so the test never
// hits the network. The real-LLM path (useLLM auto-detected from
// ANTHROPIC_API_KEY) is exercised manually, not in CI.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, agent, seed, get;

before(async () => {
  db = await import('../src/db/index.js');
  agent = await import('../src/agents/contentGenerationAgent.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

test('generateContentAI (template fallback) creates an audited draft', async () => {
  const creator = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  const content = await agent.generateContentAI({
    creatorId: creator,
    prompt: 'Launch our new feature',
    platform: 'twitter',
    tone: 'friendly',
    useLLM: false,
  });
  assert.equal(content.status, 'draft');
  assert.ok(content.content_text.length > 0);

  const audit = get("SELECT * FROM audit_log WHERE action = 'content.generated' ORDER BY id DESC LIMIT 1");
  assert.equal(JSON.parse(audit.details).source, 'template');
});

test('generateContentAI rejects an empty prompt', async () => {
  const creator = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  await assert.rejects(() => agent.generateContentAI({ creatorId: creator, prompt: '  ', useLLM: false }));
});
