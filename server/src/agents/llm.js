// Real LLM integration for content generation — provider-pluggable.
//
// This is the concrete implementation of the swap-in point documented in
// contentGenerationAgent.js. Contract:
//   input:  { prompt: string, platform: string, tone: string }
//   output: string   // the generated draft body
//
// Provider is selected by LLM_PROVIDER (default 'anthropic'):
//   - anthropic : Claude via the official SDK (ANTHROPIC_API_KEY, CONTENT_MODEL)
//   - openai    : any OpenAI-compatible /chat/completions endpoint
//                 (OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL) — works with
//                 OpenAI, OpenRouter, Groq, Mistral, Together, Ollama, etc.
//
// When the selected provider has no key, callers fall back to the template
// generator so the app still runs and tests stay hermetic.

import Anthropic from '@anthropic-ai/sdk';

const PROVIDER = (process.env.LLM_PROVIDER || 'anthropic').toLowerCase();

// --- Anthropic (default) ---------------------------------------------------
const ANTHROPIC_MODEL = process.env.CONTENT_MODEL || 'claude-opus-5';

// --- OpenAI-compatible -----------------------------------------------------
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

/** True when the selected provider has credentials configured. */
export function isLLMConfigured() {
  if (PROVIDER === 'openai') return Boolean(process.env.OPENAI_API_KEY);
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Label recorded as the audit "source" for generated content. */
export function activeModel() {
  return PROVIDER === 'openai' ? `openai:${OPENAI_MODEL}` : ANTHROPIC_MODEL;
}

const PLATFORM_HINTS = {
  twitter: 'Keep it under 280 characters. 1–2 relevant hashtags max.',
  linkedin: 'Professional, insightful tone. A short hook, then value. Hashtags grouped at the end.',
  instagram: 'Warm and visual. Links are not clickable in captions — say "link in bio" instead.',
  facebook: 'Conversational; a strong first line. Longer form is fine.',
  generic: 'Clear, engaging marketing copy.',
};

function buildPrompt({ prompt, platform, tone, guidance, context }) {
  const hint = PLATFORM_HINTS[platform] || PLATFORM_HINTS.generic;
  const system =
    'You are a marketing copywriter for Social Pilot AI. Write a single, ready-to-post ' +
    "social media post based on the user's brief. Return ONLY the post text — no preamble, " +
    'no explanations, no surrounding quotes. Do NOT add a title, heading, label, or section ' +
    'name, and do NOT start the post with a "#" heading (hashtags belong only at the end as tags). ' +
    'Begin directly with the post copy.';
  // STORY-031 — inject learning guidance derived from past user feedback.
  const learn = guidance ? `\n\nGuidance from past feedback: ${guidance}` : '';
  // Document grounding — write ONLY from the provided product facts (new products).
  const ground = context
    ? `\n\nProduct document (use ONLY these facts; do not invent details not present here):\n"""\n${context}\n"""`
    : '';
  const user = `Platform: ${platform}\nTone: ${tone}\n${hint}${learn}${ground}\n\nWrite the post about: ${prompt}`;
  return { system, user };
}

/**
 * Generate a content draft using the configured provider.
 * @param {string} [p.guidance] learning guidance from past feedback (STORY-031).
 * @param {string} [p.context]  product-document text to ground the copy on.
 * @returns {Promise<string>} the draft body (text only).
 */
export async function generateDraft({ prompt, platform = 'generic', tone = 'professional', guidance = '', context = '' }) {
  const parts = buildPrompt({ prompt, platform, tone, guidance, context });
  const text = PROVIDER === 'openai'
    ? await generateWithOpenAI(parts)
    : await generateWithClaude(parts);
  if (!text || !text.trim()) throw new Error('LLM returned no text content');
  return text.trim();
}

// --- provider implementations ---------------------------------------------

let _anthropic;
async function generateWithClaude({ system, user }) {
  if (!_anthropic) _anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY
  const res = await _anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    output_config: { effort: 'low' }, // short task — keep it fast and cheap
    system,
    messages: [{ role: 'user', content: user }],
  });
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

async function generateWithOpenAI({ system, user }) {
  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI-compatible API error ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}
