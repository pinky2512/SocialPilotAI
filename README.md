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
npm run seed     # creates 5 role users (password: password123) + a sample campaign
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
> **Message broker:** `server/src/broker/index.js` is an in-process pub/sub bus
> exposing the minimal `publish`/`subscribe` surface RabbitMQ/Kafka also
> provide, so agent code is unaffected by a future swap to a real broker.

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
- ⬜ STORY-015 Segment Audiences Based on Lead Scores

**R4 — Polish** — ⬜ STORY-016…019
**R5 — Launch** — ⬜ STORY-020…023
### Phase 3 — Data, Polish + Hardening — ⬜ STORY-024…035
### Phase 4 — Launch Readiness + Go-Live — ⬜ STORY-036…044
