// Audit routes — REQ-007 (Governance and Compliance Agent).
//
// STORY-009: read-only, queryable audit trail (append-only; never mutated). The
// audit log already records every social media action (connect, schedule, edit,
// approve/reject, publish); these endpoints expose it for review.

import { Router } from 'express';
import { requireUser } from '../http/currentUser.js';
import { queryAudit, auditActionTypes, actionsForPost, actionsForContent } from '../trust/audit.js';

const router = Router();

// GET /api/audit?action=...&prefix=social.&userId=...&limit=...
router.get('/', requireUser, (req, res) => {
  const { action, prefix, userId, limit } = req.query;
  res.json({
    entries: queryAudit({
      action,
      actionPrefix: prefix,
      userId: userId != null ? Number(userId) : undefined,
      limit: limit ? Number(limit) : 100,
    }),
  });
});

// GET /api/audit/actions — distinct action keys (for filter menus).
router.get('/actions', requireUser, (_req, res) => {
  res.json({ actions: auditActionTypes() });
});

// GET /api/audit/social — convenience: all social media actions.
router.get('/social', requireUser, (req, res) => {
  res.json({ entries: queryAudit({ actionPrefix: 'social.', limit: req.query.limit ? Number(req.query.limit) : 200 }) });
});

// GET /api/audit/post/:id — full trail for one post.
router.get('/post/:id', requireUser, (req, res) => {
  res.json({ entries: actionsForPost(Number(req.params.id)) });
});

// GET /api/audit/content/:id — full trail for one content item.
router.get('/content/:id', requireUser, (req, res) => {
  res.json({ entries: actionsForContent(Number(req.params.id)) });
});

export default router;
