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
import { startTask, finishTask } from './taskTracker.js';
import { broker } from '../broker/index.js';
import { get } from '../db/index.js';

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
    finishTask(taskId, 'done');
    // React/announce so the owning agent (e.g. content publishing) can proceed.
    broker.publish('approvalDecision', {
      approvalId,
      contentId: result.content.id,
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

// Governance observes content generation across the system for transparency.
// (It does not act — generation is not gated — but the observation is auditable.)
broker.subscribe('contentGenerated', ({ contentId, creatorId }) => {
  logAction({
    userId: null,
    action: 'governance.observed',
    details: { agent: AGENT_ID, event: 'contentGenerated', contentId, creatorId },
  });
});
