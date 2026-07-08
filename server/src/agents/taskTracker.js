// Agent task tracking — every agent command run is recorded in ai_agent_tasks
// so the Trust/Governance layer has observability into what the agents are
// doing (created -> running -> done | failed | escalated).

import { run, get } from '../db/index.js';

export function startTask({ agentId, taskType }) {
  const info = run(
    "INSERT INTO ai_agent_tasks (agent_id, task_type, status) VALUES (?, ?, 'running')",
    [agentId, taskType]
  );
  return info.lastInsertRowid;
}

export function finishTask(taskId, status = 'done') {
  run(
    "UPDATE ai_agent_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?",
    [status, taskId]
  );
  return get('SELECT * FROM ai_agent_tasks WHERE id = ?', [taskId]);
}
