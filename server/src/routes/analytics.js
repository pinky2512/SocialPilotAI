// Analytics routes — REQ-005/006 (Analytics Agent).
//
// STORY-012: ingest email engagement events and read per-campaign metrics.

import { Router } from 'express';
import { requireUser } from '../http/currentUser.js';
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
  unifiedOverview,
} from '../agents/analyticsAgent.js';

const router = Router();

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
    res.json({ insights: generatePredictiveInsights({ campaignId: Number(req.params.campaignId) }) });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// STORY-017 — predictive insights for all campaigns + baseline.
// GET /api/analytics/predict
router.get('/predict', requireUser, (_req, res) => {
  res.json({ baseline: historicalBaseline(), insights: allPredictiveInsights() });
});

// STORY-020 — unified cross-channel overview.  GET /api/analytics/overview
router.get('/overview', requireUser, (_req, res) => {
  res.json({ overview: unifiedOverview() });
});

// STORY-018 — real-time metrics dashboard snapshot.  GET /api/analytics/dashboard
router.get('/dashboard', requireUser, (_req, res) => {
  res.json({ dashboard: updateDashboard() });
});

// STORY-019 — optimization recommendations.
// GET /api/analytics/recommendations  (all)  |  /recommendations/:campaignId
router.get('/recommendations', requireUser, (_req, res) => {
  res.json({ recommendations: allRecommendations() });
});
router.get('/recommendations/:campaignId', requireUser, (req, res) => {
  try {
    res.json({ recommendations: generateRecommendations({ campaignId: Number(req.params.campaignId) }) });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

export default router;
