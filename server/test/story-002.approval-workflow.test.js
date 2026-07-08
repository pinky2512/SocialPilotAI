// STORY-002 — Content Draft Approval Workflow.
//
// Acceptance:
//  - A draft can be submitted for approval; content -> 'pending_approval' and a
//    pending approval_processes row is opened.
//  - A human can approve (content -> 'approved') or reject (content -> 'rejected').
//  - Every transition is recorded in the append-only audit log.
//  - A decided approval cannot be decided again.
//  - Content never reaches 'approved' without going through the gate.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, generateContent, gov, seed, get;

before(async () => {
  db = await import('../src/db/index.js');
  ({ generateContent } = await import('../src/agents/contentGenerationAgent.js'));
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
  return generateContent({ creatorId: creator.id, prompt: 'A campaign post' });
}

test('submitting a draft holds it for approval', () => {
  const draft = makeDraft();
  const approval = gov.submitForApproval({ contentId: draft.id, requestedBy: draft.creator_id });

  assert.equal(approval.status, 'pending');
  const content = get('SELECT * FROM content WHERE id = ?', [draft.id]);
  assert.equal(content.status, 'pending_approval');
});

test('approve advances content to approved and records the decision', () => {
  const draft = makeDraft();
  const approver = get('SELECT id FROM users WHERE role = ?', ['marketing_leadership']);
  const approval = gov.submitForApproval({ contentId: draft.id, requestedBy: draft.creator_id });

  const result = gov.decide({ approvalId: approval.id, approverId: approver.id, decision: 'approved' });
  assert.equal(result.content.status, 'approved');
  assert.equal(result.approval.status, 'approved');
  assert.equal(result.approval.approver_id, approver.id);

  const logged = get("SELECT * FROM audit_log WHERE action = 'approval.approved'");
  assert.ok(logged, 'approval decision must be audited');
});

test('reject moves content to rejected', () => {
  const draft = makeDraft();
  const approver = get('SELECT id FROM users WHERE role = ?', ['marketing_leadership']);
  const approval = gov.submitForApproval({ contentId: draft.id, requestedBy: draft.creator_id });

  const result = gov.decide({ approvalId: approval.id, approverId: approver.id, decision: 'rejected', reason: 'off-brand' });
  assert.equal(result.content.status, 'rejected');
  assert.equal(result.approval.status, 'rejected');
});

test('a decided approval cannot be decided again', () => {
  const draft = makeDraft();
  const approver = get('SELECT id FROM users WHERE role = ?', ['marketing_leadership']);
  const approval = gov.submitForApproval({ contentId: draft.id, requestedBy: draft.creator_id });
  gov.decide({ approvalId: approval.id, approverId: approver.id, decision: 'approved' });

  assert.throws(
    () => gov.decide({ approvalId: approval.id, approverId: approver.id, decision: 'rejected' }),
    /already decided/
  );
});

test('only drafts (or previously rejected) can be submitted', () => {
  const draft = makeDraft();
  const approver = get('SELECT id FROM users WHERE role = ?', ['marketing_leadership']);
  const approval = gov.submitForApproval({ contentId: draft.id, requestedBy: draft.creator_id });
  gov.decide({ approvalId: approval.id, approverId: approver.id, decision: 'approved' });

  // Already approved -> cannot be resubmitted.
  assert.throws(() => gov.submitForApproval({ contentId: draft.id, requestedBy: draft.creator_id }));
});

test('pending queue lists held items only', () => {
  const d1 = makeDraft();
  const d2 = makeDraft();
  gov.submitForApproval({ contentId: d1.id, requestedBy: d1.creator_id });
  gov.submitForApproval({ contentId: d2.id, requestedBy: d2.creator_id });

  const approver = get('SELECT id FROM users WHERE role = ?', ['marketing_leadership']);
  const pending1 = gov.listPending();
  assert.equal(pending1.length, 2);

  gov.decide({ approvalId: pending1[0].approval_id, approverId: approver.id, decision: 'approved' });
  assert.equal(gov.listPending().length, 1);
});
