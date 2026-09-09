// Registry of real OAuth posting providers.
//
// To add a platform (e.g. Facebook, Twitter/X): create integrations/<name>.js
// exposing { isConfigured, authorizeUrl, exchangeCode, fetchUserinfo,
// publishTextPost } (same shape as linkedin.js) and register it in PROVIDERS.
// Everything else — the connect dropdown, OAuth routes, and live publishing —
// picks it up automatically.

import * as linkedin from './linkedin.js';

const PROVIDERS = {
  linkedin: { id: 'linkedin', label: 'LinkedIn', module: linkedin },
  // facebook: { id: 'facebook', label: 'Facebook', module: facebook },
  // twitter:  { id: 'twitter',  label: 'Twitter/X', module: twitter },
};

// Platforms we intend to support, so the UI can show "coming soon" for ones
// without an integration module yet.
const KNOWN = [
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'twitter', label: 'Twitter/X' },
];

/** One row per known platform: whether it's implemented and configured. */
export function providerList() {
  return KNOWN.map(({ id, label }) => {
    const p = PROVIDERS[id];
    return {
      id,
      label,
      available: Boolean(p),                              // has an integration module
      configured: p ? p.module.isConfigured() : false,   // env credentials present
    };
  });
}

/** Look up a registered provider by id (undefined if not implemented). */
export function getProvider(id) {
  return PROVIDERS[id];
}
