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

// Gather all data held about a subject (no audit side effect).
function gatherSubjectData(email) {
  const user = get('SELECT id, name, role, email, created_at FROM users WHERE email = ?', [email]) || null;
  const lead = get('SELECT * FROM leads WHERE email = ?', [email]) || null;
  const engagementEvents = all(
    'SELECT * FROM email_engagement_events WHERE recipient = ? ORDER BY id ASC',
    [email]
  );
  return { subject: email, exportedAt: new Date().toISOString(), user, lead, engagementEvents };
}

/**
 * Export everything held about a data subject (by email), machine-readable.
 * Access is itself auditable. (Immediate export; the queued variant is below.)
 */
export function exportSubjectData({ email, requestedBy = null }) {
  if (!email || !email.trim()) throw new Error('a subject email is required');
  const data = gatherSubjectData(email);
  logAction({
    userId: requestedBy,
    action: 'data.exported',
    details: { subjectHash: subjectHash(email), leadFound: !!data.lead, userFound: !!data.user, events: data.engagementEvents.length },
  });
  return data;
}

// --- STORY-035: queued, batch-processed export requests --------------------

/** Queue an export request (status 'pending'). */
export function createExportRequest({ subject, requestedBy = null }) {
  if (!subject || !subject.trim()) throw new Error('a subject email is required');
  const info = run(
    "INSERT INTO data_requests (subject, type, status, requested_by) VALUES (?, 'export', 'pending', ?)",
    [subject, requestedBy]
  );
  logAction({ userId: requestedBy, action: 'data.export_requested', details: { requestId: info.lastInsertRowid, subjectHash: subjectHash(subject) } });
  return getExportRequest(info.lastInsertRowid);
}

export function listExportRequests() {
  return all('SELECT id, subject, type, status, requested_by, created_at, completed_at FROM data_requests ORDER BY id DESC');
}

/** One request with its computed result (parsed). */
export function getExportRequest(id) {
  const r = get('SELECT * FROM data_requests WHERE id = ?', [id]);
  if (!r) return null;
  return { ...r, result: r.result_json ? JSON.parse(r.result_json) : null };
}

/**
 * Process all pending export requests in one batch. Results are stored so a
 * later download does not recompute. Returns how many were processed.
 */
export function processPendingExports({ processedBy = null } = {}) {
  const pending = all("SELECT * FROM data_requests WHERE status = 'pending' ORDER BY id ASC");
  let processed = 0;
  for (const req of pending) {
    try {
      const data = gatherSubjectData(req.subject);
      run("UPDATE data_requests SET status = 'completed', result_json = ?, completed_at = datetime('now') WHERE id = ?",
        [JSON.stringify(data), req.id]);
      logAction({ userId: processedBy, action: 'data.export_processed', details: { requestId: req.id, subjectHash: subjectHash(req.subject), events: data.engagementEvents.length } });
      processed += 1;
    } catch {
      run("UPDATE data_requests SET status = 'failed', completed_at = datetime('now') WHERE id = ?", [req.id]);
    }
  }
  return { processed, total: pending.length };
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
