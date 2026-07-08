// Email Campaign Agent — owns REQ-003.
// Commands: createEmailCampaign, scheduleEmail, sendEmail. Reacts to: emailApproval.
//
// Approval gate (CLAUDE.md agent map): email campaigns are HELD for human
// approval before sending. This agent never lets a campaign reach 'sent' without
// an approved approval_processes row (enforced in sendEmail + trust/approvals.js).

import { run, get, all } from '../db/index.js';
import { logAction } from '../trust/audit.js';
import { startTask, finishTask } from './taskTracker.js';
import { broker } from '../broker/index.js';
import { holdForApproval } from '../trust/approvals.js';

const AGENT_ID = 'email-campaign-agent';

/**
 * STORY-011 — create an email campaign draft.
 * @returns {object} the email_campaigns row (status 'draft').
 */
export function createEmailCampaign({ userId, name, subject, body, audience = null }) {
  if (!name || !name.trim()) throw new Error('campaign name is required');
  if (!subject || !subject.trim()) throw new Error('subject is required');
  if (!body || !body.trim()) throw new Error('body is required');

  const taskId = startTask({ agentId: AGENT_ID, taskType: 'createEmailCampaign' });
  try {
    const info = run(
      "INSERT INTO email_campaigns (name, subject, body, audience, status, created_by) VALUES (?, ?, ?, ?, 'draft', ?)",
      [name, subject, body, audience, userId]
    );
    const campaign = get('SELECT * FROM email_campaigns WHERE id = ?', [info.lastInsertRowid]);
    logAction({ userId, action: 'email.campaign_created', details: { campaignId: campaign.id, name, subject, audience } });
    finishTask(taskId, 'done');
    broker.publish('emailCampaignCreated', { campaignId: campaign.id, userId });
    return campaign;
  } catch (err) {
    finishTask(taskId, 'failed');
    throw err;
  }
}

/**
 * STORY-011 — schedule a campaign for a send time and HOLD it for approval.
 * Nothing sends here — a human must approve, then sendEmail runs.
 */
export function scheduleEmail({ userId, campaignId, scheduledAt }) {
  const campaign = get('SELECT * FROM email_campaigns WHERE id = ?', [campaignId]);
  if (!campaign) throw new Error(`campaign ${campaignId} not found`);
  if (!['draft', 'rejected'].includes(campaign.status)) {
    throw new Error(`campaign ${campaignId} is '${campaign.status}', only draft/rejected can be scheduled`);
  }

  const taskId = startTask({ agentId: AGENT_ID, taskType: 'scheduleEmail' });
  try {
    run('UPDATE email_campaigns SET scheduled_at = ? WHERE id = ?', [scheduledAt || null, campaignId]);
    logAction({ userId, action: 'email.campaign_scheduled', details: { campaignId, scheduledAt } });
    // Approval-gate contract: hold the campaign for human approval before send.
    const approval = holdForApproval({ kind: 'email', targetId: campaignId, requestedBy: userId });
    finishTask(taskId, 'done');
    broker.publish('emailApproval', { campaignId, approvalId: approval.id, event: 'submitted' });
    return { campaign: get('SELECT * FROM email_campaigns WHERE id = ?', [campaignId]), approval };
  } catch (err) {
    finishTask(taskId, 'failed');
    throw err;
  }
}

/**
 * STORY-011 — send an APPROVED campaign.
 *
 * Approval-gate enforcement: a campaign can ONLY send from status 'approved'.
 * The actual ESP send is simulated here — swap-in point for SendGrid/SES/etc.
 * Success/failure recorded in integration_logs and the audit log.
 */
export function sendEmail({ userId = null, campaignId }) {
  const campaign = get('SELECT * FROM email_campaigns WHERE id = ?', [campaignId]);
  if (!campaign) throw new Error(`campaign ${campaignId} not found`);
  if (campaign.status !== 'approved') {
    throw new Error(`campaign ${campaignId} is '${campaign.status}' — only approved campaigns can be sent`);
  }

  const taskId = startTask({ agentId: AGENT_ID, taskType: 'sendEmail' });
  try {
    // --- SWAP-IN POINT: real ESP call ---------------------------------------
    // input:  { subject, body, audience }
    // output: { providerMessageId, recipients }
    const providerMessageId = `esp-${campaignId}`;
    // ------------------------------------------------------------------------

    run("UPDATE email_campaigns SET status = 'sent', sent_at = datetime('now') WHERE id = ?", [campaignId]);
    logIntegration('email', 'send', 'success', { campaignId, providerMessageId });
    logAction({ userId, action: 'email.campaign_sent', details: { campaignId, providerMessageId, audience: campaign.audience } });
    finishTask(taskId, 'done');
    broker.publish('emailSent', { campaignId, providerMessageId });
    return get('SELECT * FROM email_campaigns WHERE id = ?', [campaignId]);
  } catch (err) {
    logIntegration('email', 'send', 'failed', { campaignId, error: String(err?.message || err) });
    finishTask(taskId, 'failed');
    throw err;
  }
}

export function listCampaigns({ status } = {}) {
  return status
    ? all('SELECT * FROM email_campaigns WHERE status = ? ORDER BY id DESC', [status])
    : all('SELECT * FROM email_campaigns ORDER BY id DESC');
}

function logIntegration(integrationType, action, status, details) {
  run(
    'INSERT INTO integration_logs (integration_type, action, status, details) VALUES (?, ?, ?, ?)',
    [integrationType, action, status, JSON.stringify(details)]
  );
}
