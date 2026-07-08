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

export default router;
