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
