// Trust and Governance Coordinator — commands: coordinateAgents, monitorSystemHealth.
// Reacts to: agentCommand, systemEvent. Monitors all approval gates and trust
// metrics (CLAUDE.md multi-agent map).
//
// STORY-025 — Trust control #4: the Trust Dashboard. One snapshot covering
// system health, pending approvals, recent actions, and anomalies. Read-only
// aggregation over the app's own tables — no side effects.

import { all } from '../db/index.js';
import { recentActions } from '../trust/audit.js';
import { pendingApprovals } from '../trust/approvals.js';

function countsByStatus(table) {
  const rows = all(`SELECT status, COUNT(*) AS n FROM ${table} GROUP BY status`);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

/**
 * monitorSystemHealth — build the Trust Dashboard snapshot.
 * @returns {object}
 */
export function monitorSystemHealth() {
  const agentTasks = countsByStatus('ai_agent_tasks');
  const totalTasks = sum(agentTasks);
  const failedTasks = agentTasks.failed || 0;
  const integrations = countsByStatus('integration_logs');

  const pending = pendingApprovals();

  // --- anomalies: things a human should look at -----------------------------
  const anomalies = [];
  for (const t of all("SELECT * FROM ai_agent_tasks WHERE status = 'failed' ORDER BY id DESC LIMIT 5")) {
    anomalies.push({ type: 'agent_task_failed', message: `${t.agent_id} · ${t.task_type} failed`, at: t.updated_at });
  }
  for (const d of all("SELECT * FROM audit_log WHERE action = 'access.denied' ORDER BY id DESC LIMIT 5")) {
    const det = safeParse(d.details);
    anomalies.push({ type: 'access_denied', message: `role '${det.role}' denied '${det.permission}'`, at: d.timestamp });
  }
  for (const b of all("SELECT * FROM audit_log WHERE action = 'broker.handler_error' ORDER BY id DESC LIMIT 5")) {
    const det = safeParse(b.details);
    anomalies.push({ type: 'broker_error', message: `broker handler error on '${det.topic}'`, at: b.timestamp });
  }
  for (const i of all("SELECT * FROM integration_logs WHERE status = 'failed' ORDER BY id DESC LIMIT 5")) {
    anomalies.push({ type: 'integration_failed', message: `${i.integration_type} · ${i.action} failed`, at: i.timestamp });
  }

  const failureRate = totalTasks ? Math.round((failedTasks / totalTasks) * 1000) / 10 : 0;
  const status = failureRate > 25 ? 'degraded' : anomalies.length ? 'attention' : 'healthy';

  return {
    generatedAt: new Date().toISOString(),
    health: {
      status,
      failureRate, // % of agent tasks that failed
      agentTasks: { total: totalTasks, byStatus: agentTasks },
      integrations: { total: sum(integrations), byStatus: integrations },
    },
    pendingApprovals: { count: pending.length, items: pending.slice(0, 10) },
    recentActions: recentActions(15),
    anomalies: anomalies.slice(0, 12),
  };
}

function safeParse(json) {
  try { return JSON.parse(json || '{}'); } catch { return {}; }
}
