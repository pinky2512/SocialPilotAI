// Trust control #2 — Approval gate.
//
// "AI proposes, human approves." High-stakes actions (publishing content,
// sending email, posting to social) must be HELD in approval_processes and can
// only reach a live status after a human decision. This module is the single
// gateway for opening, approving, and rejecting those holds — and every
// transition is written to the append-only audit log.

import { run, get, all } from '../db/index.js';
import { logAction } from './audit.js';

/**
 * Hold a content item for human approval. Moves content -> 'pending_approval'
 * and opens a pending approval_processes row. Idempotent-ish: if an open
 * request already exists for this content, it is returned instead of duplicated.
 *
 * @param {object} p
 * @param {number} p.contentId
 * @param {number|null} [p.requestedBy] actor requesting the hold (agent => null)
 * @returns {object} the approval_processes row.
 */
export function holdForApproval({ contentId, requestedBy = null }) {
  const content = get('SELECT * FROM content WHERE id = ?', [contentId]);
  if (!content) throw new Error(`holdForApproval: content ${contentId} not found`);

  const existing = get(
    "SELECT * FROM approval_processes WHERE content_id = ? AND status = 'pending'",
    [contentId]
  );
  if (existing) return existing;

  run("UPDATE content SET status = 'pending_approval' WHERE id = ?", [contentId]);
  const info = run(
    "INSERT INTO approval_processes (content_id, status) VALUES (?, 'pending')",
    [contentId]
  );
  logAction({
    userId: requestedBy,
    action: 'approval.requested',
    details: { contentId, approvalId: info.lastInsertRowid, from: content.status, to: 'pending_approval' },
  });
  return get('SELECT * FROM approval_processes WHERE id = ?', [info.lastInsertRowid]);
}

/**
 * Human approves a held item. Content -> 'approved' (ready to publish/send).
 * @returns {{ approval: object, content: object }}
 */
export function approve({ approvalId, approverId }) {
  const process = requireOpen(approvalId);
  run(
    "UPDATE approval_processes SET status = 'approved', approver_id = ?, decision_date = datetime('now') WHERE id = ?",
    [approverId, approvalId]
  );
  run("UPDATE content SET status = 'approved' WHERE id = ?", [process.content_id]);
  logAction({
    userId: approverId,
    action: 'approval.approved',
    details: { contentId: process.content_id, approvalId, decision: 'approved' },
  });
  return {
    approval: get('SELECT * FROM approval_processes WHERE id = ?', [approvalId]),
    content: get('SELECT * FROM content WHERE id = ?', [process.content_id]),
  };
}

/**
 * Human rejects a held item. Content -> 'rejected'.
 * @returns {{ approval: object, content: object }}
 */
export function reject({ approvalId, approverId, reason = '' }) {
  const process = requireOpen(approvalId);
  run(
    "UPDATE approval_processes SET status = 'rejected', approver_id = ?, decision_date = datetime('now') WHERE id = ?",
    [approverId, approvalId]
  );
  run("UPDATE content SET status = 'rejected' WHERE id = ?", [process.content_id]);
  logAction({
    userId: approverId,
    action: 'approval.rejected',
    details: { contentId: process.content_id, approvalId, decision: 'rejected', reason },
  });
  return {
    approval: get('SELECT * FROM approval_processes WHERE id = ?', [approvalId]),
    content: get('SELECT * FROM content WHERE id = ?', [process.content_id]),
  };
}

/** All pending approvals, with the content they gate. For the dashboard/queue. */
export function pendingApprovals() {
  return all(`
    SELECT ap.id AS approval_id, ap.status AS approval_status, ap.content_id,
           c.content_text, c.status AS content_status, c.creator_id, c.campaign_id
    FROM approval_processes ap
    JOIN content c ON c.id = ap.content_id
    WHERE ap.status = 'pending'
    ORDER BY ap.id ASC
  `);
}

function requireOpen(approvalId) {
  const process = get('SELECT * FROM approval_processes WHERE id = ?', [approvalId]);
  if (!process) throw new Error(`approval ${approvalId} not found`);
  if (process.status !== 'pending') {
    throw new Error(`approval ${approvalId} already decided (${process.status})`);
  }
  return process;
}
