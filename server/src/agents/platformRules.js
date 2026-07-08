// Platform rules registry + nuance handling (STORY-004 list, STORY-006 rules).
//
// Each platform has different constraints: character limits, how many hashtags
// read as spam, whether inline links work, and mention formatting. adaptForPlatform
// applies these so a single approved draft becomes correct per-platform text;
// validateForPlatform reports any remaining issues for human review.

export const SUPPORTED_PLATFORMS = ['twitter', 'linkedin', 'instagram', 'facebook'];

export const PLATFORM_RULES = {
  twitter: {
    maxLength: 280,  maxHashtags: 3,  inlineLinks: true,
    note: 'Short and punchy; 1–2 hashtags perform best.',
  },
  linkedin: {
    maxLength: 3000, maxHashtags: 5,  inlineLinks: true,
    note: 'Professional tone; hashtags grouped at the end.',
  },
  instagram: {
    maxLength: 2200, maxHashtags: 30, inlineLinks: false, // links are not clickable in captions
    note: 'Links are not clickable in captions — use “link in bio”.',
  },
  facebook: {
    maxLength: 63206, maxHashtags: 10, inlineLinks: true,
    note: 'Long form is fine; keep the first line strong.',
  },
};

export function rulesFor(platform) {
  return PLATFORM_RULES[String(platform || '').toLowerCase()] || null;
}

const HASHTAG_RE = /#[\p{L}0-9_]+/gu;
const URL_RE = /\bhttps?:\/\/\S+/gi;

/**
 * Adapt text to a platform's constraints.
 *  - caps hashtags to maxHashtags (keeps the first N in order)
 *  - platforms without clickable links get URLs replaced by "(link in bio)"
 *  - truncates to maxLength, preserving trailing hashtags where possible
 */
export function adaptForPlatform(text, platform) {
  const rules = rulesFor(platform);
  if (!rules) return String(text);
  let out = String(text);

  // 1) Cap hashtags — drop extras beyond the platform's limit.
  const hashtags = out.match(HASHTAG_RE) || [];
  if (hashtags.length > rules.maxHashtags) {
    let kept = 0;
    out = out.replace(HASHTAG_RE, (tag) => (++kept <= rules.maxHashtags ? tag : '')).replace(/\s{2,}/g, ' ').trim();
  }

  // 2) Non-clickable-link platforms: replace inline URLs.
  if (!rules.inlineLinks) {
    out = out.replace(URL_RE, '(link in bio)');
  }

  // 3) Truncate to maxLength, trying to keep trailing hashtags intact.
  if (out.length > rules.maxLength) {
    const trailing = (out.match(new RegExp(`(\\s*(?:${'#[\\p{L}0-9_]+\\s*'})+)$`, 'u')) || [''])[0].trim();
    if (trailing && trailing.length < rules.maxLength - 20) {
      const bodyBudget = rules.maxLength - trailing.length - 2;
      const body = out.slice(0, out.length - trailing.length).slice(0, bodyBudget).trimEnd();
      out = `${body}… ${trailing}`;
    } else {
      out = out.slice(0, rules.maxLength - 1).trimEnd() + '…';
    }
  }
  return out;
}

/**
 * Validate text against a platform; returns { ok, issues[] }. Used to surface
 * remaining nuances (e.g. over-limit, too many hashtags) for human review.
 */
export function validateForPlatform(text, platform) {
  const rules = rulesFor(platform);
  const issues = [];
  if (!rules) return { ok: false, issues: [`unsupported platform '${platform}'`] };

  const str = String(text);
  if (str.trim().length === 0) issues.push('post text is empty');
  if (str.length > rules.maxLength) {
    issues.push(`exceeds ${platform} limit of ${rules.maxLength} chars (${str.length})`);
  }
  const hashtags = str.match(HASHTAG_RE) || [];
  if (hashtags.length > rules.maxHashtags) {
    issues.push(`too many hashtags for ${platform} (${hashtags.length} > ${rules.maxHashtags})`);
  }
  if (!rules.inlineLinks && URL_RE.test(str)) {
    issues.push(`${platform} does not support clickable inline links`);
  }
  return { ok: issues.length === 0, issues };
}
