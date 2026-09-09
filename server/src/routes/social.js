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
  publishPostLive,
  publishDuePosts,
  editPost,
  connectOAuthAccount,
} from '../agents/socialMediaAgent.js';
import { submitPostForApproval } from '../agents/governanceAgent.js';
import { requirePermission } from '../http/rbac.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { providerList, getProvider } from '../integrations/oauthProviders.js';

const router = Router();

const CLIENT_URL = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');

// Encode/decode the acting user + provider through the OAuth `state` round-trip
// (the browser redirect to the callback carries no x-user-id header). DEV NOTE:
// in production, sign this state and store the nonce to defend against CSRF.
function encodeState(uid, provider) {
  return Buffer.from(JSON.stringify({ uid, provider, n: Math.random().toString(36).slice(2) })).toString('base64url');
}
function decodeState(state) {
  try { return JSON.parse(Buffer.from(String(state), 'base64url').toString('utf8')); }
  catch { return null; }
}

// Which real-OAuth platforms exist / are configured.  GET /api/social/oauth/providers
router.get('/oauth/providers', requireUser, (_req, res) => {
  res.json({ providers: providerList() });
});

// Start the OAuth flow for a provider — returns the URL to send the browser to.
// GET /api/social/oauth/:provider/connect   (called via fetch, carries x-user-id)
router.get('/oauth/:provider/connect', requireUser, requirePermission(PERMISSIONS.SOCIAL_CONNECT), (req, res) => {
  const provider = getProvider(req.params.provider);
  if (!provider) return res.status(400).json({ error: `platform '${req.params.provider}' is not supported yet` });
  if (!provider.module.isConfigured()) return res.status(400).json({ error: `${provider.label} is not configured on the server` });
  try {
    res.json({ url: provider.module.authorizeUrl(encodeState(req.user.id, provider.id)) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// OAuth redirect target — the provider sends the browser here with ?code&state.
// We recover the user + provider from state (no x-user-id on a top-level redirect).
// GET /api/social/oauth/:provider/callback
router.get('/oauth/:provider/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query || {};
  if (error) return res.redirect(`${CLIENT_URL}/social?linked=error&reason=${encodeURIComponent(error_description || error)}`);
  const parsed = decodeState(state);
  const provider = getProvider(parsed?.provider || req.params.provider);
  if (!code || !parsed?.uid || !provider) {
    return res.redirect(`${CLIENT_URL}/social?linked=error&reason=bad_state`);
  }
  try {
    const { accessToken, expiresIn } = await provider.module.exchangeCode(String(code));
    const { sub, name } = await provider.module.fetchUserinfo(accessToken);
    connectOAuthAccount({ userId: parsed.uid, platform: provider.id, handle: name, accessToken, externalId: sub, expiresIn });
    res.redirect(`${CLIENT_URL}/social?linked=${provider.id}`);
  } catch (err) {
    res.redirect(`${CLIENT_URL}/social?linked=error&reason=${encodeURIComponent(err.message)}`);
  }
});

// STORY-004 — connect an account.  POST /api/social/accounts { platform, handle }
router.post('/accounts', requireUser, requirePermission(PERMISSIONS.SOCIAL_CONNECT), (req, res) => {
  const { platform, handle, accessToken } = req.body || {};
  try {
    const account = connectAccount({ userId: req.user.id, platform, handle, accessToken });
    res.status(201).json({ account });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// List the acting user's connected accounts.  GET /api/social/accounts
router.get('/accounts', requireUser, requirePermission(PERMISSIONS.SOCIAL_VIEW), (req, res) => {
  res.json({ accounts: listAccounts(req.user.id) });
});

// Disconnect.  DELETE /api/social/accounts/:id
router.delete('/accounts/:id', requireUser, requirePermission(PERMISSIONS.SOCIAL_CONNECT), (req, res) => {
  try {
    const account = disconnectAccount({ userId: req.user.id, accountId: Number(req.params.id) });
    res.json({ account });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// STORY-006 — platform catalog (limits/rules).  GET /api/social/platforms
router.get('/platforms', requireUser, requirePermission(PERMISSIONS.SOCIAL_VIEW), (_req, res) => {
  res.json({ platforms: platformCatalog() });
});

// STORY-006 — preview per-platform adaptation.  POST /api/social/preview { text, platforms? }
router.post('/preview', requireUser, requirePermission(PERMISSIONS.SOCIAL_SCHEDULE), (req, res) => {
  const { text, platforms } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text is required' });
  res.json({ previews: previewForPlatforms(text, platforms) });
});

// STORY-005 — schedule posts.  POST /api/social/posts { contentId, accountIds, scheduledAt? }
router.post('/posts', requireUser, requirePermission(PERMISSIONS.SOCIAL_SCHEDULE), (req, res) => {
  const { contentId, accountIds, scheduledAt, imageId } = req.body || {};
  try {
    const posts = schedulePost({
      userId: req.user.id,
      contentId: Number(contentId),
      accountIds: (accountIds || []).map(Number),
      scheduledAt: scheduledAt || null,
      imageId: imageId != null ? Number(imageId) : null,
    });
    res.status(201).json({ posts });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// List posts (optionally by status).  GET /api/social/posts?status=approved
router.get('/posts', requireUser, requirePermission(PERMISSIONS.SOCIAL_VIEW), (req, res) => {
  res.json({ posts: listPosts({ status: req.query.status }) });
});

// STORY-008 — revise a draft/rejected post.  PATCH /api/social/posts/:id { postText }
router.patch('/posts/:id', requireUser, requirePermission(PERMISSIONS.SOCIAL_SCHEDULE), (req, res) => {
  try {
    const post = editPost({ postId: Number(req.params.id), editorId: req.user.id, postText: (req.body || {}).postText });
    res.json({ post });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// STORY-008 — (re)submit a post for approval.  POST /api/social/posts/:id/submit
router.post('/posts/:id/submit', requireUser, requirePermission(PERMISSIONS.SOCIAL_SCHEDULE), (req, res) => {
  try {
    const approval = submitPostForApproval({ postId: Number(req.params.id), requestedBy: req.user.id });
    res.status(201).json({ approval });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// STORY-007 — publish a single approved post.  POST /api/social/posts/:id/publish
router.post('/posts/:id/publish', requireUser, requirePermission(PERMISSIONS.SOCIAL_PUBLISH), async (req, res) => {
  try {
    // Live publisher: posts to a real LinkedIn feed if the account is OAuth-linked,
    // otherwise simulates (all other platforms / dev tokens).
    const post = await publishPostLive({ postId: Number(req.params.id), userId: req.user.id });
    res.json({ post });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// STORY-007 — publish all due approved posts across platforms.
// POST /api/social/publish-due
router.post('/publish-due', requireUser, requirePermission(PERMISSIONS.SOCIAL_PUBLISH), (req, res) => {
  res.json({ results: publishDuePosts({ userId: req.user.id }) });
});

export default router;
