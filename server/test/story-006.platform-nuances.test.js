// STORY-006 — Handle Platform-Specific Nuances.
//
// Acceptance:
//  - Text is adapted per platform: char limits, hashtag caps, link handling.
//  - Adapted text passes that platform's validation.
//  - Scheduling uses the adapted text (integration with STORY-005).

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_FILE = ':memory:';

const { adaptForPlatform, validateForPlatform } = await import('../src/agents/platformRules.js');

test('twitter: truncates to 280 chars', () => {
  const long = 'word '.repeat(100); // 500 chars
  const out = adaptForPlatform(long, 'twitter');
  assert.ok(out.length <= 280);
  assert.ok(validateForPlatform(out, 'twitter').ok);
});

test('twitter: caps hashtags at 3', () => {
  const text = 'launch #a #b #c #d #e';
  const out = adaptForPlatform(text, 'twitter');
  const tags = out.match(/#[\w]+/g) || [];
  assert.equal(tags.length, 3);
});

test('instagram: replaces non-clickable inline links', () => {
  const text = 'See our site https://example.com/promo today';
  const out = adaptForPlatform(text, 'instagram');
  assert.ok(!/https?:\/\//.test(out), 'inline URL removed');
  assert.match(out, /link in bio/);
});

test('linkedin: allows longer text and inline links', () => {
  const text = 'Read more at https://example.com — ' + 'detail '.repeat(50);
  const out = adaptForPlatform(text, 'linkedin');
  assert.match(out, /https:\/\/example\.com/);
  assert.ok(validateForPlatform(out, 'linkedin').ok);
});

test('validate flags over-limit and excess hashtags', () => {
  const v = validateForPlatform('x'.repeat(300) + ' #a #b #c #d', 'twitter');
  assert.equal(v.ok, false);
  assert.ok(v.issues.some((i) => /limit/.test(i)));
  assert.ok(v.issues.some((i) => /hashtags/.test(i)));
});

test('unsupported platform validation fails cleanly', () => {
  const v = validateForPlatform('hi', 'myspace');
  assert.equal(v.ok, false);
});
