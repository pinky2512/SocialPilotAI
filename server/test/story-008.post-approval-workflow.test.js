// STORY-008 — Approval Workflow for Social Media Posts (Governance-owned).
//
// Acceptance:
//  - A rejected post can be revised and re-submitted for approval.
//  - Governance lists pending post approvals.
//  - The full workflow (submit -> reject -> edit -> resubmit -> approve ->
//    publish) is governed and audited; a post never publishes without approval.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, social, agent, gov, seed, get;

before(async () => {
  db = await import('../src/db/index.js');
  social = await import('../src/agents/socialMediaAgent.js');
  agent = await import('../src/agents/contentGenerationAgent.js');
  gov = await import('../src/agents/governanceAgent.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

function scheduled() {
  const manager = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  const approver = get('SELECT id FROM users WHERE role = ?', ['marketing_leadership']).id;
  const content = agent.generateContent({ creatorId: manager, prompt: 'Governed post' });
  const acct = social.connectAccount({ userId: manager, platform: 'twitter', handle: '@b' });
  const [post] = social.schedulePost({ userId: manager, contentId: content.id, accountIds: [acct.id] });
  return { manager, approver, post };
}

test('governance lists pending post approvals', () => {
  scheduled();
  const pending = gov.listPendingPosts();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].kind, 'post');
});

test('reject -> edit -> resubmit -> approve -> publish', () => {
  const { manager, approver, post } = scheduled();

  // Reject the initial submission.
  let gate = get('SELECT id FROM approval_processes WHERE post_id = ? ORDER BY id DESC LIMIT 1', [post.id]);
  gov.decide({ approvalId: gate.id, approverId: approver, decision: 'rejected', reason: 'tighten copy' });
  assert.equal(get('SELECT status FROM social_posts WHERE id = ?', [post.id]).status, 'rejected');

  // Publishing a rejected post is refused.
  assert.throws(() => social.publishPost({ postId: post.id }), /only approved/);

  // Revise and re-submit.
  social.editPost({ postId: post.id, editorId: manager, postText: 'Tighter, better copy' });
  gov.submitPostForApproval({ postId: post.id, requestedBy: manager });
  assert.equal(get('SELECT status FROM social_posts WHERE id = ?', [post.id]).status, 'pending_approval');

  // Approve the resubmission and publish.
  gate = get('SELECT id FROM approval_processes WHERE post_id = ? AND status = ? ORDER BY id DESC LIMIT 1', [post.id, 'pending']);
  gov.decide({ approvalId: gate.id, approverId: approver, decision: 'approved' });
  const published = social.publishPost({ postId: post.id, userId: approver });
  assert.equal(published.status, 'published');

  // Edit + resubmit are audited.
  assert.ok(get("SELECT * FROM audit_log WHERE action = 'social.post_edited'"));
});

test('an approved post cannot be edited or re-submitted', () => {
  const { approver, post } = scheduled();
  const gate = get('SELECT id FROM approval_processes WHERE post_id = ?', [post.id]);
  gov.decide({ approvalId: gate.id, approverId: approver, decision: 'approved' });
  assert.throws(() => social.editPost({ postId: post.id, editorId: approver, postText: 'x' }), /can no longer be edited/);
  assert.throws(() => gov.submitPostForApproval({ postId: post.id, requestedBy: approver }), /only draft\/rejected/);
});
