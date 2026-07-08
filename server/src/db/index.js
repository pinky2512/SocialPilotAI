// Database access layer.
//
// DEV ENGINE: node:sqlite (built into Node >=22.5). File-backed, synchronous,
// zero external services — so the whole platform runs and is testable locally.
// To move to the production PostgreSQL target (see CLAUDE.md tech stack), this
// is the single module to swap: replace DatabaseSync with a `pg` pool and make
// the query helpers async. Callers use the small helper surface below, so the
// swap does not ripple outward.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// DB_FILE=':memory:' is used by the test suite for an isolated, throwaway DB.
const DB_FILE = process.env.DB_FILE || join(__dirname, '..', '..', 'data', 'social_pilot.db');

let db;

export function getDb() {
  if (!db) {
    if (DB_FILE !== ':memory:') {
      mkdirSync(dirname(DB_FILE), { recursive: true });
    }
    db = new DatabaseSync(DB_FILE);
    db.exec('PRAGMA foreign_keys = ON;');
    initSchema();
  }
  return db;
}

function initSchema() {
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
}

// --- Small query helpers (portable surface) -------------------------------

export function run(sql, params = []) {
  return getDb().prepare(sql).run(...params);
}

export function get(sql, params = []) {
  return getDb().prepare(sql).get(...params);
}

export function all(sql, params = []) {
  return getDb().prepare(sql).all(...params);
}

// Test-only: reset the singleton so a fresh ':memory:' DB can be created.
export function _resetForTests() {
  if (db) db.close();
  db = undefined;
}
