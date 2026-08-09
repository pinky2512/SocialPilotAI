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
import { isLLMConfigured, generateDraft, activeModel } from './llm.js';

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
    return persistDraft({ creatorId, campaignId, draftText, prompt, platform, tone, taskId, source: 'template' });
  } catch (err) {
    finishTask(taskId, 'failed');
    throw err;
  }
}

/**
 * generateContentAI — async variant that uses a real LLM (Claude) when one is
 * configured (ANTHROPIC_API_KEY set), falling back to the template generator
 * otherwise. This is what the HTTP route uses so the product is genuinely
 * AI-generated; the sync generateContent above stays template-based for
 * deterministic internal/test use.
 *
 * @param {boolean} [p.useLLM] override auto-detection (tests pass false).
 */
export async function generateContentAI({ creatorId, campaignId = null, prompt, platform = 'generic', tone = 'professional', useLLM }) {
  if (!prompt || !prompt.trim()) throw new Error('generateContent requires a prompt');
  const viaLLM = useLLM ?? isLLMConfigured();
  const taskId = startTask({ agentId: AGENT_ID, taskType: 'generateContent' });
  try {
    let draftText;
    let source;
    if (viaLLM) {
      draftText = await generateDraft({ prompt, platform, tone });
      source = activeModel();
    } else {
      draftText = draftFromPrompt({ prompt, platform, tone });
      source = 'template';
    }
    return persistDraft({ creatorId, campaignId, draftText, prompt, platform, tone, taskId, source });
  } catch (err) {
    finishTask(taskId, 'failed');
    throw err;
  }
}

/** Shared persistence: insert draft, audit, close the task, announce. */
function persistDraft({ creatorId, campaignId, draftText, prompt, platform, tone, taskId, source }) {
  const info = run(
    "INSERT INTO content (campaign_id, creator_id, content_text, status, source) VALUES (?, ?, ?, 'draft', ?)",
    [campaignId, creatorId, draftText, source]
  );
  const content = get('SELECT * FROM content WHERE id = ?', [info.lastInsertRowid]);

  logAction({
    userId: creatorId,
    action: 'content.generated',
    details: { contentId: content.id, agent: AGENT_ID, prompt, platform, tone, campaignId, source },
  });

  finishTask(taskId, 'done');
  // Announce over the broker so governance/other agents can react. Nothing is
  // published here — publishing requires passing the human approval gate.
  broker.publish('contentGenerated', { contentId: content.id, creatorId, campaignId });
  return content;
}

/**
 * STORY-029 — publish approved content (approved -> published).
 *
 * Human-approval-gate enforcement for AI-generated content: content can ONLY be
 * published from status 'approved' (i.e. it passed the STORY-002 approval gate).
 * Any other status is refused, so AI-generated content can never go live without
 * a human having approved it. Records who published and the content's source.
 */
export function publishContent({ contentId, userId = null }) {
  const content = get('SELECT * FROM content WHERE id = ?', [contentId]);
  if (!content) throw new Error(`content ${contentId} not found`);
  if (content.status !== 'approved') {
    throw new Error(`content ${contentId} is '${content.status}' — only approved content can be published`);
  }
  run("UPDATE content SET status = 'published' WHERE id = ?", [contentId]);
  logAction({
    userId,
    action: 'content.published',
    details: { contentId, source: content.source, creatorId: content.creator_id },
  });
  broker.publish('contentPublished', { contentId });
  return get('SELECT * FROM content WHERE id = ?', [contentId]);
}

/**
 * editContent — human edits a draft's text. Editing is only allowed while the
 * content is not yet live (draft / rejected / pending_approval). Editing an
 * item that was already submitted resets it to 'draft' so it must pass the
 * approval gate again (an edited draft is a new proposal). Records the
 * before/after in the append-only audit log.
 *
 * @param {object} p
 * @param {number} p.contentId
 * @param {number} p.editorId
 * @param {string} p.contentText  the new body
 * @returns {object} updated content row.
 */
export function editContent({ contentId, editorId, contentText }) {
  if (contentText == null || !String(contentText).trim()) {
    throw new Error('editContent requires non-empty contentText');
  }
  const content = get('SELECT * FROM content WHERE id = ?', [contentId]);
  if (!content) throw new Error(`content ${contentId} not found`);

  const editable = ['draft', 'rejected', 'pending_approval'];
  if (!editable.includes(content.status)) {
    throw new Error(`content ${contentId} is '${content.status}' and can no longer be edited`);
  }

  const before = content.content_text;
  // A re-edited, already-submitted draft returns to 'draft': it must be
  // re-approved. This keeps the approval-gate contract intact.
  const nextStatus = content.status === 'pending_approval' ? 'draft' : content.status;
  run(
    'UPDATE content SET content_text = ?, status = ? WHERE id = ?',
    [contentText, nextStatus, contentId]
  );

  logAction({
    userId: editorId,
    action: 'content.edited',
    details: { contentId, before, after: contentText, statusFrom: content.status, statusTo: nextStatus },
  });
  broker.publish('contentEdited', { contentId, editorId });
  return get('SELECT * FROM content WHERE id = ?', [contentId]);
}

/**
 * Template-based content generator — the FALLBACK used when no LLM is
 * configured (and by the deterministic sync generateContent for tests).
 *
 * The real LLM path lives in ./llm.js (generateDraftWithClaude), used by
 * generateContentAI. Contract (both implementations):
 *   input:  { prompt: string, platform: string, tone: string }
 *   output: string  // the generated draft body
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
