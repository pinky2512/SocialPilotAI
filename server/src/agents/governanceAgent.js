// Governance and Compliance Agent — owns REQ-007, REQ-009, REQ-010.
// Commands: holdForApproval, logAction, processDataRequest.
// Reacts to: approvalDecision, dataRequest.
//
// This agent manages ALL approval gates and observes every meaningful command
// in the system (CLAUDE.md multi-agent map). It is the single place other parts
// of the app go through to hold content for approval or record a governed
// decision — it never lets a gated item reach a live status without a human
// decision recorded in approval_processes.

import { holdForApproval, approve, reject, pendingApprovals } from '../trust/approvals.js';
import { logAction } from '../trust/audit.js';
import { notifyRole } from '../trust/notifications.js';
import { ROLES } from '../auth/roles.js';
import { recordFeedback } from './contentGenerationAgent.js';
import { startTask, finishTask } from './taskTracker.js';
import { broker } from '../broker/index.js';
import { get, run, all } from '../db/index.js';

const AGENT_ID = 'governance-and-compliance-agent';

/**
 * Submit a draft into the approval gate. Content -> 'pending_approval'.
 * Segregation of duties is enforced later at decision time (STORY-036 RBAC).
 */
export function submitForApproval({ contentId, requestedBy }) {
  const taskId = startTask({ agentId: AGENT_ID, taskType: 'holdForApproval' });
  try {
    const content = get('SELECT * FROM content WHERE id = ?', [contentId]);
    if (!content) throw new Error(`content ${contentId} not found`);
    if (content.status !== 'draft' && content.status !== 'rejected') {
      throw new Error(`content ${contentId} is '${content.status}', only drafts can be submitted`);
    }
    const approval = holdForApproval({ contentId, requestedBy });
    // STORY-030 — notify the approvers (administrators) that content is waiting.
    notifyRole(ROLES.ADMINISTRATOR, {
      type: 'content_approval_pending',
      message: `Content #${contentId} is awaiting your approval.`,
      entityType: 'content',
      entityId: contentId,
    });
    finishTask(taskId, 'done');
    broker.publish('contentApproval', { contentId, approvalId: approval.id, event: 'submitted' });
    return approval;
  } catch (err) {
    finishTask(taskId, 'failed');
    throw err;
  }
}

/**
 * Record a human approval/rejection decision on a held item.
 * @param {'approved'|'rejected'} decision
 */
export function decide({ approvalId, approverId, decision, reason = '' }) {
  const taskId = startTask({ agentId: AGENT_ID, taskType: 'approvalDecision' });
  try {
    const result = decision === 'approved'
      ? approve({ approvalId, approverId })
      : reject({ approvalId, approverId, reason });

    // STORY-031 — a content rejection is an implicit negative training signal.
    if (decision === 'rejected' && result.kind === 'content') {
      recordFeedback({ contentId: result.target.id, userId: approverId, rating: 'down', comment: reason, source: 'implicit' });
    }
    finishTask(taskId, 'done');
    // React/announce so the owning agent (e.g. content/post publishing) can proceed.
    broker.publish('approvalDecision', {
      approvalId,
      kind: result.kind,
      targetId: result.target.id,
      contentId: result.kind === 'content' ? result.target.id : undefined,
      decision,
      approverId,
    });
    return result;
  } catch (err) {
    finishTask(taskId, 'failed');
    throw err;
  }
}

export function listPending() {
  return pendingApprovals();
}

export function listPendingPosts() {
  return pendingApprovals().filter((p) => p.kind === 'post');
}

/**
 * STORY-008 — submit (or re-submit) a social post into the approval gate.
 * Used to route a 'draft' post for approval, or to re-submit a post that was
 * previously 'rejected' (e.g. after editing). Posts already published/approved
 * cannot be submitted.
 */
export function submitPostForApproval({ postId, requestedBy }) {
  const taskId = startTask({ agentId: AGENT_ID, taskType: 'holdForApproval' });
  try {
    const post = get('SELECT * FROM social_posts WHERE id = ?', [postId]);
    if (!post) throw new Error(`post ${postId} not found`);
    if (!['draft', 'rejected'].includes(post.status)) {
      throw new Error(`post ${postId} is '${post.status}', only draft/rejected posts can be submitted`);
    }
    const approval = holdForApproval({ kind: 'post', targetId: postId, requestedBy });
    finishTask(taskId, 'done');
    broker.publish('postApproval', { postId, approvalId: approval.id, event: 'submitted' });
    return approval;
  } catch (err) {
    finishTask(taskId, 'failed');
    throw err;
  }
}

/**
 * STORY-024 — propose a predictive recommendation for adoption and HOLD it at
 * the approval gate. The recommendation is only "accepted" once a human approves
 * it (via decide → approve). Nothing is auto-adopted.
 *
 * @returns {{ recommendation: object, approval: object }}
 */
export function proposeRecommendation({ campaignId = null, type, message, rationale = '', priority = 'medium', requestedBy }) {
  if (!type || !message) throw new Error('recommendation type and message are required');
  const taskId = startTask({ agentId: AGENT_ID, taskType: 'holdForApproval' });
  try {
    const info = run(
      "INSERT INTO predictive_recommendations (campaign_id, type, message, rationale, priority, status, proposed_by) VALUES (?, ?, ?, ?, ?, 'proposed', ?)",
      [campaignId, type, message, rationale, priority, requestedBy]
    );
    const recId = info.lastInsertRowid;
    logAction({
      userId: requestedBy,
      action: 'recommendation.proposed',
      details: { recommendationId: recId, campaignId, type, priority },
    });
    const approval = holdForApproval({ kind: 'recommendation', targetId: recId, requestedBy });
    finishTask(taskId, 'done');
    broker.publish('recommendationApproval', { recommendationId: recId, approvalId: approval.id, event: 'proposed' });
    return {
      recommendation: get('SELECT * FROM predictive_recommendations WHERE id = ?', [recId]),
      approval,
    };
  } catch (err) {
    finishTask(taskId, 'failed');
    throw err;
  }
}

/**
 * STORY-026 — Governance Score for Predictive Analytics (TBI control #5).
 * Live 0–100 score from three governance signals for the predictive-analytics
 * domain, with fix recommendations when it drops below threshold:
 *   - % audited          : proposed recommendations that have an audit entry
 *   - % approvals honored : proposed recommendations that were actually decided
 *   - failure rate        : analytics-agent task failures (inverted into score)
 */
export function predictiveGovernanceScore() {
  const recs = all('SELECT * FROM predictive_recommendations');
  const total = recs.length;
  const decided = recs.filter((r) => r.status === 'approved' || r.status === 'rejected').length;
  const pending = total - decided;

  const auditedCount = all(
    "SELECT COUNT(DISTINCT json_extract(details, '$.recommendationId')) AS n FROM audit_log WHERE action = 'recommendation.proposed'"
  )[0].n;

  const at = all("SELECT status, COUNT(*) AS n FROM ai_agent_tasks WHERE agent_id = 'analytics-agent' GROUP BY status");
  const byStatus = Object.fromEntries(at.map((r) => [r.status, r.n]));
  const analyticsTotal = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const analyticsFailed = byStatus.failed || 0;

  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 100);
  const auditedPct = pct(auditedCount, total);
  const honoredPct = pct(decided, total);
  const failureRate = analyticsTotal ? Math.round((analyticsFailed / analyticsTotal) * 1000) / 10 : 0;

  // Weighted score: audit + honored gates matter most; failures penalize.
  const score = Math.round(0.4 * auditedPct + 0.4 * honoredPct + 0.2 * (100 - failureRate));
  const THRESHOLD = 70;

  const recommendations = [];
  if (auditedPct < 100) {
    recommendations.push('Some predictive recommendations are missing audit entries — ensure every proposal is logged.');
  }
  if (honoredPct < 80 && pending > 0) {
    recommendations.push(`${pending} proposed recommendation(s) await a human decision — review the approval queue.`);
  }
  if (failureRate > 10) {
    recommendations.push('Analytics-agent task failures are elevated — investigate failed tasks on the Trust dashboard.');
  }

  return {
    score,
    status: score >= THRESHOLD ? 'good' : 'below_threshold',
    threshold: THRESHOLD,
    metrics: { auditedPct, honoredPct, failureRate, totalRecommendations: total, decided, pending },
    recommendations,
  };
}

export function listRecommendations({ status } = {}) {
  return status
    ? all('SELECT * FROM predictive_recommendations WHERE status = ? ORDER BY id DESC', [status])
    : all('SELECT * FROM predictive_recommendations ORDER BY id DESC');
}

// Governance observes content generation across the system for transparency.
// (It does not act — generation is not gated — but the observation is auditable.)
broker.subscribe('contentGenerated', ({ contentId, creatorId }) => {
  logAction({
    userId: null,
    action: 'governance.observed',
    details: { agent: AGENT_ID, event: 'contentGenerated', contentId, creatorId },
  });
});
