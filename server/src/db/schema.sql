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
  -- STORY-029: what produced this draft (LLM model id, 'template', or 'human').
  source       TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Append-only. Never UPDATE or DELETE (enforced by triggers below).
CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER,               -- nullable: system/agent actions have no human user
  action    TEXT    NOT NULL,
  timestamp TEXT    NOT NULL DEFAULT (datetime('now')),
  details   TEXT,                  -- JSON blob: who/what/before-after context
  -- STORY-032: tamper-evident hash chain. Each row's hash covers the previous
  -- row's hash + this row's fields, so any alteration breaks the chain.
  prev_hash TEXT,
  hash      TEXT
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
  -- post_id added in R1 (STORY-005) so the same append/approve/reject gate
  -- machinery serves social posts too. Exactly one target column is set per row.
  post_id       INTEGER REFERENCES social_posts(id),
  -- email_campaign_id added in R2 (STORY-011) so email campaigns use the gate too.
  email_campaign_id INTEGER REFERENCES email_campaigns(id),
  -- recommendation_id added in R6 (STORY-024) so predictive recommendations are gated.
  recommendation_id INTEGER REFERENCES predictive_recommendations(id),
  -- image_id (extension) so AI-generated marketing images are gated too.
  image_id INTEGER REFERENCES content_images(id),
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

-- R1 (STORY-004) — connected social media accounts.
-- DEV NOTE: real OAuth token exchange is out of local scope; access_token holds
-- a placeholder. connectAccount() is the swap-in point for a real OAuth flow.
CREATE TABLE IF NOT EXISTS social_accounts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  platform     TEXT    NOT NULL,       -- twitter | linkedin | instagram | facebook
  handle       TEXT    NOT NULL,       -- @handle / page name
  access_token TEXT,                   -- placeholder for OAuth token (dev)
  status       TEXT    NOT NULL DEFAULT 'connected', -- connected | disconnected
  connected_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, platform, handle)
);

-- R1 (STORY-005/007) — social posts, one row per platform target.
-- Approval-gate contract: a post reaches 'published' only after a human
-- approves it via approval_processes.
CREATE TABLE IF NOT EXISTS social_posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id   INTEGER REFERENCES content(id),   -- the approved content being posted
  account_id   INTEGER NOT NULL REFERENCES social_accounts(id),
  platform     TEXT    NOT NULL,
  post_text    TEXT    NOT NULL,                 -- platform-adapted text
  image_id     INTEGER REFERENCES content_images(id),  -- optional attached image
  scheduled_at TEXT,                             -- ISO time to publish
  -- lifecycle: draft -> pending_approval -> approved -> published | failed | rejected
  status       TEXT    NOT NULL DEFAULT 'draft',
  published_at TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- R2 (STORY-011) — email campaigns.
-- Approval-gate contract: a campaign reaches 'sent' only after a human approves
-- it via approval_processes (enforced in sendEmail + trust/approvals.js).
-- DEV NOTE: the actual email-provider send is simulated; sendEmail() is the
-- swap-in point for a real ESP (SendGrid/SES/etc.).
CREATE TABLE IF NOT EXISTS email_campaigns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  subject      TEXT    NOT NULL,
  body         TEXT    NOT NULL,
  audience     TEXT,                                  -- segment/list descriptor
  -- lifecycle: draft -> pending_approval -> approved -> sent | rejected
  status       TEXT    NOT NULL DEFAULT 'draft',
  scheduled_at TEXT,
  sent_at      TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- EXTENSION — product documents (briefs/spec sheets) uploaded to ground AI
-- content generation for new products. We store the extracted text, not the file.
CREATE TABLE IF NOT EXISTS product_documents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  filename       TEXT    NOT NULL,
  mime           TEXT,
  extracted_text TEXT,
  chars          INTEGER,
  uploaded_by    INTEGER REFERENCES users(id),
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- EXTENSION — AI-generated marketing images. Held for human approval before
-- use, exactly like text content. DEV NOTE: real generation uses the OpenAI
-- Images API (OPENAI_API_KEY); without a key a placeholder SVG is produced.
CREATE TABLE IF NOT EXISTS content_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id INTEGER REFERENCES content(id),   -- optional: image for a content item
  prompt     TEXT    NOT NULL,
  file_path  TEXT,
  mime       TEXT,
  -- lifecycle: draft -> pending_approval -> approved | rejected
  status     TEXT    NOT NULL DEFAULT 'draft',
  source     TEXT,                              -- image model id, or 'placeholder'
  created_by INTEGER REFERENCES users(id),
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- R7 (STORY-031) — user feedback on AI-generated content, fed back into the
-- generation process as guidance. Real fine-tuning/RLHF is the swap-in target.
CREATE TABLE IF NOT EXISTS content_feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id INTEGER NOT NULL REFERENCES content(id),
  user_id    INTEGER REFERENCES users(id),
  rating     TEXT    NOT NULL,        -- up | down
  comment    TEXT,
  source     TEXT    NOT NULL DEFAULT 'explicit', -- explicit | implicit (e.g. a rejection)
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- R7 (STORY-030) — user notifications (e.g. "content awaiting your approval").
CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),  -- recipient
  type        TEXT    NOT NULL,      -- e.g. content_approval_pending
  message     TEXT    NOT NULL,
  entity_type TEXT,                  -- content | post | email | recommendation
  entity_id   INTEGER,
  is_read     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, is_read);

-- R6 (STORY-024) — predictive recommendations proposed for adoption.
-- A recommendation is generated by the Analytics Agent, then (when someone wants
-- to act on it) persisted here and HELD for human approval via approval_processes
-- before it is considered accepted. Lifecycle:
--   proposed -> pending_approval -> approved | rejected
CREATE TABLE IF NOT EXISTS predictive_recommendations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER REFERENCES email_campaigns(id),
  type        TEXT    NOT NULL,      -- e.g. improve-subject, clean-list
  message     TEXT    NOT NULL,
  rationale   TEXT,
  priority    TEXT,                  -- low | medium | high
  status      TEXT    NOT NULL DEFAULT 'proposed',
  proposed_by INTEGER REFERENCES users(id),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- R3 (STORY-014) — leads and their engagement-derived score (0–100).
CREATE TABLE IF NOT EXISTS leads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL UNIQUE,
  name       TEXT,
  score      INTEGER NOT NULL DEFAULT 0,   -- 0–100, derived from engagement
  segment    TEXT,                          -- set by segmentation (STORY-015)
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- R3 (STORY-012) — email engagement events (opens/clicks/bounces/etc.).
-- DEV NOTE: in production these arrive via ESP webhooks; the ingest endpoint is
-- the swap-in point. This is telemetry (its own table), distinct from the
-- governance audit_log.
CREATE TABLE IF NOT EXISTS email_engagement_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES email_campaigns(id),
  recipient   TEXT,                              -- recipient email / lead identifier
  event_type  TEXT    NOT NULL,                  -- delivered | open | click | bounce | unsubscribe
  occurred_at TEXT    NOT NULL DEFAULT (datetime('now')),
  details     TEXT
);

-- R5 (STORY-022) — indexes to keep aggregates/queries fast on large datasets.
CREATE INDEX IF NOT EXISTS idx_engagement_campaign ON email_engagement_events (campaign_id);
CREATE INDEX IF NOT EXISTS idx_engagement_recipient ON email_engagement_events (recipient);
CREATE INDEX IF NOT EXISTS idx_engagement_campaign_type ON email_engagement_events (campaign_id, event_type);
CREATE INDEX IF NOT EXISTS idx_leads_score ON leads (score);
CREATE INDEX IF NOT EXISTS idx_leads_segment ON leads (segment);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log (action);
CREATE INDEX IF NOT EXISTS idx_content_status ON content (status);
CREATE INDEX IF NOT EXISTS idx_posts_status ON social_posts (status);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON email_campaigns (status);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approval_processes (status);
