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

// --- STORY-017: predictive analytics --------------------------------------
//
// SWAP-IN POINT: replace historicalBaseline()/generatePredictiveInsights() with
// a trained model. Contract: input = campaign engagement so far + history;
// output = predicted final open/click rates + a confidence level. Callers are
// unaffected by the swap.

const DEFAULT_BASELINE = { openRate: 20, clickRate: 3 }; // industry-ish priors when no history

/** Average open/click rate across campaigns that have delivery data. */
export function historicalBaseline() {
  const metrics = allCampaignMetrics().filter((m) => m.counts.delivered > 0);
  if (metrics.length === 0) return { ...DEFAULT_BASELINE, sampleCampaigns: 0 };
  const avg = (sel) => Math.round((metrics.reduce((s, m) => s + sel(m), 0) / metrics.length) * 10) / 10;
  return {
    openRate: avg((m) => m.rates.openRate),
    clickRate: avg((m) => m.rates.clickRate),
    sampleCampaigns: metrics.length,
  };
}

/**
 * STORY-017 — predict a campaign's final performance by blending its observed
 * engagement so far with the historical baseline, weighted by delivered sample
 * size (more data → trust the observation more). Confidence scales with sample.
 */
export function generatePredictiveInsights({ campaignId }) {
  const taskId = startTask({ agentId: AGENT_ID, taskType: 'generatePredictiveInsights' });
  try {
    const m = campaignMetrics(campaignId);
    const baseline = historicalBaseline();
    const delivered = m.counts.delivered;

    const w = delivered > 0 ? Math.min(1, delivered / 200) : 0; // full weight at 200 delivered
    const blend = (obs, base) => Math.round((w * obs + (1 - w) * base) * 10) / 10;
    const predictedOpenRate = blend(m.rates.openRate, baseline.openRate);
    const predictedClickRate = blend(m.rates.clickRate, baseline.clickRate);

    const confidence = delivered === 0 ? 'low' : delivered < 50 ? 'low' : delivered < 200 ? 'medium' : 'high';
    const trend =
      m.rates.openRate === 0 && delivered === 0 ? 'no-data'
        : m.rates.openRate >= baseline.openRate ? 'above-average' : 'below-average';

    const insights = {
      campaignId,
      name: m.name,
      basedOnDelivered: delivered,
      baseline,
      predicted: { openRate: predictedOpenRate, clickRate: predictedClickRate },
      projected: {
        opens: Math.round((predictedOpenRate / 100) * delivered),
        clicks: Math.round((predictedClickRate / 100) * delivered),
      },
      confidence,
      trend,
    };
    finishTask(taskId, 'done');
    return insights;
  } catch (err) {
    finishTask(taskId, 'failed');
    throw err;
  }
}

/** Predictive insights for every campaign — dashboard forecast column. */
export function allPredictiveInsights() {
  return all('SELECT id FROM email_campaigns ORDER BY id DESC').map((c) => generatePredictiveInsights({ campaignId: c.id }));
}

// --- STORY-018: real-time metrics dashboard -------------------------------
//
// updateDashboard command: build a single aggregate snapshot the dashboard
// polls. Reflects the latest engagement each call, so with the client polling
// it updates in real time.

export function updateDashboard() {
  const metrics = allCampaignMetrics();
  const sum = (sel) => metrics.reduce((s, m) => s + sel(m), 0);
  const delivered = sum((m) => m.counts.delivered);
  const opens = sum((m) => m.counts.uniqueOpens);
  const clicks = sum((m) => m.counts.uniqueClicks);
  const bounces = sum((m) => m.counts.bounces);
  const pct = (n) => (delivered > 0 ? Math.round((n / delivered) * 1000) / 10 : 0);

  const sentCount = all("SELECT COUNT(*) AS n FROM email_campaigns WHERE status = 'sent'")[0].n;
  const pendingApprovalCount = all("SELECT COUNT(*) AS n FROM email_campaigns WHERE status = 'pending_approval'")[0].n;
  const leadCount = all('SELECT COUNT(*) AS n FROM leads')[0].n;

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      campaigns: metrics.length,
      sent: sentCount,
      pendingApproval: pendingApprovalCount,
      leads: leadCount,
      delivered,
      opens,
      clicks,
      bounces,
    },
    overallRates: { openRate: pct(opens), clickRate: pct(clicks), bounceRate: pct(bounces) },
    baseline: historicalBaseline(),
    campaigns: metrics.map((m) => ({
      campaignId: m.campaignId,
      name: m.name,
      status: m.status,
      delivered: m.counts.delivered,
      openRate: m.rates.openRate,
      clickRate: m.rates.clickRate,
      predicted: generatePredictiveInsights({ campaignId: m.campaignId }).predicted,
    })),
  };
}
