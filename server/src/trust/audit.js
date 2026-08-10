// Trust control #1 — Audit log.
//
// Append-only record of every meaningful action (who / what / when /
// before-after). This is the ONLY sanctioned way to write to audit_log, and it
// only ever INSERTs. The audit_log table additionally blocks UPDATE/DELETE at
// the DB level (see schema.sql triggers) so this invariant cannot be bypassed.

import { createHash } from 'node:crypto';
import { run, all, get } from '../db/index.js';

// STORY-032 — hash of (previous hash | this row's fields). Position and content
// are both bound in, so reordering or editing any entry breaks the chain.
function chainHash(prevHash, userId, action, ts, detailsJson) {
  return createHash('sha256')
    .update(`${prevHash}|${userId ?? ''}|${action}|${ts}|${detailsJson}`)
    .digest('hex');
}

/**
 * Record an action in the append-only, tamper-evident audit log.
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
  const prev = get('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1');
  const prevHash = prev?.hash || '';
  const ts = new Date().toISOString();
  const hash = chainHash(prevHash, userId, action, ts, detailsJson);
  const info = run(
    'INSERT INTO audit_log (user_id, action, timestamp, details, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, action, ts, detailsJson, prevHash, hash]
  );
  return get('SELECT * FROM audit_log WHERE id = ?', [info.lastInsertRowid]);
}

/**
 * STORY-032 — verify the audit chain is intact (no entry altered, removed, or
 * reordered). Recomputes each row's hash and checks the prev-hash links.
 * @returns {{ ok: boolean, count: number, brokenAt?: number }}
 */
export function verifyAuditIntegrity() {
  const rows = all('SELECT id, user_id, action, timestamp, details, prev_hash, hash FROM audit_log ORDER BY id ASC');
  let prevHash = '';
  for (const r of rows) {
    if (r.hash == null) continue; // legacy row predating the chain — skip
    const expected = chainHash(r.prev_hash ?? '', r.user_id, r.action, r.timestamp, r.details ?? '{}');
    if ((r.prev_hash ?? '') !== prevHash || r.hash !== expected) {
      return { ok: false, count: rows.length, brokenAt: r.id };
    }
    prevHash = r.hash;
  }
  return { ok: true, count: rows.length };
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
export function queryAudit({ action, actionPrefix, userId, limit = 100, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (action) { where.push('action = ?'); params.push(action); }
  if (actionPrefix) { where.push('action LIKE ?'); params.push(`${actionPrefix}%`); }
  if (userId != null) { where.push('user_id = ?'); params.push(userId); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit, offset);
  return all(`SELECT * FROM audit_log ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`, params).map(parseDetails);
}

/** Count audit rows matching the same filters (for pagination totals). */
export function countAudit({ action, actionPrefix, userId } = {}) {
  const where = [];
  const params = [];
  if (action) { where.push('action = ?'); params.push(action); }
  if (actionPrefix) { where.push('action LIKE ?'); params.push(`${actionPrefix}%`); }
  if (userId != null) { where.push('user_id = ?'); params.push(userId); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return all(`SELECT COUNT(*) AS n FROM audit_log ${clause}`, params)[0].n;
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
