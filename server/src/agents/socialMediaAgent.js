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
import { SUPPORTED_PLATFORMS, adaptForPlatform } from './platformRules.js';
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

export function listPosts({ status } = {}) {
  return status
    ? all('SELECT * FROM social_posts WHERE status = ? ORDER BY id DESC', [status])
    : all('SELECT * FROM social_posts ORDER BY id DESC');
}

function logIntegration(integrationType, action, status, details) {
  const taskId = startTask({ agentId: AGENT_ID, taskType: `${action}Account` });
  run(
    'INSERT INTO integration_logs (integration_type, action, status, details) VALUES (?, ?, ?, ?)',
    [integrationType, action, status, JSON.stringify(details)]
  );
  finishTask(taskId, status === 'success' ? 'done' : 'failed');
}
