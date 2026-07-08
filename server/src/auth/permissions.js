// Permission matrix (RBAC). Single source of truth for what each role may do.
// STORY-010 introduces the social-media permissions; later RBAC stories
// (STORY-027 analytics, STORY-036 content approval, STORY-041/042 general)
// extend the same matrix rather than inventing parallel checks.

import { ROLES } from './roles.js';

export const PERMISSIONS = Object.freeze({
  // Social media features (STORY-010)
  SOCIAL_VIEW: 'social:view',
  SOCIAL_CONNECT: 'social:connect',
  SOCIAL_SCHEDULE: 'social:schedule',
  SOCIAL_PUBLISH: 'social:publish',
  SOCIAL_APPROVE: 'social:approve',
});

// Wildcard grants every permission (platform admin).
const ALL = '*';

export const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.PLATFORM_ADMIN]: [ALL],
  [ROLES.CAMPAIGN_MANAGER]: [
    PERMISSIONS.SOCIAL_VIEW,
    PERMISSIONS.SOCIAL_CONNECT,
    PERMISSIONS.SOCIAL_SCHEDULE,
    PERMISSIONS.SOCIAL_PUBLISH,
  ],
  [ROLES.CONTENT_CREATOR]: [
    PERMISSIONS.SOCIAL_VIEW,
    PERMISSIONS.SOCIAL_SCHEDULE,
  ],
  // Leadership provides the human approval + can release approved posts.
  [ROLES.MARKETING_LEADERSHIP]: [
    PERMISSIONS.SOCIAL_VIEW,
    PERMISSIONS.SOCIAL_APPROVE,
    PERMISSIONS.SOCIAL_PUBLISH,
  ],
  [ROLES.DATA_ANALYST]: [
    PERMISSIONS.SOCIAL_VIEW,
  ],
});

/** Does a role hold a permission? Wildcard '*' grants everything. */
export function can(role, permission) {
  const grants = ROLE_PERMISSIONS[role] || [];
  return grants.includes(ALL) || grants.includes(permission);
}

/** Expand a role's permissions to a concrete list (wildcard -> all perms). */
export function permissionsFor(role) {
  const grants = ROLE_PERMISSIONS[role] || [];
  if (grants.includes(ALL)) return Object.values(PERMISSIONS);
  return grants;
}
