// Current-user resolution.
//
// R0 keeps this deliberately simple: the caller identifies itself with an
// `x-user-id` header, resolved against the users table. Full OAuth 2.0 / JWT
// issuance and verification arrive with the Security & Access Control Agent
// stories (STORY-010, STORY-041). This middleware is the seam those stories
// will replace — routes downstream only depend on `req.user`.

import { get } from '../db/index.js';

export function attachCurrentUser(req, _res, next) {
  const id = req.header('x-user-id');
  if (id) {
    req.user = get('SELECT id, name, role, email FROM users WHERE id = ?', [Number(id)]) || null;
  } else {
    req.user = null;
  }
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'authentication required (set x-user-id header)' });
  }
  next();
}
