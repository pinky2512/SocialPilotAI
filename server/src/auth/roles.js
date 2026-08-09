// Canonical roles (RBAC). The project uses two roles that map onto the two
// sides of every approval gate:
//   - Campaign Manager: creates/schedules content, posts, and email campaigns
//     (the "AI proposes" side) — but cannot approve, publish, or send.
//   - Administrator: approves/rejects, publishes, sends, manages roles, and has
//     full visibility (the "human approves" + governance side).
// This preserves segregation of duties: the creator cannot approve their own work.

export const ROLES = Object.freeze({
  CAMPAIGN_MANAGER: 'campaign_manager',
  ADMINISTRATOR: 'administrator',
});

export const ALL_ROLES = Object.freeze(Object.values(ROLES));

export function isRole(value) {
  return ALL_ROLES.includes(value);
}
