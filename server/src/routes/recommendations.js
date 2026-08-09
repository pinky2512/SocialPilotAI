// Recommendation approval routes — REQ-007 (Governance and Compliance Agent).
//
// STORY-024: propose a predictive recommendation for adoption (held at the
// approval gate) and list proposed/decided recommendations. Approve/reject is
// done through the shared /api/approvals/:id endpoints.

import { Router } from 'express';
import { requireUser } from '../http/currentUser.js';
import { proposeRecommendation, listRecommendations } from '../agents/governanceAgent.js';

const router = Router();

// Propose a recommendation for approval.
// POST /api/recommendations/propose { campaignId?, type, message, rationale?, priority? }
router.post('/propose', requireUser, (req, res) => {
  const { campaignId, type, message, rationale, priority } = req.body || {};
  try {
    const result = proposeRecommendation({
      campaignId: campaignId ?? null,
      type,
      message,
      rationale,
      priority,
      requestedBy: req.user.id,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// List proposed/decided recommendations.  GET /api/recommendations?status=approved
router.get('/', requireUser, (req, res) => {
  res.json({ recommendations: listRecommendations({ status: req.query.status }) });
});

export default router;
