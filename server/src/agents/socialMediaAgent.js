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
import { SUPPORTED_PLATFORMS } from './platformRules.js';

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

function logIntegration(integrationType, action, status, details) {
  const taskId = startTask({ agentId: AGENT_ID, taskType: `${action}Account` });
  run(
    'INSERT INTO integration_logs (integration_type, action, status, details) VALUES (?, ?, ?, ?)',
    [integrationType, action, status, JSON.stringify(details)]
  );
  finishTask(taskId, status === 'success' ? 'done' : 'failed');
}
