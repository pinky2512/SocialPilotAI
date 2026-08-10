// Legal documents — REQ-010 (Governance and Compliance Agent).
//
// STORY-034: the Privacy Policy and Terms of Service shown to users. Kept
// server-side and versioned so governance owns the canonical text.

export const LEGAL = Object.freeze({
  version: '1.0',
  updatedAt: '2026-08-01',
  privacyPolicy: `# Privacy Policy

**Last updated: 2026-08-01 (v1.0)**

Social Pilot AI helps marketing teams create and manage campaigns with AI
assistance and human oversight. This policy explains what we collect and how it
is used.

## What we collect
- **Account data** — your name, email, and role.
- **Content you create** — drafts, posts, email campaigns, and uploaded product
  documents and images.
- **Engagement data** — email opens, clicks, bounces, and unsubscribes tied to a
  recipient identifier, used to compute analytics and lead scores.

## How we use it
- To generate, schedule, and (after human approval) publish marketing content.
- To produce analytics, predictive insights, and audience segments.
- To operate governance controls: an append-only audit log, human approval
  gates, and access control.

## Human oversight
No AI-generated action is published without a human approving it first. AI
outputs are drafts until a person reviews and approves them.

## Your rights (GDPR / CCPA)
You may request an **export** of the personal data we hold about you, or its
**erasure**. On erasure we anonymize your records; our append-only audit log is
retained as a compliance record but stores only a non-identifying hash of the
subject, so erasure does not re-introduce your personal data.

## Retention & security
Data is retained while your account or campaign is active. Data is protected in
transit and at rest, and every meaningful action is recorded in a tamper-evident
audit log.

## Contact
Requests and questions: privacy@socialpilot.ai`,

  termsOfService: `# Terms of Service

**Last updated: 2026-08-01 (v1.0)**

By using Social Pilot AI you agree to these terms.

## Acceptable use
- Use the platform only for lawful marketing activities.
- Do not upload content you do not have the rights to use.
- Do not use the platform to send spam or violate the policies of connected
  social or email platforms.

## AI-generated content
AI features produce **drafts**. You are responsible for reviewing, approving,
and the final published result. AI output may contain errors — the human
approval gate exists for this reason, and approval is required before anything
goes live.

## Accounts & access
Access is governed by roles. You are responsible for actions taken under your
account.

## Availability & warranty
The service is provided "as is" without warranty. We aim for high availability
but do not guarantee uninterrupted service.

## Changes
We may update these terms; the current version and date are shown above.

## Contact
legal@socialpilot.ai`,
});

export function getLegal() {
  return LEGAL;
}
