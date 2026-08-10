# Social Pilot AI — Colaberry Build

An AI-driven marketing automation platform that helps marketing teams automate
repetitive work — content generation, social media posting, email campaigns,
lead scoring, and predictive analytics — while keeping a human in control of
every AI-generated action before it goes live.

## Why this project exists

Marketing teams juggle multiple platforms, content creation, and performance
analysis, often with tools that automate too little or provide too little
oversight. Social Pilot AI unifies these workflows into a single platform
that automates the repetitive work, surfaces real-time insight, and — most
importantly — never lets an AI action publish itself without a human
approving it first.

## Design principle: Trust Before Intelligence

Before any AI feature ships, the trust and governance foundation for it must
already be in place. Every AI agent in this system is built on top of:

- **Audit log** — every meaningful action (human or AI) is recorded, append-only.
- **Approval gate** — high-stakes actions (publishing content, sending email,
  posting to social) are held for a human to approve before they go live.
- **Escalation** — low-confidence AI decisions are routed to a human instead
  of being auto-executed.
- **Trust dashboard** — one view of system health, pending approvals, recent
  actions, and anomalies.
- **Governance score** — a live score reflecting how well the system is
  honoring its own governance rules.

See `docs/trust-before-intelligence.md` *(added when R2 begins)* for the full
framework this build follows.

## Architecture

| Layer | Technology |
|---|---|
| Frontend | React.js |
| Backend | Node.js + Express |
| Database | PostgreSQL |
| AI coordination | Task scheduler + approval workflow engine, agents communicating over a message broker (RabbitMQ/Kafka) |
| Deployment | Docker, CI/CD via GitHub Actions, AWS/Azure, Terraform |

### Multi-agent system

Each requirement is owned by exactly one agent. A separate Governance agent
observes every command across the system.

| Agent | Owns | Approval gate |
|---|---|---|
| Content Generation Agent | Drafting content | Held for human approval before publishing |
| Social Media Posting Agent | Scheduling/publishing posts | Held for human approval before publishing |
| Email Campaign Agent | Email campaigns | Held for human approval before sending |
| Lead Scoring Agent | Lead scores, audience segments | — |
| Analytics Agent | Predictive insights, dashboards | — |
| Governance and Compliance Agent | Approvals, audit log, data privacy requests | Manages all approval gates |
| Security and Access Control Agent | Roles and permissions | — |
| Trust and Governance Coordinator | Cross-agent monitoring | Monitors all trust metrics |

## Repo structure

```
server/                     Node.js + Express backend
  src/
    db/                     node:sqlite data layer, schema, seed
    trust/                  Trust-Before-Intelligence controls (audit, approvals)
    broker/                 Message-broker abstraction (swap for RabbitMQ/Kafka)
    agents/                 One module per agent in the multi-agent map
    auth/                   Roles + password hashing
    http/                   Request middleware (current user)
    routes/                 Express routers
    app.js / server.js      App wiring + entrypoint
  test/                     node:test suites, one file per story
client/                     React frontend (Vite)
  src/
    pages/                  Content Studio, Approval Queue
    api.js / session.jsx    API client + acting-user session
```

### Running locally

```bash
cd server
npm install
npm run seed     # creates 2 role users (password: password123) + a sample campaign
                 #   Casey Manager (campaign_manager) · Alex Admin (administrator)
npm start        # http://localhost:4000
npm test         # runs the per-story acceptance tests
```

```bash
cd client
npm install
npm run dev      # http://localhost:5173 (proxies /api to the backend on :4000)
```

> **Dev database:** the app uses Node's built-in `node:sqlite` (file-backed, no
> external service) so it runs and is testable with zero setup. The schema
> mirrors the intended PostgreSQL schema 1:1; `server/src/db/index.js` is the
> single seam to swap to `pg` for production.
>
> **Real AI content (pluggable provider):** content generation calls a real LLM
> when one is configured (see `server/src/agents/llm.js`); otherwise it falls
> back to the template generator, so the app still runs and tests stay hermetic.
> Provider is chosen by `LLM_PROVIDER` (default `anthropic`):
> ```bash
> # PowerShell — Claude (default)
> $env:ANTHROPIC_API_KEY = "sk-ant-..."      # model: claude-opus-5 (override: CONTENT_MODEL)
> npm start
>
> # OpenAI-compatible (OpenAI, OpenRouter, Groq, Mistral, Ollama, …)
> $env:LLM_PROVIDER   = "openai"
> $env:OPENAI_API_KEY = "sk-..."
> $env:OPENAI_BASE_URL = "https://api.openai.com/v1"  # or your provider's endpoint
> $env:OPENAI_MODEL    = "gpt-4o-mini"                # or any model the endpoint serves
> npm start
> ```
> The audit log records which model produced each draft (`details.source`).
>
> **Message broker:** `server/src/broker/index.js` is an in-process pub/sub bus
> exposing the minimal `publish`/`subscribe` surface RabbitMQ/Kafka also
> provide, so agent code is unaffected by a future swap to a real broker.

### Extensions (beyond the 44 tracked stories)

- **AI image generation + upload** — generate marketing images from a prompt via
  the OpenAI Images API (`OPENAI_API_KEY`, model `gpt-image-1` by default,
  override with `OPENAI_IMAGE_MODEL`); a placeholder SVG is produced when no key
  is set. For a **new product you can't generate**, you can **upload a photo**
  instead (optional). Images are **held for human approval** before use (same gate
  as text) and every generation/upload is audited.
- **Document-grounded generation** — upload a product brief / spec sheet
  (**PDF** via `pdf-parse`, or text/Markdown) on Content Studio; the text is
  extracted and passed to the LLM with a "use only these facts, don't invent"
  instruction, so copy for a **brand-new product** the model has never seen is
  factually grounded. The grounding document is recorded in the audit trail.
- **Combined text + image posts** — a scheduled social post can carry an
  **attached image** (`social_posts.image_id`), so text and image schedule and
  publish to the accounts together; thumbnails show in the scheduler, posts list,
  and Approval Queue.

## Progress log

Legend: ✅ Done · 🚧 In progress · ⬜ Not started

### Phase 1 — Foundation

**R0 — Walking Skeleton**
- ✅ STORY-001 AI-Driven Content Draft Generation — Content Generation Agent produces a draft (status `draft`, never auto-published), writes an append-only audit entry, and tracks the run in `ai_agent_tasks`.
- ✅ STORY-002 Content Draft Approval Workflow — Governance Agent submits drafts into the approval gate and records human approve/reject decisions; content can only reach `approved` through `approval_processes`, and every transition is audited.
- ✅ STORY-003 Seamless Content Editing Interface — React Content Studio to generate, inline-edit, and submit drafts, plus an Approval Queue view; editing records before/after in the audit log and an edited-after-submit draft returns to `draft` (re-approval required).

**R1 — Core Build**
- ✅ STORY-004 Connect Social Media Accounts — Social Media Posting Agent connects/lists/disconnects accounts across supported platforms; every attempt logged to `integration_logs` + audit log (explicit OAuth swap-in point).
- ✅ STORY-005 Schedule Multi-Platform Posts — `schedulePost` creates one post per target account (text adapted per platform) and holds each at the post-approval gate; nothing publishes without human sign-off. The approval gate is now generic (content + posts).
- ✅ STORY-006 Handle Platform-Specific Nuances — per-platform adaptation (char limits, hashtag caps, non-clickable-link handling) + a validator; preview endpoint shows how a draft renders on each platform before scheduling.
- ✅ STORY-007 Post to Multiple Platforms — `publishPost`/`publishDuePosts` publish only APPROVED posts (gate enforced at publish time), simulate the platform API (swap-in point), and log success/failure to `integration_logs` + audit log. Social page added to the UI.
**R2 — Reliability & Trust**
- ✅ STORY-008 Approval Workflow for Social Media Posts — Governance-owned post-approval workflow: submit/re-submit, revise rejected posts, approve/reject; a post never publishes without approval. `docs/trust-before-intelligence.md` added.
- ✅ STORY-009 Audit Log for Social Media Actions — queryable, read-only audit trail (filter by action/prefix/user; per-post & per-content trails). Every social action is recorded append-only; log remains immutable.
- ✅ STORY-010 Role-Based Access Control for Social Media Features — Security & Access Control Agent enforces a role→permission matrix on every social route (connect/schedule/publish/view); denied attempts return 403 and are recorded as `access.denied` in the audit log. UI gates buttons by permission (`/api/me`).
- ✅ STORY-011 Create and Schedule Email Campaign — Email Campaign Agent creates drafts, schedules them (held at the approval gate), and sends **only approved** campaigns (gate enforced at send time); simulated ESP send with an explicit swap-in point; RBAC-gated + audited. **Completes R2 → Phase 1 sign-off gate.**

### Phase 2 — Core + Reliability

**R3 — Data & Export**
- ✅ STORY-012 Track Email Engagement Metrics — Analytics Agent ingests engagement events (opens/clicks/bounces/etc.; ESP-webhook swap-in point) and computes per-campaign metrics (counts + open/click/bounce rates, unique vs total).
- ✅ STORY-013 Visualize Email Engagement Metrics — Analytics page with per-campaign KPI tiles (delivered/opens/clicks/bounces) and accessible labeled meter bars for open/click/bounce/unsubscribe rates; includes a "simulate engagement" helper for demos.
- ✅ STORY-014 Assign Lead Scores Based on Engagement Data — Lead Scoring Agent derives a 0–100 score from weighted engagement (open/click/bounce/unsubscribe), clamped, upserted per lead, and audited (before/after). Explicit swap-in point for an ML model.
- ✅ STORY-015 Segment Audiences Based on Lead Scores — `segmentAudience` buckets leads into hot/warm/cold/dormant by score band, returns per-segment counts, and audits the summary; leads can be listed per segment for targeting. Audience UI added. **Completes R3.**

**R4 — Polish**
- ✅ STORY-016 Update Lead Scores in Real-Time — Lead Scoring Agent subscribes to `newCampaignData` on the broker and re-scores the affected lead immediately on each engagement event (enabled at server boot; opt-in so tests stay isolated).
- ✅ STORY-017 Predictive Analytics for Campaign Performance — Analytics Agent forecasts final open/click rates by blending observed engagement with a historical baseline (weighted by sample size), with confidence tiers and projected totals; explicit ML swap-in point.
- ✅ STORY-018 Real-Time Metrics Dashboard — `updateDashboard` aggregate (totals, overall rates, per-campaign actuals + forecast) + a live Dashboard page that polls every 5s so metrics update in real time as engagement arrives.
- ✅ STORY-019 Recommendations for Optimizing Future Campaigns — Analytics Agent generates prioritized, rationale-backed recommendations from metrics vs baseline (improve-subject, strengthen-CTA, clean-list, reduce-frequency, replicate, on-track); shown on the Dashboard. **Completes R4.**
**R5 — Launch**
- ✅ STORY-020 Unified Dashboard for Campaign Metrics — single cross-channel overview (content, social, email, engagement, leads, pending approvals) via `unifiedOverview`; shown as a Unified Overview panel on the Dashboard.
- ✅ STORY-021 Latency Optimization for Real-Time Dashboard — short-TTL cache for dashboard/overview aggregates, invalidated on new engagement (stays real-time-correct); `X-Cache` and `X-Response-Time` headers for observability.
- ✅ STORY-022 Handling Large Datasets in Real-Time Dashboard — DB indexes on hot columns, DB-side aggregation (GROUP BY, not in-memory), and limit/offset pagination with totals on leads + audit endpoints; verified correct over multi-thousand-row event sets.
- ✅ STORY-023 Audit Logging for Predictive Analytics — explicit predictive-insight and recommendation requests are recorded in the append-only audit log (with actor + result); dashboard polling is deliberately not audited to avoid log flooding. **Completes R5 → Phase 2 sign-off gate.**
### Phase 3 — Data, Polish + Hardening

**R6**
- ✅ STORY-024 Approval Gate for Predictive Recommendations — a generated recommendation can be *proposed for adoption*; it is persisted and HELD at the approval gate (`kind=recommendation` in the unified queue) and only reaches `approved` after a human decision. Dashboard "Propose for approval" button; nothing is auto-adopted.
- ✅ STORY-025 Trust Dashboard for System Health Monitoring — Trust & Governance Coordinator's `monitorSystemHealth` snapshot (health status + task failure rate, pending approvals, recent actions, and anomalies: failed tasks / access denials / integration + broker errors); live-polling **Trust** page. (TBI control #4.)
- ✅ STORY-026 Governance Score for Predictive Analytics — live 0–100 score from % audited · % approvals honored · analytics failure rate, with fix recommendations below a 70 threshold; shown as a score panel with meters on the Dashboard. (TBI control #5.)
- ✅ STORY-027 Role-Based Access Control for Analytics Features — analytics routes gated by a method-aware guard: reads require `analytics:view` (both roles), writing engagement telemetry requires `analytics:ingest` (Administrator only); manager writes return 403 and are audited. UI hides the ingest action for non-admins. **Completes R6.**

**R7**
- ✅ STORY-028 Explainability for Predictive Analytics — every forecast carries an explanation (method/formula, blend weight, factors, summary); expandable "Why this prediction?" in the UI.
- ✅ STORY-029 Human Approval Gates for AI-Generated Content — content records its source (LLM/template/human); `publishContent` is approved-only, so AI content can't go live without a human approval. Resilient additive migrations.
- ✅ STORY-030 Notify Users of Pending Content Approvals — submitting content notifies the approver(s); per-user inbox with unread count + a top-bar bell.
- ✅ STORY-031 Incorporate User Feedback into AI Learning — 👍/👎 feedback on content (rejections count as implicit negative signal); `feedbackSummary` derives guidance from recent negative comments and injects it into future LLM generation (swap-in point for real fine-tuning/RLHF). **Completes R7.**
**R8**
- ✅ STORY-032 Log All Actions in an Append-Only Audit Log — the append-only log (DB-trigger enforced) is now also **tamper-evident**: every entry is hash-chained to the previous (`prev_hash` + SHA-256 `hash`), and `GET /api/audit/verify` recomputes the chain to detect any alteration/reorder. Audit Log page shows a "🔒 chain verified" badge.
- ⬜ STORY-033 GDPR/CCPA Data Deletion & Export · ⬜ STORY-034 Privacy/ToS · ⬜ STORY-035 Efficient Export
### Phase 4 — Launch Readiness + Go-Live — ⬜ STORY-036…044
