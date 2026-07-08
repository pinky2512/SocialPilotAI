// Security and Access Control Agent — owns REQ-008.
// Commands: manageRoles, auditRoleChanges. Reacts to: roleChangeRequest.
//
// STORY-010 responsibility: enforce Role-Based Access Control for social media
// features. This agent is the single authority that decides whether a user's
// role may perform an action, and — crucially for governance/observability —
// records every DENIED attempt in the append-only audit log.
// (Role management / auditRoleChanges land in STORY-041/043.)

import { can, permissionsFor } from '../auth/permissions.js';
import { logAction } from '../trust/audit.js';

const AGENT_ID = 'security-and-access-control-agent';

/**
 * Authorize an action. Returns true if allowed; on denial, records an
 * access.denied audit entry and returns false.
 *
 * @param {object} user       req.user ({ id, role, ... })
 * @param {string} permission a PERMISSIONS.* value
 * @param {object} [context]  extra detail for the audit entry (route/method)
 */
export function authorize(user, permission, context = {}) {
  const role = user?.role;
  if (role && can(role, permission)) return true;

  logAction({
    userId: user?.id ?? null,
    action: 'access.denied',
    details: { agent: AGENT_ID, role: role ?? null, permission, ...context },
  });
  return false;
}

/** The concrete permission list for a role (for a /me endpoint / UI gating). */
export function getPermissions(role) {
  return permissionsFor(role);
}
