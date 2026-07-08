// Thin API client. Every request carries the acting user's id (x-user-id),
// which the backend resolves to req.user. Swap for a Bearer JWT when auth lands.

async function request(path, { method = 'GET', body, userId } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (userId) headers['x-user-id'] = String(userId);
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

export const api = {
  // Content
  generateContent: (userId, payload) =>
    request('/api/content/generate', { method: 'POST', body: payload, userId }),
  editContent: (userId, id, contentText) =>
    request(`/api/content/${id}`, { method: 'PATCH', body: { contentText }, userId }),
  listContent: (userId, status) =>
    request(`/api/content${status ? `?status=${status}` : ''}`, { userId }),

  // Approvals
  submitForApproval: (userId, contentId) =>
    request('/api/approvals/submit', { method: 'POST', body: { contentId }, userId }),
  pendingApprovals: (userId) => request('/api/approvals/pending', { userId }),
  approve: (userId, approvalId) =>
    request(`/api/approvals/${approvalId}/approve`, { method: 'POST', userId }),
  reject: (userId, approvalId, reason) =>
    request(`/api/approvals/${approvalId}/reject`, { method: 'POST', body: { reason }, userId }),

  // Social
  listAccounts: (userId) => request('/api/social/accounts', { userId }),
  connectAccount: (userId, payload) =>
    request('/api/social/accounts', { method: 'POST', body: payload, userId }),
  disconnectAccount: (userId, id) =>
    request(`/api/social/accounts/${id}`, { method: 'DELETE', userId }),
  platforms: (userId) => request('/api/social/platforms', { userId }),
  preview: (userId, text, platforms) =>
    request('/api/social/preview', { method: 'POST', body: { text, platforms }, userId }),
  schedulePost: (userId, payload) =>
    request('/api/social/posts', { method: 'POST', body: payload, userId }),
  listPosts: (userId, status) =>
    request(`/api/social/posts${status ? `?status=${status}` : ''}`, { userId }),
  publishPost: (userId, id) =>
    request(`/api/social/posts/${id}/publish`, { method: 'POST', userId }),
  publishDue: (userId) => request('/api/social/publish-due', { method: 'POST', userId }),

  // Audit (append-only trail)
  audit: (userId, { prefix, action, limit } = {}) => {
    const q = new URLSearchParams();
    if (prefix) q.set('prefix', prefix);
    if (action) q.set('action', action);
    if (limit) q.set('limit', String(limit));
    const qs = q.toString();
    return request(`/api/audit${qs ? `?${qs}` : ''}`, { userId });
  },
  auditActions: (userId) => request('/api/audit/actions', { userId }),
};
