// Trust routes — Trust and Governance Coordinator.
//
// STORY-025: the Trust Dashboard — one snapshot of system health, pending
// approvals, recent actions, and anomalies.

import { Router } from 'express';
import { requireUser } from '../http/currentUser.js';
import { monitorSystemHealth } from '../agents/trustCoordinator.js';

const router = Router();

// GET /api/trust/dashboard
router.get('/dashboard', requireUser, (_req, res) => {
  res.json({ trust: monitorSystemHealth() });
});

export default router;
