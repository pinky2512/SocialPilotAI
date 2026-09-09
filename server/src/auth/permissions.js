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

  // Email campaign features (STORY-011)
  EMAIL_VIEW: 'email:view',
  EMAIL_CREATE: 'email:create',
  EMAIL_SEND: 'email:send',
  EMAIL_APPROVE: 'email:approve',

  // Content approval (STORY-036) — the right to approve/reject held items in the
  // approval queue. Separation of duties: Campaign Managers create, only an
  // Administrator approves. Administrator holds it via the '*' wildcard.
  CONTENT_APPROVE: 'content:approve',

  // Analytics features (STORY-027)
  ANALYTICS_VIEW: 'analytics:view',     // dashboards, metrics, predictions
  ANALYTICS_INGEST: 'analytics:ingest', // write engagement telemetry

  // Privacy / compliance (STORY-033) — export/erase personal data
  PRIVACY_MANAGE: 'privacy:manage',
});

// Wildcard grants every permission (platform admin).
const ALL = '*';

export const ROLE_PERMISSIONS = Object.freeze({
  // Administrator: full access — approves, publishes, sends, manages roles.
  [ROLES.ADMINISTRATOR]: [ALL],
  // Campaign Manager: the "doer" — creates and schedules, but cannot approve,
  // publish, or send (those pass through the Administrator's approval gate).
  [ROLES.CAMPAIGN_MANAGER]: [
    PERMISSIONS.SOCIAL_VIEW,
    PERMISSIONS.SOCIAL_CONNECT,
    PERMISSIONS.SOCIAL_SCHEDULE,
    PERMISSIONS.EMAIL_VIEW,
    PERMISSIONS.EMAIL_CREATE,
    PERMISSIONS.ANALYTICS_VIEW, // managers read analytics; writing telemetry is admin-only
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
