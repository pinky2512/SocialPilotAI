// Analytics routes — REQ-005/006 (Analytics Agent).
//
// STORY-012: ingest email engagement events and read per-campaign metrics.

import { Router } from 'express';
import { requireUser } from '../http/currentUser.js';
import { requirePermission } from '../http/rbac.js';
import { PERMISSIONS } from '../auth/permissions.js';
import {
  recordEngagementEvent,
  ingestEngagementBatch,
  campaignMetrics,
  allCampaignMetrics,
  generatePredictiveInsights,
  allPredictiveInsights,
  historicalBaseline,
  updateDashboard,
  generateRecommendations,
  allRecommendations,
  getOverviewCached,
  getDashboardCached,
} from '../agents/analyticsAgent.js';

const router = Router();

// --- SendGrid Event Webhook (PUBLIC — defined before the auth middleware) -----
// Real-time email engagement: SendGrid POSTs an array of events here as
// recipients open/click. Guarded by a shared secret in the URL since the caller
// is SendGrid, not a logged-in user. Maps SendGrid event names onto our types
// and attributes each to a campaign via the custom_arg we sent (campaign_id).
// 'delivered' is skipped here — it's already recorded at send time.
const SENDGRID_EVENT_MAP = { open: 'open', click: 'click', bounce: 'bounce', dropped: 'bounce', unsubscribe: 'unsubscribe', group_unsubscribe: 'unsubscribe' };

router.post('/email/sendgrid-events', (req, res) => {
  const secret = process.env.SENDGRID_WEBHOOK_SECRET;
  if (!secret || req.query.secret !== secret) return res.status(403).json({ error: 'forbidden' });
  const events = Array.isArray(req.body) ? req.body : [];
  let recorded = 0;
  for (const ev of events) {
    const eventType = SENDGRID_EVENT_MAP[ev.event];
    const campaignId = ev.campaign_id != null ? Number(ev.campaign_id) : null;
    if (!eventType || !campaignId) continue;
    try {
      recordEngagementEvent({ campaignId, recipient: ev.email || null, eventType, details: { via: 'sendgrid', url: ev.url } });
      recorded++;
    } catch { /* ignore unknown/duplicate — webhook must always 200 */ }
  }
  res.json({ received: events.length, recorded });
});

// STORY-027 — RBAC for analytics features. Reads require analytics:view (both
// roles); writing engagement telemetry requires analytics:ingest (admin only).
router.use(requireUser, (req, res, next) => {
  const perm = req.method === 'GET' ? PERMISSIONS.ANALYTICS_VIEW : PERMISSIONS.ANALYTICS_INGEST;
  return requirePermission(perm)(req, res, next);
});

// Ingest a single engagement event (ESP webhook swap-in point).
// POST /api/analytics/email/events { campaignId, recipient?, eventType }
router.post('/email/events', requireUser, (req, res) => {
  try {
    if (Array.isArray(req.body?.events)) {
      const count = ingestEngagementBatch(req.body.events);
      return res.status(201).json({ recorded: count });
    }
    const event = recordEngagementEvent(req.body || {});
    res.status(201).json({ event });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Metrics for one campaign.  GET /api/analytics/email/:campaignId/metrics
router.get('/email/:campaignId/metrics', requireUser, (req, res) => {
  try {
    res.json({ metrics: campaignMetrics(Number(req.params.campaignId)) });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Metrics for all campaigns (dashboard).  GET /api/analytics/email/metrics
router.get('/email/metrics', requireUser, (_req, res) => {
  res.json({ metrics: allCampaignMetrics() });
});

// STORY-017 — predictive insights for one campaign.
// GET /api/analytics/predict/:campaignId
router.get('/predict/:campaignId', requireUser, (req, res) => {
  try {
    res.json({
      insights: generatePredictiveInsights({
        campaignId: Number(req.params.campaignId),
        actorId: req.user.id,
        audit: true, // STORY-023: explicit request is audited
      }),
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// STORY-017 — predictive insights for all campaigns + baseline.
// GET /api/analytics/predict
router.get('/predict', requireUser, (req, res) => {
  // STORY-023: an explicit bulk forecast request is audited (one summary entry).
  res.json({ baseline: historicalBaseline(), insights: allPredictiveInsights({ actorId: req.user.id, audit: true }) });
});

// STORY-020 — unified cross-channel overview.  GET /api/analytics/overview
// STORY-021 — served from a short-TTL cache (X-Cache header reports hit/miss).
router.get('/overview', requireUser, (_req, res) => {
  const { value, hit } = getOverviewCached();
  res.set('X-Cache', hit ? 'HIT' : 'MISS');
  res.json({ overview: value });
});

// STORY-018 — real-time metrics dashboard snapshot.  GET /api/analytics/dashboard
// STORY-021 — cached for low latency; invalidated on new engagement.
router.get('/dashboard', requireUser, (_req, res) => {
  const { value, hit } = getDashboardCached();
  res.set('X-Cache', hit ? 'HIT' : 'MISS');
  res.json({ dashboard: value });
});

// STORY-019 — optimization recommendations.
// GET /api/analytics/recommendations  (all)  |  /recommendations/:campaignId
router.get('/recommendations', requireUser, (req, res) => {
  // STORY-023: an explicit bulk recommendation request is audited (one summary entry).
  res.json({ recommendations: allRecommendations({ actorId: req.user.id, audit: true }) });
});
router.get('/recommendations/:campaignId', requireUser, (req, res) => {
  try {
    res.json({
      recommendations: generateRecommendations({
        campaignId: Number(req.params.campaignId),
        actorId: req.user.id,
        audit: true, // STORY-023: explicit request is audited
      }),
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

export default router;
