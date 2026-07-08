// Canonical roles (RBAC). The five target users from CLAUDE.md map to roles.
// Fine-grained permission checks are layered on in the Security & Access Control
// Agent stories (STORY-010, STORY-027, STORY-036, STORY-041, STORY-042).

export const ROLES = Object.freeze({
  CAMPAIGN_MANAGER: 'campaign_manager',
  CONTENT_CREATOR: 'content_creator',
  DATA_ANALYST: 'data_analyst',
  MARKETING_LEADERSHIP: 'marketing_leadership',
  PLATFORM_ADMIN: 'platform_admin',
});

export const ALL_ROLES = Object.freeze(Object.values(ROLES));

export function isRole(value) {
  return ALL_ROLES.includes(value);
}
