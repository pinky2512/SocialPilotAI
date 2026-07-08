// Platform rules registry. STORY-004 uses the supported-platform list; the
// per-platform nuance handling (STORY-006) builds on the rules below.

export const SUPPORTED_PLATFORMS = ['twitter', 'linkedin', 'instagram', 'facebook'];

// Baseline rules per platform. Expanded in STORY-006.
export const PLATFORM_RULES = {
  twitter:   { maxLength: 280,  maxHashtags: 3 },
  linkedin:  { maxLength: 3000, maxHashtags: 5 },
  instagram: { maxLength: 2200, maxHashtags: 30 },
  facebook:  { maxLength: 63206, maxHashtags: 10 },
};

export function rulesFor(platform) {
  return PLATFORM_RULES[String(platform || '').toLowerCase()] || null;
}

/**
 * Adapt text to a platform's constraints. Baseline: truncate to maxLength.
 * STORY-006 expands this with hashtag trimming and per-platform nuances.
 */
export function adaptForPlatform(text, platform) {
  const rules = rulesFor(platform);
  if (!rules) return text;
  let out = String(text);
  if (out.length > rules.maxLength) out = out.slice(0, rules.maxLength - 1).trimEnd() + '…';
  return out;
}
