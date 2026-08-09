// Analytics Agent — owns REQ-005, REQ-006.
// Commands: generatePredictiveInsights, updateDashboard. Reacts to: newCampaignData.
//
// STORY-012 responsibility: track email engagement metrics. Ingests engagement
// events (opens/clicks/bounces/etc.) and computes per-campaign metrics. This is
// telemetry, not a gated action — analytics has no approval gate (agent map).

import { run, get, all } from '../db/index.js';
import { startTask, finishTask } from './taskTracker.js';
import { broker } from '../broker/index.js';
import { createTTLCache } from '../util/cache.js';
import { logAction } from '../trust/audit.js';

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
export function generatePredictiveInsights({ campaignId, actorId = null, audit = false }) {
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
      // STORY-028 — explainability: the factors and formula behind the prediction.
      explanation: {
        method: 'Predicted rate = observed × w + baseline × (1 − w), where w = min(1, delivered / 200).',
        weight: Math.round(w * 100) / 100,
        factors: [
          { label: 'Observed open rate', value: `${m.rates.openRate}%`, detail: `from ${delivered} delivered` },
          { label: 'Historical baseline', value: `${baseline.openRate}%`, detail: `avg across ${baseline.sampleCampaigns} campaign(s)` },
          { label: 'Sample weight (w)', value: `${Math.round(w * 100)}%`, detail: w >= 1 ? 'enough data — trust the observed rate' : 'small sample — blended toward baseline' },
          { label: 'Confidence', value: confidence, detail: `${delivered} delivered` },
        ],
        summary:
          `Open rate ${predictedOpenRate}% blends the observed ${m.rates.openRate}% ` +
          `(weight ${Math.round(w * 100)}%) with the ${baseline.openRate}% baseline; ` +
          `confidence is ${confidence} on ${delivered} delivered.`,
      },
    };
    // STORY-023 — audit only EXPLICIT predictive requests (not dashboard polls),
    // so the trail is meaningful without flooding the audit log.
    if (audit) {
      logAction({
        userId: actorId,
        action: 'analytics.predictive_generated',
        details: { campaignId, predicted: insights.predicted, confidence, basedOnDelivered: delivered },
      });
    }
    finishTask(taskId, 'done');
    return insights;
  } catch (err) {
    finishTask(taskId, 'failed');
    throw err;
  }
}

// --- STORY-021: latency optimization --------------------------------------
//
// The dashboard is polled every few seconds; recomputing aggregates each time is
// wasteful. Cache the snapshots for a short TTL and invalidate immediately when
// new engagement arrives, so responses stay fast AND real-time-correct.

const DASHBOARD_TTL_MS = 2000;
const _dashboardCache = createTTLCache(DASHBOARD_TTL_MS);
const _overviewCache = createTTLCache(DASHBOARD_TTL_MS);

/** Cached dashboard snapshot. Returns { value, hit }. */
export function getDashboardCached() {
  return _dashboardCache.get(() => updateDashboard());
}
/** Cached unified overview. Returns { value, hit }. */
export function getOverviewCached() {
  return _overviewCache.get(() => unifiedOverview());
}
/** Invalidate analytics caches (called on new data). */
export function invalidateAnalyticsCaches() {
  _dashboardCache.invalidate();
  _overviewCache.invalidate();
}

// Keep the cache honest: any fresh engagement invalidates it so the next poll
// recomputes. This preserves real-time correctness while absorbing poll bursts.
broker.subscribe('newCampaignData', () => invalidateAnalyticsCaches());

/** Predictive insights for every campaign — dashboard forecast column. */
export function allPredictiveInsights() {
  return all('SELECT id FROM email_campaigns ORDER BY id DESC').map((c) => generatePredictiveInsights({ campaignId: c.id }));
}

// --- STORY-018: real-time metrics dashboard -------------------------------
//
// updateDashboard command: build a single aggregate snapshot the dashboard
// polls. Reflects the latest engagement each call, so with the client polling
// it updates in real time.

// --- STORY-020: unified cross-channel overview ----------------------------
//
// A single snapshot spanning content, social, email, engagement, and leads —
// the unified campaign-metrics view. Reads tables directly for reporting (a
// read-only dashboard concern owned by the Analytics Agent, REQ-006).

function countsByStatus(table) {
  const rows = all(`SELECT status, COUNT(*) AS n FROM ${table} GROUP BY status`);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
function total(table) {
  return all(`SELECT COUNT(*) AS n FROM ${table}`)[0].n;
}

export function unifiedOverview() {
  const engagement = allCampaignMetrics().reduce(
    (acc, m) => {
      acc.delivered += m.counts.delivered;
      acc.opens += m.counts.uniqueOpens;
      acc.clicks += m.counts.uniqueClicks;
      return acc;
    },
    { delivered: 0, opens: 0, clicks: 0 }
  );
  const pct = (n) => (engagement.delivered > 0 ? Math.round((n / engagement.delivered) * 1000) / 10 : 0);

  const leadSegments = all('SELECT segment, COUNT(*) AS n FROM leads GROUP BY segment');

  return {
    generatedAt: new Date().toISOString(),
    content: { total: total('content'), byStatus: countsByStatus('content') },
    social: { total: total('social_posts'), byStatus: countsByStatus('social_posts') },
    email: { total: total('email_campaigns'), byStatus: countsByStatus('email_campaigns') },
    engagement: {
      ...engagement,
      openRate: pct(engagement.opens),
      clickRate: pct(engagement.clicks),
    },
    leads: {
      total: total('leads'),
      bySegment: Object.fromEntries(leadSegments.map((r) => [r.segment || 'unsegmented', r.n])),
    },
    approvals: {
      pending: all("SELECT COUNT(*) AS n FROM approval_processes WHERE status = 'pending'")[0].n,
    },
  };
}

// --- STORY-019: optimization recommendations ------------------------------
//
// Rules-based recommendations derived from a campaign's metrics vs the
// historical baseline. SWAP-IN POINT: replace generateRecommendations() with an
// ML/LLM recommender; the { type, message, rationale, priority, metric } shape
// is the contract callers depend on.

export function generateRecommendations({ campaignId, actorId = null, audit = false }) {
  const m = campaignMetrics(campaignId);
  const baseline = historicalBaseline();
  const recs = [];
  const add = (type, priority, metric, message, rationale) =>
    recs.push({ type, priority, metric, message, rationale });

  // STORY-023 — audit only EXPLICIT recommendation requests (not dashboard polls).
  const done = () => {
    if (audit) {
      logAction({
        userId: actorId,
        action: 'analytics.recommendations_generated',
        details: { campaignId, count: recs.length, types: recs.map((r) => r.type) },
      });
    }
    return { campaignId, name: m.name, recommendations: recs };
  };

  const delivered = m.counts.delivered;
  if (delivered < 50) {
    add('gather-data', 'low', 'delivered',
      'Gather more engagement data before optimizing.',
      `Only ${delivered} delivered — too small a sample for confident recommendations.`);
    return done();
  }

  if (m.rates.openRate < baseline.openRate * 0.9) {
    add('improve-subject', 'high', 'openRate',
      'Test stronger subject lines and preview text.',
      `Open rate ${m.rates.openRate}% is below the ${baseline.openRate}% baseline.`);
  } else if (m.rates.openRate > baseline.openRate * 1.2) {
    add('replicate', 'medium', 'openRate',
      'Replicate this subject/tone in future campaigns.',
      `Open rate ${m.rates.openRate}% is well above the ${baseline.openRate}% baseline.`);
  }

  if (m.rates.clickRate < Math.max(baseline.clickRate * 0.9, 1)) {
    add('strengthen-cta', 'high', 'clickRate',
      'Strengthen the call-to-action and link placement.',
      `Click rate ${m.rates.clickRate}% is below the ${baseline.clickRate}% baseline.`);
  }

  if (m.rates.bounceRate > 2) {
    add('clean-list', 'high', 'bounceRate',
      'Clean your recipient list to reduce bounces.',
      `Bounce rate ${m.rates.bounceRate}% exceeds the 2% healthy threshold.`);
  }

  if (m.rates.unsubscribeRate > 1) {
    add('reduce-frequency', 'medium', 'unsubscribeRate',
      'Reduce send frequency or tighten targeting.',
      `Unsubscribe rate ${m.rates.unsubscribeRate}% is high (>1%).`);
  }

  if (recs.length === 0) {
    add('on-track', 'low', 'overall',
      'Performance is on track — maintain current strategy.',
      'All rates are at or above baseline with healthy bounce/unsubscribe.');
  }
  return done();
}

export function allRecommendations() {
  return all('SELECT id FROM email_campaigns ORDER BY id DESC').map((c) => generateRecommendations({ campaignId: c.id }));
}

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
