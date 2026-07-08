// STORY-001 — AI-Driven Content Draft Generation.
//
// Acceptance:
//  - The Content Generation Agent produces a content draft from a prompt.
//  - The draft is persisted with status 'draft' — NEVER published/live
//    (approval-gate contract).
//  - The action is recorded in the append-only audit log.
//  - An ai_agent_tasks row tracks the run and ends 'done'.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, generateContent, seed, get, all;

before(async () => {
  db = await import('../src/db/index.js');
  ({ generateContent } = await import('../src/agents/contentGenerationAgent.js'));
  ({ seed } = await import('../src/db/seed.js'));
  ({ get, all } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

test('generateContent creates a draft (not published) from a prompt', () => {
  const creator = get('SELECT id FROM users WHERE role = ?', ['content_creator']);
  const content = generateContent({
    creatorId: creator.id,
    prompt: 'Announce our new analytics dashboard',
    platform: 'twitter',
    tone: 'friendly',
  });

  assert.equal(content.status, 'draft', 'new AI content must start as draft, never live');
  assert.ok(content.content_text.length > 0);
  assert.equal(content.creator_id, creator.id);
});

test('generateContent writes an append-only audit entry', () => {
  const creator = get('SELECT id FROM users WHERE role = ?', ['content_creator']);
  const content = generateContent({ creatorId: creator.id, prompt: 'New feature launch' });

  const entries = all(
    "SELECT * FROM audit_log WHERE action = 'content.generated'"
  );
  assert.equal(entries.length, 1);
  const details = JSON.parse(entries[0].details);
  assert.equal(details.contentId, content.id);
  assert.equal(entries[0].user_id, creator.id);
});

test('generateContent records a completed ai_agent_task', () => {
  const creator = get('SELECT id FROM users WHERE role = ?', ['content_creator']);
  generateContent({ creatorId: creator.id, prompt: 'Weekly tips thread' });

  const task = get(
    "SELECT * FROM ai_agent_tasks WHERE task_type = 'generateContent' ORDER BY id DESC LIMIT 1"
  );
  assert.equal(task.status, 'done');
  assert.equal(task.agent_id, 'content-generation-agent');
});

test('generateContent rejects an empty prompt', () => {
  const creator = get('SELECT id FROM users WHERE role = ?', ['content_creator']);
  assert.throws(() => generateContent({ creatorId: creator.id, prompt: '   ' }));
});

test('audit_log cannot be updated or deleted (append-only enforcement)', () => {
  const creator = get('SELECT id FROM users WHERE role = ?', ['content_creator']);
  generateContent({ creatorId: creator.id, prompt: 'Test' });
  assert.throws(() => db.run("UPDATE audit_log SET action = 'x' WHERE id = 1"), /append-only/);
  assert.throws(() => db.run('DELETE FROM audit_log WHERE id = 1'), /append-only/);
});
