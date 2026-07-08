// Trust control #1 — Audit log.
//
// Append-only record of every meaningful action (who / what / when /
// before-after). This is the ONLY sanctioned way to write to audit_log, and it
// only ever INSERTs. The audit_log table additionally blocks UPDATE/DELETE at
// the DB level (see schema.sql triggers) so this invariant cannot be bypassed.

import { run, all, get } from '../db/index.js';

/**
 * Record an action in the append-only audit log.
 *
 * @param {object} entry
 * @param {number|null} entry.userId  Human actor id, or null for agent/system actions.
 * @param {string}      entry.action  Stable action key, e.g. 'content.generated'.
 * @param {object}      [entry.details] Arbitrary context (before/after, ids, actor).
 * @returns {object} the inserted row.
 */
export function logAction({ userId = null, action, details = {} }) {
  if (!action) throw new Error('audit.logAction requires an action');
  const detailsJson = JSON.stringify(details ?? {});
  const info = run(
    'INSERT INTO audit_log (user_id, action, details) VALUES (?, ?, ?)',
    [userId, action, detailsJson]
  );
  return get('SELECT * FROM audit_log WHERE id = ?', [info.lastInsertRowid]);
}

/** Recent audit entries, newest first. Used by the trust dashboard. */
export function recentActions(limit = 50) {
  return all(
    'SELECT * FROM audit_log ORDER BY id DESC LIMIT ?',
    [limit]
  ).map(parseDetails);
}

/** Full audit trail for a single content item. */
export function actionsForContent(contentId) {
  return all(
    "SELECT * FROM audit_log WHERE json_extract(details, '$.contentId') = ? ORDER BY id ASC",
    [contentId]
  ).map(parseDetails);
}

/** Full audit trail for a single social post. */
export function actionsForPost(postId) {
  return all(
    "SELECT * FROM audit_log WHERE json_extract(details, '$.postId') = ? ORDER BY id ASC",
    [postId]
  ).map(parseDetails);
}

/**
 * Query the audit log with optional filters. Read-only; supports the audit UI
 * and compliance review. `actionPrefix` matches e.g. 'social.' for all social
 * actions.
 */
export function queryAudit({ action, actionPrefix, userId, limit = 100 } = {}) {
  const where = [];
  const params = [];
  if (action) { where.push('action = ?'); params.push(action); }
  if (actionPrefix) { where.push('action LIKE ?'); params.push(`${actionPrefix}%`); }
  if (userId != null) { where.push('user_id = ?'); params.push(userId); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit);
  return all(`SELECT * FROM audit_log ${clause} ORDER BY id DESC LIMIT ?`, params).map(parseDetails);
}

/** Distinct action keys seen in the log (for filter menus). */
export function auditActionTypes() {
  return all('SELECT DISTINCT action FROM audit_log ORDER BY action ASC').map((r) => r.action);
}

function parseDetails(row) {
  try {
    return { ...row, details: JSON.parse(row.details ?? '{}') };
  } catch {
    return row;
  }
}
