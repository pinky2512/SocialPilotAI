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
- ⬜ STORY-005 Schedule Multi-Platform Posts
- ⬜ STORY-006 Handle Platform-Specific Nuances
- ⬜ STORY-007 Post to Multiple Platforms
**R2 — Reliability & Trust** — ⬜ STORY-008…011

### Phase 2 — Core + Reliability — ⬜ STORY-012…023
### Phase 3 — Data, Polish + Hardening — ⬜ STORY-024…035
### Phase 4 — Launch Readiness + Go-Live — ⬜ STORY-036…044
