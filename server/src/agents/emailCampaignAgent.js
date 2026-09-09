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
import * as sendgrid from '../integrations/sendgrid.js';
import { recordEngagementEvent } from './analyticsAgent.js';

const AGENT_ID = 'email-campaign-agent';

/** Parse a recipients blob (comma / newline / space separated) into emails. */
export function parseRecipients(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
}

/**
 * STORY-011 — create an email campaign draft.
 * @returns {object} the email_campaigns row (status 'draft').
 */
export function createEmailCampaign({ userId, name, subject, body, audience = null, recipients = null }) {
  if (!name || !name.trim()) throw new Error('campaign name is required');
  if (!subject || !subject.trim()) throw new Error('subject is required');
  if (!body || !body.trim()) throw new Error('body is required');

  const taskId = startTask({ agentId: AGENT_ID, taskType: 'createEmailCampaign' });
  try {
    const info = run(
      "INSERT INTO email_campaigns (name, subject, body, audience, recipients, status, created_by) VALUES (?, ?, ?, ?, ?, 'draft', ?)",
      [name, subject, body, audience, recipients || null, userId]
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
    // SIMULATED ESP send (deterministic; used by tests + when no ESP configured).
    // The real provider path lives in sendEmailLive() below.
    const providerMessageId = `esp-${campaignId}`;
    const sent = markCampaignSent({ campaign, userId, providerMessageId, real: false });
    finishTask(taskId, 'done');
    return sent;
  } catch (err) {
    logIntegration('email', 'send', 'failed', { campaignId, error: String(err?.message || err) });
    finishTask(taskId, 'failed');
    throw err;
  }
}

/** Mark a campaign sent and record it (integration log + audit + broker). */
function markCampaignSent({ campaign, userId, providerMessageId, real, recipientCount = null }) {
  run("UPDATE email_campaigns SET status = 'sent', sent_at = datetime('now') WHERE id = ?", [campaign.id]);
  logIntegration('email', 'send', 'success', { campaignId: campaign.id, providerMessageId, real, recipientCount });
  logAction({
    userId,
    action: 'email.campaign_sent',
    details: { campaignId: campaign.id, providerMessageId, audience: campaign.audience, real, recipientCount },
  });
  broker.publish('emailSent', { campaignId: campaign.id, providerMessageId });
  return get('SELECT * FROM email_campaigns WHERE id = ?', [campaign.id]);
}

/**
 * STORY-011 (live) — send an APPROVED campaign via a real ESP (SendGrid) when
 * configured AND the campaign has recipients; otherwise falls back to the
 * simulated sendEmail. On a real send, each actual recipient is recorded as a
 * 'delivered' engagement event so the analytics delivered-count reflects reality
 * (opens/clicks still require an ESP webhook, which needs a public URL).
 * @returns {Promise<object>} the sent email_campaigns row.
 */
export async function sendEmailLive({ userId = null, campaignId }) {
  const campaign = get('SELECT * FROM email_campaigns WHERE id = ?', [campaignId]);
  if (!campaign) throw new Error(`campaign ${campaignId} not found`);
  if (campaign.status !== 'approved') {
    throw new Error(`campaign ${campaignId} is '${campaign.status}' — only approved campaigns can be sent`);
  }
  const recipients = parseRecipients(campaign.recipients);

  // No ESP or no recipients → simulated send.
  if (!sendgrid.isConfigured() || recipients.length === 0) {
    return sendEmail({ userId, campaignId });
  }

  const taskId = startTask({ agentId: AGENT_ID, taskType: 'sendEmailLive' });
  try {
    const { messageId } = await sendgrid.sendCampaign({ to: recipients, subject: campaign.subject, body: campaign.body, campaignId });
    // Real deliveries → real 'delivered' telemetry for the analytics dashboard.
    for (const email of recipients) {
      recordEngagementEvent({ campaignId, recipient: email, eventType: 'delivered' });
    }
    const sent = markCampaignSent({ campaign, userId, providerMessageId: messageId, real: true, recipientCount: recipients.length });
    finishTask(taskId, 'done');
    return sent;
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
