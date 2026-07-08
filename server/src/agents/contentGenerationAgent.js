// Content Generation Agent — owns REQ-001. Command: generateContent.
// Reacts to: contentApproval.
//
// Approval gate (CLAUDE.md agent map): AI-generated content is HELD for human
// approval before it can be published. This agent therefore NEVER creates
// content in a live/published status — a fresh draft starts as 'draft' and can
// only advance through the approval gate (see trust/approvals.js).

import { run, get } from '../db/index.js';
import { logAction } from '../trust/audit.js';
import { startTask, finishTask } from './taskTracker.js';
import { broker } from '../broker/index.js';

const AGENT_ID = 'content-generation-agent';

/**
 * generateContent — produce an AI content draft and persist it as 'draft'.
 *
 * @param {object} p
 * @param {number} p.creatorId    the human on whose behalf the draft is created
 * @param {number} [p.campaignId] optional campaign the draft belongs to
 * @param {string} p.prompt       what the content should be about
 * @param {string} [p.platform]   'generic' | 'twitter' | 'linkedin' | ... (tone hint)
 * @param {string} [p.tone]       e.g. 'friendly', 'professional'
 * @returns {object} the created content row (status 'draft').
 */
export function generateContent({ creatorId, campaignId = null, prompt, platform = 'generic', tone = 'professional' }) {
  if (!prompt || !prompt.trim()) throw new Error('generateContent requires a prompt');

  const taskId = startTask({ agentId: AGENT_ID, taskType: 'generateContent' });
  try {
    const draftText = draftFromPrompt({ prompt, platform, tone });

    const info = run(
      "INSERT INTO content (campaign_id, creator_id, content_text, status) VALUES (?, ?, ?, 'draft')",
      [campaignId, creatorId, draftText]
    );
    const content = get('SELECT * FROM content WHERE id = ?', [info.lastInsertRowid]);

    logAction({
      userId: creatorId,
      action: 'content.generated',
      details: { contentId: content.id, agent: AGENT_ID, prompt, platform, tone, campaignId },
    });

    finishTask(taskId, 'done');

    // Announce over the broker so governance/other agents can react. Nothing is
    // published here — publishing requires passing the human approval gate.
    broker.publish('contentGenerated', { contentId: content.id, creatorId, campaignId });

    return content;
  } catch (err) {
    finishTask(taskId, 'failed');
    throw err;
  }
}

/**
 * PLACEHOLDER content generator (template-based). SWAP-IN POINT for a real LLM.
 *
 * Intended real-model contract (drop-in replacement for this function):
 *   input:  { prompt: string, platform: string, tone: string }
 *   output: string  // the generated draft body
 * A real implementation would call the Claude API here (e.g. claude-opus-4-8)
 * with a system prompt encoding brand voice + platform rules and return
 * completion text. Callers (generateContent) are unaffected by the swap.
 */
function draftFromPrompt({ prompt, platform, tone }) {
  const topic = prompt.trim().replace(/\s+/g, ' ');
  const platformHints = {
    twitter: { max: 280, cta: 'Learn more 👇', tags: '#marketing #AI' },
    linkedin: { max: 700, cta: 'Read the full story in the comments.', tags: '#B2B #growth' },
    instagram: { max: 400, cta: 'Tap the link in bio.', tags: '#brand #community' },
    facebook: { max: 500, cta: 'See how it works →', tags: '' },
    generic: { max: 600, cta: 'Learn more.', tags: '' },
  };
  const h = platformHints[platform] || platformHints.generic;
  const opener = tone === 'friendly'
    ? `Hey there! Let's talk about ${topic}.`
    : `Here's what you need to know about ${topic}.`;

  let body = `${opener}\n\nOur team put together a quick take on ${topic} and why it matters for your goals right now. ${h.cta}`;
  if (h.tags) body += `\n\n${h.tags}`;
  if (body.length > h.max) body = body.slice(0, h.max - 1).trimEnd() + '…';
  return body;
}
