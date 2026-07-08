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

// STORY-015 — audience segments by score band. Ordered high→low; the first
// band whose `min` a score meets wins. Centralized so thresholds are tunable.
export const SEGMENTS = [
  { name: 'hot', min: 70, label: 'Hot (highly engaged)' },
  { name: 'warm', min: 40, label: 'Warm (engaged)' },
  { name: 'cold', min: 1, label: 'Cold (low engagement)' },
  { name: 'dormant', min: 0, label: 'Dormant (no/negative engagement)' },
];

/** Map a score to its segment name. */
export function segmentForScore(score) {
  return (SEGMENTS.find((s) => score >= s.min) || SEGMENTS[SEGMENTS.length - 1]).name;
}

/**
 * STORY-015 — segment the whole audience by current lead scores. Updates each
 * lead's `segment` and returns per-segment counts. Audited as a summary.
 * @returns {{ segments: Record<string, number>, total: number }}
 */
export function segmentAudience() {
  const taskId = startTask({ agentId: AGENT_ID, taskType: 'segmentAudience' });
  try {
    const leads = all('SELECT * FROM leads');
    const counts = Object.fromEntries(SEGMENTS.map((s) => [s.name, 0]));
    for (const lead of leads) {
      const segment = segmentForScore(lead.score);
      run("UPDATE leads SET segment = ?, updated_at = datetime('now') WHERE id = ?", [segment, lead.id]);
      counts[segment] += 1;
    }
    logAction({
      userId: null,
      action: 'audience.segmented',
      details: { agent: AGENT_ID, total: leads.length, segments: counts },
    });
    finishTask(taskId, 'done');
    return { segments: counts, total: leads.length };
  } catch (err) {
    finishTask(taskId, 'failed');
    throw err;
  }
}

/** Leads in a given segment (for targeting). */
export function leadsInSegment(segment) {
  return all('SELECT * FROM leads WHERE segment = ? ORDER BY score DESC', [segment]);
}

export function listLeads({ orderByScore = true } = {}) {
  return all(`SELECT * FROM leads ORDER BY ${orderByScore ? 'score DESC, id ASC' : 'id ASC'}`);
}

export function getLead(email) {
  return get('SELECT * FROM leads WHERE email = ?', [email]);
}
