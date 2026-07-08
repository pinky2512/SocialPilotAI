# Trust Before Intelligence (TBI)

Framework reference: **TBI-2025.12.0** (pinned). Refreshing this snapshot is
approval-gated — do not update the framework version without explicit sign-off.

> ~95% of AI agent projects fail because a clever model gets bolted onto an
> untrustworthy foundation. In this build, trust and governance are built
> **before — or alongside, never after — any AI feature.**

## The five controls

| # | Control | What it is | Where it lives | Status |
|---|---------|------------|----------------|--------|
| 1 | **Audit log** | Append-only record of every meaningful action (who / what / when / before-after) | `server/src/trust/audit.js` + `audit_log` table (UPDATE/DELETE blocked by DB triggers) | ✅ built (R0) |
| 2 | **Approval gate** | High-stakes actions are HELD for a human — "AI proposes, human approves" | `server/src/trust/approvals.js` (generic: content + posts + …) | ✅ built (R0/R1) |
| 3 | **Escalation** | Low-confidence / anomalous actions route to a human instead of auto-executing | (STORY-038) | ⬜ planned |
| 4 | **Trust dashboard** | One screen: system health, pending approvals, recent actions, anomalies | (STORY-025 / STORY-037) | ⬜ planned |
| 5 | **Governance score** | Live 0–100 score (% audited, % approvals honored, failure rate) with fix recommendations | (STORY-026 / STORY-039) | ⬜ planned |

## How the controls are wired in

### 1. Audit log (append-only)
`logAction({ userId, action, details })` is the only sanctioned writer and only
ever `INSERT`s. `audit_log` additionally has `BEFORE UPDATE` / `BEFORE DELETE`
triggers that `RAISE(ABORT, …)` — the append-only invariant cannot be bypassed
even by a buggy query. See `schema.sql`.

### 2. Approval gate
Every gated entity kind (content, social posts, and email campaigns as they
land) shares one hold/approve/reject machinery in `approvals.js`. An item
reaches a live status (`approved` → `published`/`sent`) **only** after a human
decision is recorded in `approval_processes`, and every transition is audited.
Publishing code re-checks the gate at execution time (belt-and-suspenders): e.g.
`publishPost` refuses any post not in status `approved`.

## Agent contract

Agents own exactly one requirement and communicate only via the message broker
(`server/src/broker/index.js`) — never by calling each other's internals. The
Governance and Compliance Agent observes every meaningful command and manages
all approval gates.

## Design rules (enforced in code review)

1. One story at a time; every commit is prefixed with its `STORY-###` id.
2. Real code, not stubs — trust controls are working DB-backed logic.
3. Never relax an approval gate for convenience; add a fixture instead.
4. Never mutate the audit log (INSERT only).
5. Keep the real-LLM / real-integration swap-in points explicit in comments.
