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
  generateContent: (userId, payload) =>
    request('/api/content/generate', { method: 'POST', body: payload, userId }),
  editContent: (userId, id, contentText) =>
    request(`/api/content/${id}`, { method: 'PATCH', body: { contentText }, userId }),
  listContent: (userId, status) =>
    request(`/api/content${status ? `?status=${status}` : ''}`, { userId }),
  submitForApproval: (userId, contentId) =>
    request('/api/approvals/submit', { method: 'POST', body: { contentId }, userId }),
  pendingApprovals: (userId) => request('/api/approvals/pending', { userId }),
  approve: (userId, approvalId) =>
    request(`/api/approvals/${approvalId}/approve`, { method: 'POST', userId }),
  reject: (userId, approvalId, reason) =>
    request(`/api/approvals/${approvalId}/reject`, { method: 'POST', body: { reason }, userId }),
};
