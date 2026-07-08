// STORY-007 — Post to Multiple Platforms.
//
// Acceptance:
//  - Only APPROVED posts can be published (approval-gate enforcement).
//  - Publishing marks the post 'published', sets published_at, and logs to
//    integration_logs + audit_log.
//  - publishDuePosts publishes all due approved posts across platforms; a
//    non-approved post is never published.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, social, agent, gov, seed, get, all;

before(async () => {
  db = await import('../src/db/index.js');
  social = await import('../src/agents/socialMediaAgent.js');
  agent = await import('../src/agents/contentGenerationAgent.js');
  gov = await import('../src/agents/governanceAgent.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get, all } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

function scheduledPost() {
  const manager = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  const content = agent.generateContent({ creatorId: manager, prompt: 'Launch day!' });
  const acct = social.connectAccount({ userId: manager, platform: 'twitter', handle: '@brand' });
  const [post] = social.schedulePost({ userId: manager, contentId: content.id, accountIds: [acct.id] });
  return { manager, post };
}

test('a not-yet-approved post cannot be published', () => {
  const { post } = scheduledPost();
  assert.equal(post.status, 'pending_approval');
  assert.throws(() => social.publishPost({ postId: post.id }), /only approved posts/);
});

test('an approved post publishes and is fully logged', () => {
  const { post } = scheduledPost();
  const approver = get('SELECT id FROM users WHERE role = ?', ['marketing_leadership']).id;
  const gate = get("SELECT id FROM approval_processes WHERE post_id = ?", [post.id]);
  gov.decide({ approvalId: gate.id, approverId: approver, decision: 'approved' });

  const published = social.publishPost({ postId: post.id, userId: approver });
  assert.equal(published.status, 'published');
  assert.ok(published.published_at);

  assert.ok(get("SELECT * FROM integration_logs WHERE action = 'publish' AND status = 'success'"));
  assert.ok(get("SELECT * FROM audit_log WHERE action = 'social.post_published'"));
});

test('publishDuePosts publishes only approved due posts', () => {
  const manager = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  const approver = get('SELECT id FROM users WHERE role = ?', ['marketing_leadership']).id;
  const content = agent.generateContent({ creatorId: manager, prompt: 'Multi launch' });
  const tw = social.connectAccount({ userId: manager, platform: 'twitter', handle: '@b' });
  const li = social.connectAccount({ userId: manager, platform: 'linkedin', handle: 'BP' });
  const posts = social.schedulePost({ userId: manager, contentId: content.id, accountIds: [tw.id, li.id] });

  // Approve only the first post.
  const gate = get('SELECT id FROM approval_processes WHERE post_id = ?', [posts[0].id]);
  gov.decide({ approvalId: gate.id, approverId: approver, decision: 'approved' });

  const results = social.publishDuePosts({ userId: approver });
  assert.equal(results.length, 1, 'only the approved post is due');
  assert.equal(results[0].status, 'published');

  // The unapproved post is still held.
  assert.equal(get('SELECT status FROM social_posts WHERE id = ?', [posts[1].id]).status, 'pending_approval');
});

test('future-scheduled approved posts are not published early', () => {
  const manager = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  const approver = get('SELECT id FROM users WHERE role = ?', ['marketing_leadership']).id;
  const content = agent.generateContent({ creatorId: manager, prompt: 'Future post' });
  const acct = social.connectAccount({ userId: manager, platform: 'twitter', handle: '@f' });
  const [post] = social.schedulePost({ userId: manager, contentId: content.id, accountIds: [acct.id], scheduledAt: '2999-01-01T00:00:00Z' });
  const gate = get('SELECT id FROM approval_processes WHERE post_id = ?', [post.id]);
  gov.decide({ approvalId: gate.id, approverId: approver, decision: 'approved' });

  const results = social.publishDuePosts({ userId: approver, now: '2026-07-08T00:00:00Z' });
  assert.equal(results.length, 0, 'not due yet');
});
