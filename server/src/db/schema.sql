-- Social Pilot AI — database schema
--
-- DEV ENGINE: node:sqlite (zero-dependency, file-backed) so the app runs and is
-- verifiable with no external services. The column set mirrors the intended
-- PostgreSQL schema in CLAUDE.md 1:1; types are kept portable (TEXT ISO-8601
-- timestamps, INTEGER PKs). Swapping to Postgres means changing the driver in
-- db/index.js and translating AUTOINCREMENT -> SERIAL / TEXT ts -> TIMESTAMPTZ.
--
-- RULE (CLAUDE.md convention #5): audit_log is append-only. UPDATE/DELETE are
-- blocked below by triggers, not just by convention.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  role            TEXT    NOT NULL,                       -- see src/auth/roles.js
  email           TEXT    NOT NULL UNIQUE,
  hashed_password TEXT    NOT NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  manager_id INTEGER REFERENCES users(id),
  start_date TEXT,
  end_date   TEXT,
  status     TEXT    NOT NULL DEFAULT 'draft'
);

CREATE TABLE IF NOT EXISTS content (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id  INTEGER REFERENCES campaigns(id),
  creator_id   INTEGER REFERENCES users(id),
  content_text TEXT    NOT NULL,
  -- lifecycle: draft -> pending_approval -> approved | rejected -> published
  status       TEXT    NOT NULL DEFAULT 'draft',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Append-only. Never UPDATE or DELETE (enforced by triggers below).
CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER,               -- nullable: system/agent actions have no human user
  action    TEXT    NOT NULL,
  timestamp TEXT    NOT NULL DEFAULT (datetime('now')),
  details   TEXT                   -- JSON blob: who/what/before-after context
);

CREATE TRIGGER IF NOT EXISTS audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only: UPDATE is not permitted');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only: DELETE is not permitted');
END;

CREATE TABLE IF NOT EXISTS ai_agent_tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id   TEXT    NOT NULL,      -- logical agent name, e.g. 'content-generation-agent'
  task_type  TEXT    NOT NULL,      -- command name, e.g. 'generateContent'
  status     TEXT    NOT NULL DEFAULT 'created', -- created -> running -> done | failed | escalated
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS approval_processes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id    INTEGER REFERENCES content(id),
  approver_id   INTEGER REFERENCES users(id),   -- set when a decision is made
  status        TEXT    NOT NULL DEFAULT 'pending', -- pending -> approved | rejected
  decision_date TEXT
);

CREATE TABLE IF NOT EXISTS integration_logs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_type TEXT    NOT NULL,   -- e.g. 'twitter', 'sendgrid', 'salesforce'
  action           TEXT    NOT NULL,
  status           TEXT    NOT NULL,
  timestamp        TEXT    NOT NULL DEFAULT (datetime('now')),
  details          TEXT
);
