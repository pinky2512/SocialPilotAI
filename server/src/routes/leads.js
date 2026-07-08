// Lead routes — REQ-004 (Lead Scoring Agent).
//
// STORY-014: score leads from engagement; list scored leads.
// STORY-015 adds segmentation below (mounted from segments route).

import { Router } from 'express';
import { requireUser } from '../http/currentUser.js';
import { scoreLead, scoreAllLeads, listLeads, getLead } from '../agents/leadScoringAgent.js';

const router = Router();

// Score a single lead by email.  POST /api/leads/score { email, name? }
router.post('/score', requireUser, (req, res) => {
  try {
    const lead = scoreLead({ email: (req.body || {}).email, name: (req.body || {}).name });
    res.status(201).json({ lead });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Re-score all leads with engagement data.  POST /api/leads/score-all
router.post('/score-all', requireUser, (_req, res) => {
  res.json({ leads: scoreAllLeads() });
});

// List leads (highest score first).  GET /api/leads
router.get('/', requireUser, (_req, res) => {
  res.json({ leads: listLeads() });
});

// One lead by email.  GET /api/leads/:email
router.get('/:email', requireUser, (req, res) => {
  const lead = getLead(req.params.email);
  if (!lead) return res.status(404).json({ error: 'lead not found' });
  res.json({ lead });
});

export default router;
