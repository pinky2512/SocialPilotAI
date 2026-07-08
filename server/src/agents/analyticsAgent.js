// Analytics Agent — owns REQ-005, REQ-006.
// Commands: generatePredictiveInsights, updateDashboard. Reacts to: newCampaignData.
//
// STORY-012 responsibility: track email engagement metrics. Ingests engagement
// events (opens/clicks/bounces/etc.) and computes per-campaign metrics. This is
// telemetry, not a gated action — analytics has no approval gate (agent map).

import { run, get, all } from '../db/index.js';
import { startTask, finishTask } from './taskTracker.js';
import { broker } from '../broker/index.js';

const AGENT_ID = 'analytics-agent';

export const ENGAGEMENT_EVENTS = ['delivered', 'open', 'click', 'bounce', 'unsubscribe'];

/**
 * STORY-012 — record an email engagement event.
 *
 * DEV NOTE: in production these arrive from the ESP via webhook; this function
 * is the swap-in point. Only events for existing campaigns are accepted.
 *
 * @returns {object} the inserted event row.
 */
export function recordEngagementEvent({ campaignId, recipient = null, eventType, details = {} }) {
  if (!ENGAGEMENT_EVENTS.includes(eventType)) {
    throw new Error(`unknown engagement event '${eventType}'`);
  }
  const campaign = get('SELECT * FROM email_campaigns WHERE id = ?', [campaignId]);
  if (!campaign) throw new Error(`campaign ${campaignId} not found`);

  const info = run(
    'INSERT INTO email_engagement_events (campaign_id, recipient, event_type, details) VALUES (?, ?, ?, ?)',
    [campaignId, recipient, eventType, JSON.stringify(details ?? {})]
  );
  // Let downstream agents (e.g. Lead Scoring) react to fresh engagement data.
  broker.publish('newCampaignData', { campaignId, eventType, recipient });
  return get('SELECT * FROM email_engagement_events WHERE id = ?', [info.lastInsertRowid]);
}

/** Bulk ingest (e.g. a batch of ESP webhook events). Returns count recorded. */
export function ingestEngagementBatch(events = []) {
  const taskId = startTask({ agentId: AGENT_ID, taskType: 'ingestEngagement' });
  try {
    let count = 0;
    for (const e of events) {
      recordEngagementEvent(e);
      count += 1;
    }
    finishTask(taskId, 'done');
    return count;
  } catch (err) {
    finishTask(taskId, 'failed');
    throw err;
  }
}

/**
 * STORY-012 — engagement metrics for a campaign. Counts total events and unique
 * recipients per type, and derives open/click/bounce rates off delivered count.
 */
export function campaignMetrics(campaignId) {
  const campaign = get('SELECT * FROM email_campaigns WHERE id = ?', [campaignId]);
  if (!campaign) throw new Error(`campaign ${campaignId} not found`);

  const rows = all(
    `SELECT event_type,
            COUNT(*) AS total,
            COUNT(DISTINCT recipient) AS unique_recipients
     FROM email_engagement_events WHERE campaign_id = ? GROUP BY event_type`,
    [campaignId]
  );
  const by = Object.fromEntries(rows.map((r) => [r.event_type, r]));
  const totalOf = (t) => by[t]?.total ?? 0;
  const uniqOf = (t) => by[t]?.unique_recipients ?? 0;

  const delivered = totalOf('delivered');
  const denom = delivered || 0;
  const rate = (n) => (denom > 0 ? Math.round((n / denom) * 1000) / 10 : 0); // 1-decimal %

  return {
    campaignId,
    name: campaign.name,
    status: campaign.status,
    counts: {
      delivered,
      opens: totalOf('open'),
      uniqueOpens: uniqOf('open'),
      clicks: totalOf('click'),
      uniqueClicks: uniqOf('click'),
      bounces: totalOf('bounce'),
      unsubscribes: totalOf('unsubscribe'),
    },
    rates: {
      openRate: rate(uniqOf('open')),
      clickRate: rate(uniqOf('click')),
      bounceRate: rate(totalOf('bounce')),
      unsubscribeRate: rate(totalOf('unsubscribe')),
    },
  };
}

/** Metrics across all sent campaigns — feeds the dashboard (STORY-013). */
export function allCampaignMetrics() {
  const campaigns = all("SELECT id FROM email_campaigns ORDER BY id DESC");
  return campaigns.map((c) => campaignMetrics(c.id));
}
