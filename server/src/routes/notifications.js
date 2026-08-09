// Notification routes — REQ-007 (Governance and Compliance Agent).
//
// STORY-030: per-user notification inbox (e.g. pending content approvals).

import { Router } from 'express';
import { requireUser } from '../http/currentUser.js';
import { listForUser, unreadCount, markRead, markAllRead } from '../trust/notifications.js';

const router = Router();

// GET /api/notifications?unread=1
router.get('/', requireUser, (req, res) => {
  const unreadOnly = req.query.unread === '1';
  res.json({
    notifications: listForUser(req.user.id, { unreadOnly }),
    unread: unreadCount(req.user.id),
  });
});

// POST /api/notifications/:id/read
router.post('/:id/read', requireUser, (req, res) => {
  res.json({ notification: markRead(req.user.id, Number(req.params.id)) });
});

// POST /api/notifications/read-all
router.post('/read-all', requireUser, (req, res) => {
  res.json(markAllRead(req.user.id));
});

export default router;
