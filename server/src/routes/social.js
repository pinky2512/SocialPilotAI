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

export default router;
