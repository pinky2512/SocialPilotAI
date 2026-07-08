// STORY-003 — Seamless Content Editing Interface (backend contract).
//
// Acceptance:
//  - A draft's text can be edited; the change is persisted.
//  - The before/after is recorded in the append-only audit log.
//  - Editing a draft that was already submitted (pending_approval) resets it to
//    'draft' so it must pass the approval gate again.
//  - Approved/published content can no longer be edited.
//  - Empty edits are rejected.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, agent, gov, seed, get;

before(async () => {
  db = await import('../src/db/index.js');
  agent = await import('../src/agents/contentGenerationAgent.js');
  gov = await import('../src/agents/governanceAgent.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

function makeDraft() {
  const creator = get('SELECT id FROM users WHERE role = ?', ['content_creator']);
  return agent.generateContent({ creatorId: creator.id, prompt: 'Original idea' });
}

test('editing a draft updates the text and audits before/after', () => {
  const draft = makeDraft();
  const updated = agent.editContent({ contentId: draft.id, editorId: draft.creator_id, contentText: 'Edited body' });

  assert.equal(updated.content_text, 'Edited body');
  assert.equal(updated.status, 'draft');

  const logged = get("SELECT * FROM audit_log WHERE action = 'content.edited'");
  const details = JSON.parse(logged.details);
  assert.equal(details.before, draft.content_text);
  assert.equal(details.after, 'Edited body');
});

test('editing a submitted draft resets it to draft (re-approval required)', () => {
  const draft = makeDraft();
  gov.submitForApproval({ contentId: draft.id, requestedBy: draft.creator_id });
  const afterSubmit = get('SELECT * FROM content WHERE id = ?', [draft.id]);
  assert.equal(afterSubmit.status, 'pending_approval');

  const updated = agent.editContent({ contentId: draft.id, editorId: draft.creator_id, contentText: 'Reworked' });
  assert.equal(updated.status, 'draft', 'edited-after-submit must return to draft');
});

test('approved content cannot be edited', () => {
  const draft = makeDraft();
  const approver = get('SELECT id FROM users WHERE role = ?', ['marketing_leadership']);
  const approval = gov.submitForApproval({ contentId: draft.id, requestedBy: draft.creator_id });
  gov.decide({ approvalId: approval.id, approverId: approver.id, decision: 'approved' });

  assert.throws(
    () => agent.editContent({ contentId: draft.id, editorId: draft.creator_id, contentText: 'sneaky change' }),
    /can no longer be edited/
  );
});

test('empty edits are rejected', () => {
  const draft = makeDraft();
  assert.throws(() => agent.editContent({ contentId: draft.id, editorId: draft.creator_id, contentText: '   ' }));
});
