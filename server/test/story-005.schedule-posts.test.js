// STORY-005 — Schedule Multi-Platform Posts.
//
// Acceptance:
//  - Scheduling creates one post per target account, text adapted per platform.
//  - Each scheduled post is HELD at the approval gate (status pending_approval),
//    never published directly.
//  - Scheduling to a disconnected account is rejected.
//  - The scheduling action is audited.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

let db, social, agent, seed, get, all;

before(async () => {
  db = await import('../src/db/index.js');
  social = await import('../src/agents/socialMediaAgent.js');
  agent = await import('../src/agents/contentGenerationAgent.js');
  ({ seed } = await import('../src/db/seed.js'));
  ({ get, all } = db);
});

beforeEach(() => {
  db._resetForTests();
  seed();
});

function setup() {
  const manager = get('SELECT id FROM users WHERE role = ?', ['campaign_manager']).id;
  const content = agent.generateContent({ creatorId: manager, prompt: 'A very long announcement '.repeat(30) });
  const tw = social.connectAccount({ userId: manager, platform: 'twitter', handle: '@brand' });
  const li = social.connectAccount({ userId: manager, platform: 'linkedin', handle: 'BrandPage' });
  return { manager, content, tw, li };
}

test('scheduling creates one post per account and adapts text to the platform', () => {
  const { manager, content, tw, li } = setup();
  const posts = social.schedulePost({
    userId: manager, contentId: content.id, accountIds: [tw.id, li.id], scheduledAt: '2026-08-01T10:00:00Z',
  });
  assert.equal(posts.length, 2);
  const twPost = posts.find((p) => p.platform === 'twitter');
  assert.ok(twPost.post_text.length <= 280, 'twitter text respects 280 chars');
  assert.equal(twPost.scheduled_at, '2026-08-01T10:00:00Z');
});

test('each scheduled post is held at the approval gate (not published)', () => {
  const { manager, content, tw } = setup();
  const [post] = social.schedulePost({ userId: manager, contentId: content.id, accountIds: [tw.id] });
  assert.equal(post.status, 'pending_approval');
  const gate = get("SELECT * FROM approval_processes WHERE post_id = ? AND status = 'pending'", [post.id]);
  assert.ok(gate, 'a pending post approval must exist');
});

test('scheduling to a disconnected account is rejected', () => {
  const { manager, content, tw } = setup();
  social.disconnectAccount({ userId: manager, accountId: tw.id });
  assert.throws(
    () => social.schedulePost({ userId: manager, contentId: content.id, accountIds: [tw.id] }),
    /not connected/
  );
});

test('scheduling is audited', () => {
  const { manager, content, tw } = setup();
  social.schedulePost({ userId: manager, contentId: content.id, accountIds: [tw.id] });
  assert.ok(get("SELECT * FROM audit_log WHERE action = 'social.post_scheduled'"));
});

test('post approvals appear in the pending queue with kind=post', async () => {
  const { manager, content, tw } = setup();
  social.schedulePost({ userId: manager, contentId: content.id, accountIds: [tw.id] });
  const { pendingApprovals } = await import('../src/trust/approvals.js');
  const pending = pendingApprovals();
  const postPending = pending.find((p) => p.kind === 'post');
  assert.ok(postPending);
  assert.equal(postPending.platform, 'twitter');
});
