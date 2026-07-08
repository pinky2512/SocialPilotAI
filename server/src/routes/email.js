// Email campaign routes — REQ-003 (Email Campaign Agent).
//
// STORY-011: create, schedule (held for approval), and send email campaigns.
// A campaign can only be sent after passing the human approval gate.

import { Router } from 'express';
import { requireUser } from '../http/currentUser.js';
import { requirePermission } from '../http/rbac.js';
import { PERMISSIONS } from '../auth/permissions.js';
import {
  createEmailCampaign,
  scheduleEmail,
  sendEmail,
  listCampaigns,
} from '../agents/emailCampaignAgent.js';

const router = Router();

// Create a campaign draft.  POST /api/email/campaigns { name, subject, body, audience? }
router.post('/campaigns', requireUser, requirePermission(PERMISSIONS.EMAIL_CREATE), (req, res) => {
  const { name, subject, body, audience } = req.body || {};
  try {
    const campaign = createEmailCampaign({ userId: req.user.id, name, subject, body, audience });
    res.status(201).json({ campaign });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// List campaigns.  GET /api/email/campaigns?status=approved
router.get('/campaigns', requireUser, requirePermission(PERMISSIONS.EMAIL_VIEW), (req, res) => {
  res.json({ campaigns: listCampaigns({ status: req.query.status }) });
});

// Schedule + hold for approval.  POST /api/email/campaigns/:id/schedule { scheduledAt? }
router.post('/campaigns/:id/schedule', requireUser, requirePermission(PERMISSIONS.EMAIL_CREATE), (req, res) => {
  try {
    const result = scheduleEmail({
      userId: req.user.id,
      campaignId: Number(req.params.id),
      scheduledAt: (req.body || {}).scheduledAt || null,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Send an approved campaign.  POST /api/email/campaigns/:id/send
router.post('/campaigns/:id/send', requireUser, requirePermission(PERMISSIONS.EMAIL_SEND), (req, res) => {
  try {
    const campaign = sendEmail({ userId: req.user.id, campaignId: Number(req.params.id) });
    res.json({ campaign });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
