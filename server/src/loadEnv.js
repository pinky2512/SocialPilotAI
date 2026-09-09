// Auto-load server/.env into process.env on startup, so API keys are set once in
// a gitignored file instead of re-pasted every session. Imported FIRST in
// server.js (before any module that reads process.env at import time).
//
// Uses Node's built-in env-file loader (Node 20.12+/24) — no dependency. If the
// file is absent, we simply run with whatever env vars are already set.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env'); // server/.env
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch (err) {
    console.warn(`[env] could not load ${envPath}: ${err.message}`);
  }
}
