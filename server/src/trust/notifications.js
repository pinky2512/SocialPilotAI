// Notifications — REQ-007 (Governance and Compliance Agent).
//
// STORY-030: notify the right users when something needs their attention (e.g.
// content pending their approval). A small, queryable inbox per user.

import { run, get, all } from '../db/index.js';

/** Create a notification for a single recipient. */
export function notify({ userId, type, message, entityType = null, entityId = null }) {
  const info = run(
    'INSERT INTO notifications (user_id, type, message, entity_type, entity_id) VALUES (?, ?, ?, ?, ?)',
    [userId, type, message, entityType, entityId]
  );
  return get('SELECT * FROM notifications WHERE id = ?', [info.lastInsertRowid]);
}

/** Notify every user holding a given role (e.g. all administrators/approvers). */
export function notifyRole(role, payload) {
  const recipients = all('SELECT id FROM users WHERE role = ?', [role]);
  return recipients.map((u) => notify({ ...payload, userId: u.id }));
}

export function listForUser(userId, { unreadOnly = false, limit = 50 } = {}) {
  const clause = unreadOnly ? 'AND is_read = 0' : '';
  return all(
    `SELECT * FROM notifications WHERE user_id = ? ${clause} ORDER BY id DESC LIMIT ?`,
    [userId, limit]
  );
}

export function unreadCount(userId) {
  return get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', [userId]).n;
}

export function markRead(userId, id) {
  run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [id, userId]);
  return get('SELECT * FROM notifications WHERE id = ?', [id]);
}

export function markAllRead(userId) {
  run('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [userId]);
  return { ok: true };
}
