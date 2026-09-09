// LinkedIn OAuth 2.0 + posting integration (real account linking).
//
// This is the concrete implementation of the swap-in point noted in
// socialMediaAgent.connectAccount/publishPost. It uses LinkedIn's self-serve
// products:
//   - "Sign In with LinkedIn using OpenID Connect"  → scopes openid profile email
//   - "Share on LinkedIn"                           → scope  w_member_social
// Auth is a 3-legged authorization-code flow; posting uses the versioned Posts
// API (/rest/posts). Posting to your OWN profile needs no partner review.
//
// Config (env): LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_REDIRECT_URI,
// and optionally LINKEDIN_API_VERSION (YYYYMM, default below).

const AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
const POSTS_URL = 'https://api.linkedin.com/rest/posts';
const IMAGES_URL = 'https://api.linkedin.com/rest/images';
const SCOPES = ['openid', 'profile', 'email', 'w_member_social'];
// LinkedIn requires an explicit version header on /rest/ calls (no default), and
// only keeps ~12 monthly versions active — a sunset version returns 426
// NONEXISTENT_VERSION. Keep this current (override via LINKEDIN_API_VERSION).
const API_VERSION = process.env.LINKEDIN_API_VERSION || '202606';

/** True when the app is configured to link real LinkedIn accounts. */
// The Posts API `commentary` uses LinkedIn's "little text" format: these reserved
// characters must be backslash-escaped or the call fails with 422. Emojis and
// normal punctuation pass through untouched.
function escapeCommentary(text) {
  return String(text).replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
}

export function isConfigured() {
  return Boolean(
    process.env.LINKEDIN_CLIENT_ID &&
    process.env.LINKEDIN_CLIENT_SECRET &&
    process.env.LINKEDIN_REDIRECT_URI
  );
}

function requireConfig() {
  if (!isConfigured()) {
    throw new Error(
      'LinkedIn is not configured — set LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET and LINKEDIN_REDIRECT_URI'
    );
  }
}

/** Step 1 — the URL to send the user to so they authorize the app. */
export function authorizeUrl(state) {
  requireConfig();
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.LINKEDIN_CLIENT_ID,
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI,
    scope: SCOPES.join(' '),
    state,
  });
  return `${AUTH_URL}?${q.toString()}`;
}

/** Step 2 — exchange the authorization code for an access token. */
export async function exchangeCode(code) {
  requireConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI,
    client_id: process.env.LINKEDIN_CLIENT_ID,
    client_secret: process.env.LINKEDIN_CLIENT_SECRET,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`LinkedIn token exchange failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

/** Step 3 — identify the member (OpenID Connect userinfo → sub = person id). */
export async function fetchUserinfo(accessToken) {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`LinkedIn userinfo failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  // sub is the member id; the author URN for posting is urn:li:person:{sub}.
  return { sub: data.sub, name: data.name, email: data.email };
}

const jsonHeaders = (accessToken) => ({
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
  'LinkedIn-Version': API_VERSION,
  'X-Restli-Protocol-Version': '2.0.0',
});

/**
 * Upload an image and return its URN, ready to attach to a post. Three steps:
 * initialize → PUT the bytes to the returned upload URL → return the image URN.
 * (LinkedIn Images API accepts PNG/JPEG/GIF; SVG is not supported.)
 * @returns {Promise<string>} urn:li:image:...
 */
async function uploadImage({ accessToken, authorSub, bytes, mime }) {
  const init = await fetch(`${IMAGES_URL}?action=initializeUpload`, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ initializeUploadRequest: { owner: `urn:li:person:${authorSub}` } }),
  });
  if (!init.ok) {
    const t = await init.text().catch(() => '');
    throw new Error(`LinkedIn image init failed (${init.status}): ${t.slice(0, 200)}`);
  }
  const { value } = await init.json();
  const put = await fetch(value.uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': mime || 'application/octet-stream' },
    body: bytes,
  });
  if (!put.ok) {
    const t = await put.text().catch(() => '');
    throw new Error(`LinkedIn image upload failed (${put.status}): ${t.slice(0, 200)}`);
  }
  return value.image; // urn:li:image:...
}

/**
 * Publish a post to the member's own feed, optionally with one image.
 * @param {object} p
 * @param {string} p.accessToken  the member's OAuth token
 * @param {string} p.authorSub    the member id (userinfo.sub)
 * @param {string} p.text         post commentary
 * @param {object} [p.image]      { bytes, mime, altText } — optional attachment
 * @returns {Promise<{externalId: string}>} the created post URN
 */
export async function publishTextPost({ accessToken, authorSub, text, image = null }) {
  if (!authorSub) throw new Error('missing LinkedIn author id — reconnect the account');

  const body = {
    author: `urn:li:person:${authorSub}`,
    commentary: escapeCommentary(text),
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };

  // Attach an image if provided (upload first, then reference its URN).
  if (image && image.bytes) {
    const imageUrn = await uploadImage({ accessToken, authorSub, bytes: image.bytes, mime: image.mime });
    body.content = { media: { id: imageUrn, altText: (image.altText || '').slice(0, 300) } };
  }

  const res = await fetch(POSTS_URL, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`LinkedIn publish failed (${res.status}): ${t.slice(0, 200)}`);
  }
  // The created post URN comes back in the x-restli-id / x-linkedin-id header.
  const externalId = res.headers.get('x-restli-id') || res.headers.get('x-linkedin-id') || 'unknown';
  return { externalId };
}
