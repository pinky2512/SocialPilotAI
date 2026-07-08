// Approval routes — REQ-007 (Governance and Compliance Agent).
//
// STORY-002: Content Draft Approval Workflow. A draft is submitted into the
// approval gate; a human approver approves or rejects it. Content can only
// reach 'approved' via this path — the approval-gate contract.

import { Router } from 'express';
import { requireUser } from '../http/currentUser.js';
import { submitForApproval, decide, listPending } from '../agents/governanceAgent.js';
import { get, all } from '../db/index.js';

const router = Router();

// Submit a draft for approval.  POST /api/approvals/submit { contentId }
router.post('/submit', requireUser, (req, res) => {
  const { contentId } = req.body || {};
  if (!contentId) return res.status(400).json({ error: 'contentId is required' });
  try {
    const approval = submitForApproval({ contentId: Number(contentId), requestedBy: req.user.id });
    res.status(201).json({ approval });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// List pending approvals (the approval queue).  GET /api/approvals/pending
router.get('/pending', requireUser, (_req, res) => {
  res.json({ pending: listPending() });
});

// Approve a held item.  POST /api/approvals/:id/approve
router.post('/:id/approve', requireUser, (req, res) => {
  try {
    const result = decide({
      approvalId: Number(req.params.id),
      approverId: req.user.id,
      decision: 'approved',
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Reject a held item.  POST /api/approvals/:id/reject { reason? }
router.post('/:id/reject', requireUser, (req, res) => {
  try {
    const result = decide({
      approvalId: Number(req.params.id),
      approverId: req.user.id,
      decision: 'rejected',
      reason: (req.body && req.body.reason) || '',
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Full approval history for a content item (audit-friendly view).
router.get('/history/:contentId', requireUser, (req, res) => {
  const contentId = Number(req.params.contentId);
  const processes = all(
    'SELECT * FROM approval_processes WHERE content_id = ? ORDER BY id ASC',
    [contentId]
  );
  const content = get('SELECT * FROM content WHERE id = ?', [contentId]);
  res.json({ content, processes });
});

export default router;
