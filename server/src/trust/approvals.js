// Trust control #2 — Approval gate (generic).
//
// "AI proposes, human approves." High-stakes actions (publishing content,
// posting to social, sending email) must be HELD in approval_processes and can
// only reach a live status after a human decision. This module is the single
// gateway for opening, approving, and rejecting those holds for every gated
// entity kind. Every transition is written to the append-only audit log.

import { run, get, all } from '../db/index.js';
import { logAction } from './audit.js';

// Each gated entity kind declares its table, the approval_processes FK column
// that points at it, and its status vocabulary. Exactly one target FK column is
// set per approval_processes row.
const TARGETS = {
  content: {
    table: 'content', fk: 'content_id',
    pending: 'pending_approval', approved: 'approved', rejected: 'rejected',
  },
  post: {
    table: 'social_posts', fk: 'post_id',
    pending: 'pending_approval', approved: 'approved', rejected: 'rejected',
  },
  email: {
    table: 'email_campaigns', fk: 'email_campaign_id',
    pending: 'pending_approval', approved: 'approved', rejected: 'rejected',
  },
};

/**
 * Hold an entity for human approval. Moves the target -> its 'pending' status
 * and opens a pending approval_processes row. If an open request already exists
 * for this target it is returned instead of duplicated.
 *
 * Back-compatible: holdForApproval({ contentId }) still works (kind defaults to
 * 'content'). Prefer holdForApproval({ kind, targetId }) for other entities.
 *
 * @returns {object} the approval_processes row.
 */
export function holdForApproval({ kind = 'content', targetId, contentId, requestedBy = null }) {
  if (contentId != null) { kind = 'content'; targetId = contentId; }
  const t = target(kind);

  const row = get(`SELECT * FROM ${t.table} WHERE id = ?`, [targetId]);
  if (!row) throw new Error(`holdForApproval: ${kind} ${targetId} not found`);

  const existing = get(
    `SELECT * FROM approval_processes WHERE ${t.fk} = ? AND status = 'pending'`,
    [targetId]
  );
  if (existing) return existing;

  run(`UPDATE ${t.table} SET status = ? WHERE id = ?`, [t.pending, targetId]);
  const info = run(
    `INSERT INTO approval_processes (${t.fk}, status) VALUES (?, 'pending')`,
    [targetId]
  );
  logAction({
    userId: requestedBy,
    action: 'approval.requested',
    details: { kind, targetId, contentId: kind === 'content' ? targetId : undefined, approvalId: info.lastInsertRowid, from: row.status, to: t.pending },
  });
  return get('SELECT * FROM approval_processes WHERE id = ?', [info.lastInsertRowid]);
}

/** Human approves a held item. Target -> its 'approved' status. */
export function approve({ approvalId, approverId }) {
  return decideInternal({ approvalId, approverId, decision: 'approved' });
}

/** Human rejects a held item. Target -> its 'rejected' status. */
export function reject({ approvalId, approverId, reason = '' }) {
  return decideInternal({ approvalId, approverId, decision: 'rejected', reason });
}

function decideInternal({ approvalId, approverId, decision, reason = '' }) {
  const process = requireOpen(approvalId);
  const { kind, t, targetId } = resolveTarget(process);
  const nextStatus = decision === 'approved' ? t.approved : t.rejected;

  run(
    "UPDATE approval_processes SET status = ?, approver_id = ?, decision_date = datetime('now') WHERE id = ?",
    [decision, approverId, approvalId]
  );
  run(`UPDATE ${t.table} SET status = ? WHERE id = ?`, [nextStatus, targetId]);

  logAction({
    userId: approverId,
    action: `approval.${decision}`,
    details: { kind, targetId, contentId: kind === 'content' ? targetId : undefined, approvalId, decision, reason: reason || undefined },
  });

  return {
    approval: get('SELECT * FROM approval_processes WHERE id = ?', [approvalId]),
    // Back-compat: content approvals expose `.content`; all expose `.target`.
    ...(kind === 'content' ? { content: get('SELECT * FROM content WHERE id = ?', [targetId]) } : {}),
    target: get(`SELECT * FROM ${t.table} WHERE id = ?`, [targetId]),
    kind,
  };
}

/** All pending approvals across kinds, with a preview of the gated item. */
export function pendingApprovals() {
  const content = all(`
    SELECT ap.id AS approval_id, ap.status AS approval_status, 'content' AS kind,
           ap.content_id, c.content_text AS preview, c.status AS target_status,
           c.creator_id, c.campaign_id
    FROM approval_processes ap
    JOIN content c ON c.id = ap.content_id
    WHERE ap.status = 'pending' AND ap.content_id IS NOT NULL
  `);
  const posts = all(`
    SELECT ap.id AS approval_id, ap.status AS approval_status, 'post' AS kind,
           ap.post_id, sp.post_text AS preview, sp.status AS target_status,
           sp.created_by AS creator_id, sp.platform, sp.scheduled_at
    FROM approval_processes ap
    JOIN social_posts sp ON sp.id = ap.post_id
    WHERE ap.status = 'pending' AND ap.post_id IS NOT NULL
  `);
  const emails = all(`
    SELECT ap.id AS approval_id, ap.status AS approval_status, 'email' AS kind,
           ap.email_campaign_id, (ec.name || ' — ' || ec.subject) AS preview,
           ec.status AS target_status, ec.created_by AS creator_id, ec.scheduled_at
    FROM approval_processes ap
    JOIN email_campaigns ec ON ec.id = ap.email_campaign_id
    WHERE ap.status = 'pending' AND ap.email_campaign_id IS NOT NULL
  `);
  return [...content, ...posts, ...emails].sort((a, b) => a.approval_id - b.approval_id);
}

function target(kind) {
  const t = TARGETS[kind];
  if (!t) throw new Error(`unknown approval kind '${kind}'`);
  return t;
}

function resolveTarget(process) {
  for (const [kind, t] of Object.entries(TARGETS)) {
    if (process[t.fk] != null) return { kind, t, targetId: process[t.fk] };
  }
  throw new Error(`approval ${process.id} has no target`);
}

function requireOpen(approvalId) {
  const process = get('SELECT * FROM approval_processes WHERE id = ?', [approvalId]);
  if (!process) throw new Error(`approval ${approvalId} not found`);
  if (process.status !== 'pending') {
    throw new Error(`approval ${approvalId} already decided (${process.status})`);
  }
  return process;
}
