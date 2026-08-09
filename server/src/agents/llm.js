// Real LLM integration for content generation (Claude via the official SDK).
//
// This is the concrete implementation of the swap-in point documented in
// contentGenerationAgent.js. Contract:
//   input:  { prompt: string, platform: string, tone: string }
//   output: string   // the generated draft body
//
// Enabled only when ANTHROPIC_API_KEY is set (the SDK reads it from the env, or
// from an `ant auth login` profile). When absent, callers fall back to the
// template generator so the app still runs and tests stay hermetic.

import Anthropic from '@anthropic-ai/sdk';

// Default to the current, most capable Claude model. Override with CONTENT_MODEL.
const MODEL = process.env.CONTENT_MODEL || 'claude-opus-5';

let _client;
function client() {
  if (!_client) _client = new Anthropic(); // resolves ANTHROPIC_API_KEY from env
  return _client;
}

/** True when a real LLM is configured. */
export function isLLMConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const PLATFORM_HINTS = {
  twitter: 'Keep it under 280 characters. 1–2 relevant hashtags max.',
  linkedin: 'Professional, insightful tone. A short hook, then value. Hashtags grouped at the end.',
  instagram: 'Warm and visual. Links are not clickable in captions — say "link in bio" instead.',
  facebook: 'Conversational; a strong first line. Longer form is fine.',
  generic: 'Clear, engaging marketing copy.',
};

/**
 * Generate a content draft with Claude.
 * @returns {Promise<string>} the draft body (text only).
 */
export async function generateDraftWithClaude({ prompt, platform = 'generic', tone = 'professional' }) {
  const hint = PLATFORM_HINTS[platform] || PLATFORM_HINTS.generic;
  const system =
    'You are a marketing copywriter for Social Pilot AI. Write a single, ready-to-post ' +
    'social media post based on the user\'s brief. Return ONLY the post text — no preamble, ' +
    'no explanations, no surrounding quotes.';

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 1024,
    // Content drafting is a short, well-scoped task — low effort keeps it fast and cheap.
    output_config: { effort: 'low' },
    system,
    messages: [
      {
        role: 'user',
        content:
          `Platform: ${platform}\nTone: ${tone}\n${hint}\n\n` +
          `Write the post about: ${prompt}`,
      },
    ],
  });

  const text = res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  if (!text) throw new Error('LLM returned no text content');
  return text;
}

export const CONTENT_MODEL = MODEL;
