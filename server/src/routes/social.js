// Social media routes — REQ-002 (Social Media Posting Agent).
//
// STORY-004: connect / list / disconnect social accounts.
// STORY-005/006/007 add scheduling and publishing below.

import { Router } from 'express';
import { requireUser } from '../http/currentUser.js';
import {
  connectAccount,
  disconnectAccount,
  listAccounts,
  schedulePost,
  listPosts,
  previewForPlatforms,
  platformCatalog,
} from '../agents/socialMediaAgent.js';

const router = Router();

// STORY-004 — connect an account.  POST /api/social/accounts { platform, handle }
router.post('/accounts', requireUser, (req, res) => {
  const { platform, handle, accessToken } = req.body || {};
  try {
    const account = connectAccount({ userId: req.user.id, platform, handle, accessToken });
    res.status(201).json({ account });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// List the acting user's connected accounts.  GET /api/social/accounts
router.get('/accounts', requireUser, (req, res) => {
  res.json({ accounts: listAccounts(req.user.id) });
});

// Disconnect.  DELETE /api/social/accounts/:id
router.delete('/accounts/:id', requireUser, (req, res) => {
  try {
    const account = disconnectAccount({ userId: req.user.id, accountId: Number(req.params.id) });
    res.json({ account });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// STORY-006 — platform catalog (limits/rules).  GET /api/social/platforms
router.get('/platforms', requireUser, (_req, res) => {
  res.json({ platforms: platformCatalog() });
});

// STORY-006 — preview per-platform adaptation.  POST /api/social/preview { text, platforms? }
router.post('/preview', requireUser, (req, res) => {
  const { text, platforms } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text is required' });
  res.json({ previews: previewForPlatforms(text, platforms) });
});

// STORY-005 — schedule posts.  POST /api/social/posts { contentId, accountIds, scheduledAt? }
router.post('/posts', requireUser, (req, res) => {
  const { contentId, accountIds, scheduledAt } = req.body || {};
  try {
    const posts = schedulePost({
      userId: req.user.id,
      contentId: Number(contentId),
      accountIds: (accountIds || []).map(Number),
      scheduledAt: scheduledAt || null,
    });
    res.status(201).json({ posts });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// List posts (optionally by status).  GET /api/social/posts?status=approved
router.get('/posts', requireUser, (req, res) => {
  res.json({ posts: listPosts({ status: req.query.status }) });
});

export default router;
