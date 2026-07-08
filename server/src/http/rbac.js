// RBAC middleware. Wraps the Security and Access Control Agent's authorize()
// decision for Express routes. Requires attachCurrentUser + requireUser to run
// first (so req.user is set). On denial returns 403 with a clear message; the
// denial is audited by the agent.

import { authorize } from '../agents/securityAgent.js';

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'authentication required' });
    }
    const allowed = authorize(req.user, permission, {
      method: req.method,
      route: req.originalUrl,
    });
    if (!allowed) {
      return res.status(403).json({
        error: `forbidden: role '${req.user.role}' lacks permission '${permission}'`,
      });
    }
    next();
  };
}
