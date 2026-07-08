// Lead Scoring Agent — owns REQ-004.
// Commands: scoreLead, segmentAudience. Reacts to: newLeadData.
//
// STORY-014: assign a 0–100 lead score derived from a lead's email engagement.
// No approval gate (agent map) — but scoring is a meaningful action, so it is
// audited. Real-time re-scoring on new engagement lands in STORY-016.

import { run, get, all } from '../db/index.js';
import { logAction } from '../trust/audit.js';
import { startTask, finishTask } from './taskTracker.js';

const AGENT_ID = 'lead-scoring-agent';

// Scoring model (points per engagement event). Kept explicit and centralized so
// it can be swapped for a trained model later without touching callers.
// SWAP-IN POINT: replace scoreFromEvents() with an ML model returning 0–100.
export const SCORE_WEIGHTS = Object.freeze({
  delivered: 1,
  open: 5,
  click: 15,
  bounce: -10,
  unsubscribe: -40,
});

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** Compute a 0–100 score from a lead's engagement event counts. */
export function scoreFromEvents(email) {
  const rows = all(
    'SELECT event_type, COUNT(*) AS n FROM email_engagement_events WHERE recipient = ? GROUP BY event_type',
    [email]
  );
  let raw = 0;
  for (const r of rows) raw += (SCORE_WEIGHTS[r.event_type] ?? 0) * r.n;
  return clamp(raw);
}

/**
 * STORY-014 — score (and upsert) a lead by email based on their engagement.
 * @returns {object} the leads row.
 */
export function scoreLead({ email, name = null }) {
  if (!email || !email.trim()) throw new Error('lead email is required');
  const taskId = startTask({ agentId: AGENT_ID, taskType: 'scoreLead' });
  try {
    let lead = get('SELECT * FROM leads WHERE email = ?', [email]);
    const before = lead?.score ?? null;
    const score = scoreFromEvents(email);

    if (!lead) {
      run('INSERT INTO leads (email, name, score) VALUES (?, ?, ?)', [email, name, score]);
    } else {
      run("UPDATE leads SET score = ?, name = COALESCE(?, name), updated_at = datetime('now') WHERE email = ?",
        [score, name, email]);
    }
    lead = get('SELECT * FROM leads WHERE email = ?', [email]);

    logAction({
      userId: null,
      action: 'lead.scored',
      details: { agent: AGENT_ID, leadId: lead.id, email, before, after: score },
    });
    finishTask(taskId, 'done');
    return lead;
  } catch (err) {
    finishTask(taskId, 'failed');
    throw err;
  }
}

/**
 * STORY-014 — (re)score every lead that has engagement data. Ensures a lead row
 * exists for each distinct recipient and updates all scores.
 * @returns {object[]} the scored leads.
 */
export function scoreAllLeads() {
  const recipients = all(
    'SELECT DISTINCT recipient AS email FROM email_engagement_events WHERE recipient IS NOT NULL'
  );
  return recipients.map((r) => scoreLead({ email: r.email }));
}

export function listLeads({ orderByScore = true } = {}) {
  return all(`SELECT * FROM leads ORDER BY ${orderByScore ? 'score DESC, id ASC' : 'id ASC'}`);
}

export function getLead(email) {
  return get('SELECT * FROM leads WHERE email = ?', [email]);
}
