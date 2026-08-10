// Privacy / data-subject rights (GDPR/CCPA) — REQ-010 (Governance & Compliance).
//
// STORY-033: export and erase personal data for a data subject (identified by
// email). Right-to-erasure is reconciled with the append-only audit log by
// ANONYMIZING PII in mutable tables (leads, engagement recipients, user record)
// and LOGGING the deletion — the immutable audit log is retained as the
// compliance record, and only a salted hash of the subject is stored in it, so
// erasure never re-introduces PII into the log.

import { createHash } from 'node:crypto';
import { all, get, run } from '../db/index.js';
import { logAction } from './audit.js';

function subjectHash(email) {
  return createHash('sha256').update(`subject:${email}`).digest('hex').slice(0, 16);
}

/**
 * Export everything held about a data subject (by email), machine-readable.
 * Access is itself auditable.
 */
export function exportSubjectData({ email, requestedBy = null }) {
  if (!email || !email.trim()) throw new Error('a subject email is required');
  const user = get('SELECT id, name, role, email, created_at FROM users WHERE email = ?', [email]) || null;
  const lead = get('SELECT * FROM leads WHERE email = ?', [email]) || null;
  const engagementEvents = all(
    'SELECT * FROM email_engagement_events WHERE recipient = ? ORDER BY id ASC',
    [email]
  );

  logAction({
    userId: requestedBy,
    action: 'data.exported',
    details: { subjectHash: subjectHash(email), leadFound: !!lead, userFound: !!user, events: engagementEvents.length },
  });

  return {
    subject: email,
    exportedAt: new Date().toISOString(),
    user,
    lead,
    engagementEvents,
  };
}

/**
 * Erase a data subject's PII (right to erasure). Anonymizes mutable records and
 * logs the deletion; the append-only audit trail is preserved.
 * @returns {object} summary of what was anonymized.
 */
export function deleteSubjectData({ email, requestedBy = null }) {
  if (!email || !email.trim()) throw new Error('a subject email is required');

  let leadsAnonymized = 0;
  let eventsAnonymized = 0;
  let userAnonymized = 0;

  const lead = get('SELECT id FROM leads WHERE email = ?', [email]);
  if (lead) {
    run('UPDATE leads SET email = ?, name = NULL WHERE id = ?', [`deleted:${lead.id}`, lead.id]);
    leadsAnonymized = 1;
  }

  const ev = run("UPDATE email_engagement_events SET recipient = 'deleted' WHERE recipient = ?", [email]);
  eventsAnonymized = ev.changes ?? 0;

  const user = get('SELECT id FROM users WHERE email = ?', [email]);
  if (user) {
    run("UPDATE users SET name = '[deleted]', email = ?, hashed_password = '' WHERE id = ?",
      [`deleted:${user.id}@removed.invalid`, user.id]);
    userAnonymized = 1;
  }

  logAction({
    userId: requestedBy,
    action: 'data.deleted',
    details: { subjectHash: subjectHash(email), leadsAnonymized, eventsAnonymized, userAnonymized },
  });

  return { ok: true, subjectHash: subjectHash(email), leadsAnonymized, eventsAnonymized, userAnonymized };
}
