// Social Media Posting Agent — owns REQ-002.
// Commands: schedulePost, publishPost (+ connectAccount for STORY-004).
// Reacts to: postApproval.
//
// Approval gate (CLAUDE.md agent map): posts are HELD for human approval before
// publishing. This agent never lets a post reach 'published' without an approved
// approval_processes row (enforced in publishPost + trust/approvals.js).

import { run, get, all } from '../db/index.js';
import { logAction } from '../trust/audit.js';
import { startTask, finishTask } from './taskTracker.js';
import { broker } from '../broker/index.js';
import { SUPPORTED_PLATFORMS, PLATFORM_RULES, adaptForPlatform, validateForPlatform, rulesFor } from './platformRules.js';
import { holdForApproval } from '../trust/approvals.js';

const AGENT_ID = 'social-media-posting-agent';

/**
 * STORY-004 — connect a social media account for a user.
 *
 * DEV NOTE: a production build performs an OAuth 2.0 authorization-code flow and
 * stores the returned token. Here the token is a placeholder; this function is
 * the swap-in point. The connection attempt is recorded in integration_logs.
 *
 * @returns {object} the social_accounts row.
 */
export function connectAccount({ userId, platform, handle, accessToken = null }) {
  platform = String(platform || '').toLowerCase();
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    logIntegration(platform, 'connect', 'failed', { userId, handle, reason: 'unsupported platform' });
    throw new Error(`unsupported platform '${platform}'`);
  }
  if (!handle || !handle.trim()) throw new Error('handle is required');

  const existing = get(
    'SELECT * FROM social_accounts WHERE user_id = ? AND platform = ? AND handle = ?',
    [userId, platform, handle]
  );
  if (existing) {
    // Reconnect a previously disconnected account.
    run("UPDATE social_accounts SET status = 'connected', access_token = ? WHERE id = ?",
      [accessToken ?? existing.access_token, existing.id]);
  } else {
    run(
      "INSERT INTO social_accounts (user_id, platform, handle, access_token, status) VALUES (?, ?, ?, ?, 'connected')",
      [userId, platform, handle, accessToken ?? `dev-token-${platform}`]
    );
  }
  const account = get(
    'SELECT * FROM social_accounts WHERE user_id = ? AND platform = ? AND handle = ?',
    [userId, platform, handle]
  );

  logIntegration(platform, 'connect', 'success', { userId, handle, accountId: account.id });
  logAction({ userId, action: 'social.account_connected', details: { accountId: account.id, platform, handle } });
  broker.publish('socialAccountConnected', { accountId: account.id, userId, platform });
  return account;
}

/** Disconnect an account (kept as a row; status flips to 'disconnected'). */
export function disconnectAccount({ userId, accountId }) {
  const account = get('SELECT * FROM social_accounts WHERE id = ?', [accountId]);
  if (!account) throw new Error(`account ${accountId} not found`);
  run("UPDATE social_accounts SET status = 'disconnected' WHERE id = ?", [accountId]);
  logIntegration(account.platform, 'disconnect', 'success', { userId, accountId });
  logAction({ userId, action: 'social.account_disconnected', details: { accountId, platform: account.platform } });
  return get('SELECT * FROM social_accounts WHERE id = ?', [accountId]);
}

export function listAccounts(userId) {
  return all('SELECT * FROM social_accounts WHERE user_id = ? ORDER BY id DESC', [userId]);
}

/**
 * STORY-005 — schedule a post to one or more connected accounts.
 *
 * Creates one social_posts row per target account (text adapted to each
 * platform), then HOLDS each post at the approval gate. Nothing publishes here
 * — a human must approve, then STORY-007 publishPost runs. Only 'connected'
 * accounts may be targeted.
 *
 * @param {object} p
 * @param {number}   p.userId
 * @param {number}   p.contentId    approved content being posted
 * @param {number[]} p.accountIds   target connected accounts
 * @param {string}   [p.scheduledAt] ISO datetime to publish
 * @returns {object[]} the created (held) social_posts rows.
 */
export function schedulePost({ userId, contentId, accountIds, scheduledAt = null }) {
  const content = get('SELECT * FROM content WHERE id = ?', [contentId]);
  if (!content) throw new Error(`content ${contentId} not found`);
  if (!Array.isArray(accountIds) || accountIds.length === 0) {
    throw new Error('at least one target accountId is required');
  }

  const taskId = startTask({ agentId: AGENT_ID, taskType: 'schedulePost' });
  try {
    const created = [];
    for (const accountId of accountIds) {
      const account = get('SELECT * FROM social_accounts WHERE id = ?', [accountId]);
      if (!account) throw new Error(`account ${accountId} not found`);
      if (account.status !== 'connected') {
        throw new Error(`account ${accountId} (${account.platform}) is not connected`);
      }
      const postText = adaptForPlatform(content.content_text, account.platform);
      const info = run(
        `INSERT INTO social_posts (content_id, account_id, platform, post_text, scheduled_at, status, created_by)
         VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
        [contentId, accountId, account.platform, postText, scheduledAt, userId]
      );
      const postId = info.lastInsertRowid;
      logAction({
        userId,
        action: 'social.post_scheduled',
        details: { postId, contentId, accountId, platform: account.platform, scheduledAt },
      });
      // Approval-gate contract: hold the post for human approval before publish.
      holdForApproval({ kind: 'post', targetId: postId, requestedBy: userId });
      broker.publish('postApproval', { postId, event: 'submitted' });
      created.push(get('SELECT * FROM social_posts WHERE id = ?', [postId]));
    }
    finishTask(taskId, 'done');
    return created;
  } catch (err) {
    finishTask(taskId, 'failed');
    throw err;
  }
}

/**
 * STORY-006 — preview how a draft adapts to each platform's nuances, with any
 * residual validation issues, so a human can review before scheduling.
 * @param {string} text
 * @param {string[]} [platforms] defaults to all supported platforms
 */
export function previewForPlatforms(text, platforms = SUPPORTED_PLATFORMS) {
  return platforms.map((platform) => {
    const rules = rulesFor(platform);
    const adapted = adaptForPlatform(text, platform);
    return {
      platform,
      note: rules?.note,
      original: String(text),
      adapted,
      validation: validateForPlatform(adapted, platform),
    };
  });
}

export function platformCatalog() {
  return SUPPORTED_PLATFORMS.map((platform) => ({ platform, ...PLATFORM_RULES[platform] }));
}

export function listPosts({ status } = {}) {
  return status
    ? all('SELECT * FROM social_posts WHERE status = ? ORDER BY id DESC', [status])
    : all('SELECT * FROM social_posts ORDER BY id DESC');
}

/**
 * STORY-007 — publish an approved post to its platform.
 *
 * Approval-gate enforcement: a post can ONLY publish from status 'approved'
 * (i.e. it passed the human approval gate). Any other status is refused. The
 * actual platform API call is simulated here — this is the swap-in point for a
 * real integration (Twitter/LinkedIn/etc. SDK). Success/failure is recorded in
 * integration_logs and the audit log.
 *
 * @returns {object} the published social_posts row.
 */
export function publishPost({ postId, userId = null }) {
  const post = get('SELECT * FROM social_posts WHERE id = ?', [postId]);
  if (!post) throw new Error(`post ${postId} not found`);
  if (post.status !== 'approved') {
    throw new Error(`post ${postId} is '${post.status}' — only approved posts can be published`);
  }

  const taskId = startTask({ agentId: AGENT_ID, taskType: 'publishPost' });
  try {
    // --- SWAP-IN POINT: real platform API call --------------------------------
    // input:  { platform, handle, text, accessToken }
    // output: { externalId }  (id of the created post on the platform)
    const externalId = `${post.platform}-${postId}-${post.account_id}`;
    // -------------------------------------------------------------------------

    run(
      "UPDATE social_posts SET status = 'published', published_at = datetime('now') WHERE id = ?",
      [postId]
    );
    logIntegration(post.platform, 'publish', 'success', { postId, externalId, accountId: post.account_id });
    logAction({
      userId,
      action: 'social.post_published',
      details: { postId, platform: post.platform, accountId: post.account_id, externalId },
    });
    finishTask(taskId, 'done');
    broker.publish('postPublished', { postId, platform: post.platform, externalId });
    return get('SELECT * FROM social_posts WHERE id = ?', [postId]);
  } catch (err) {
    run("UPDATE social_posts SET status = 'failed' WHERE id = ?", [postId]);
    logIntegration(post.platform, 'publish', 'failed', { postId, error: String(err?.message || err) });
    finishTask(taskId, 'failed');
    throw err;
  }
}

/**
 * Publish all approved posts that are due (scheduled_at <= now, or unscheduled).
 * This is the "post to multiple platforms" batch a scheduler would call. Returns
 * a per-post result so one platform failing never blocks the others.
 */
export function publishDuePosts({ userId = null, now = new Date().toISOString() } = {}) {
  const due = all(
    "SELECT * FROM social_posts WHERE status = 'approved' AND (scheduled_at IS NULL OR scheduled_at <= ?)",
    [now]
  );
  const results = [];
  for (const post of due) {
    try {
      const published = publishPost({ postId: post.id, userId });
      results.push({ postId: post.id, platform: post.platform, status: 'published', published });
    } catch (err) {
      results.push({ postId: post.id, platform: post.platform, status: 'failed', error: err.message });
    }
  }
  return results;
}

function logIntegration(integrationType, action, status, details) {
  const taskId = startTask({ agentId: AGENT_ID, taskType: `${action}Account` });
  run(
    'INSERT INTO integration_logs (integration_type, action, status, details) VALUES (?, ?, ?, ?)',
    [integrationType, action, status, JSON.stringify(details)]
  );
  finishTask(taskId, status === 'success' ? 'done' : 'failed');
}
