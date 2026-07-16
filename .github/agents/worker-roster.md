# Permanent Worker Roster

This file assigns stable identities, coding scopes, and non-overlap rules to every active or future worker used by Hope.

## Management

- **CHATGPT-M1 — App Manager and Release Controller**
  - Owns issue creation, assignment, PR review, exact-SHA decisions, GitHub/Vercel inspection, revision comments, and release readiness.
  - Does not merge, approve, deploy, or run production migrations automatically.

## Current GLM 5.2 Pro coding workers

- **GLM-A1 — State Truth and AI Runtime Worker**
  - Dashboard/tender workflow truth, analysis authority, compliance state, command-center job isolation, AI/system readiness.
- **GLM-A2 — Matching and Evidence Selection Worker**
  - Matching calibration, hard sector conflicts, no forced irrelevant selection, reviewed evidence eligibility.
- **GLM-X1 — Report, Document, and Export Gate Worker**
  - Source-grounded currency, report authority, document download authorization, PDF/ZIP/final export gates.

## Current ChatGPT coding workers

- **CHATGPT-C1 — Vault Privacy and Provenance Worker**
  - Company review privacy, source redaction, reviewed-record provenance, activity-log data minimization.
- **CHATGPT-C2 — Responsive Navigation and Contract Worker**
  - Responsive shell, route integrity, active navigation, settings/default separation, dead actions, API/UI state contracts.

## Current Jules coding workers

- **JULES-T1 — Notification Bell Accessibility** (Issue #1143, branch `worker/jules-notification-a11y-006-16137658204389118457`)
  - Notification-bell a11y and server-confirmed read state.
- **JULES-U1 — Collapsible Panel Accessibility** (Issue #1144, branch `worker/jules-collapsible-a11y-007`)
  - Collapsible-panel a11y regression coverage (assigned; low priority).
- **JULES-S2 — Secure-Upload Policy Accessibility** (Issue #1145, branch `worker/jules-upload-policy-a11y-008`)
  - Clear stale secure-upload errors after a valid selection; blocking preserved.

## Current Codex coding worker

- **CODEX-D1 — Complex Backend Escalation** (Issue #1156)
  - Race conditions, transaction boundaries, difficult background workers, complex CI failures.
  - **Initial state: read-only architecture planning.** Coding requires a later
    exact-SHA `START_AUTHORIZATION` from CHATGPT-M1. Exactly one Codex worker is
    registered — never multiple Codex lanes.

## Claude Code control worker

- **CLAUDE-I1 — Integration and Control-Tower Worker** (Issue #1148)
  - Release-control workflows and contracts under `.github/**` only. Never edits
    application runtime, Prisma schema/migrations, Vercel config, or package files.

## Fixed worker pool

The pool is fixed at **10 chats**: 3 GLM + 2 ChatGPT + 1 Claude Code + 3 Jules + 1 Codex.

| Chat | Worker | Issue |
| --- | --- | --- |
| GLM #1 | GLM-A1 | #1134 |
| GLM #2 | GLM-A2 | #1135 |
| GLM #3 | GLM-X1 | #1136 |
| ChatGPT #1 | CHATGPT-C1 | #1137 |
| ChatGPT #2 | CHATGPT-C2 | #1138 |
| Claude Code | CLAUDE-I1 | #1148 |
| Jules #1 | JULES-T1 | #1143 |
| Jules #2 | JULES-U1 | #1144 |
| Jules #3 | JULES-S2 | #1145 |
| Codex | CODEX-D1 | #1156 (read-only until START_AUTHORIZATION) |

Independent review is a **role**, not an extra chat: any pool member (or CHATGPT-M1)
may audit an exact diff it did not author. A reviewer never writes code on the
finding it reviews.

## Manager-controlled dependencies (NOT lanes, NOT extra chats)

These cross-cutting critical findings are manager-controlled and planned **through
CODEX-D1 after an exact-SHA START_AUTHORIZATION**. They are tracked as dependencies
in `lane-mapping.json` and are never assigned to a simple worker (Jules) or folded
into a GLM/ChatGPT lane. No eleventh chat is created for them.

- **#1149** — immutable evidence / provenance model.
- **#1151** — company-scoped team membership / tenancy.
- **#1152** — block mixed/fallback proposal persistence.
- **#1153** — bounded deterministic Vault context / Vercel-safe analysis.
- **#1154** — durable private storage / password-reset mail / recovery.
- **#1155** — product-truth analytics/account and integrated screenshot regression (manager residual after core integration).

## Current five-lane ownership

1. `GLM-A1`: dashboard, tender list, analysis, compliance, command center, AI/system readiness.
2. `GLM-A2`: matching UI/API/engine and matching-specific tests.
3. `GLM-X1`: report, documents, export, currency schema/migration, download authorization.
4. `CHATGPT-C1`: company review, vault provenance/redaction, batch-review safeguards, activity presentation.
5. `CHATGPT-C2`: layout/navigation, settings/defaults, responsive route pages, dead links/actions, API/UI contracts.

The controlling GitHub Issue is authoritative when a narrower file list is specified.

## Operating rules

1. One worker owns one finding and one branch.
2. No two coding workers may edit the same file or function concurrently.
3. All application worker PRs target `integration/controlled-recovery`.
4. Infrastructure PRs target `automation/control-plane` or the explicitly declared bootstrap branch.
5. No worker merges, approves, deploys, or runs production migrations.
6. All revision work stays in the same branch and PR.
7. Every persistence-sensitive fix requires executable PostgreSQL assertions.
8. The integration branch is written only by the integrator workflow.
9. Every review is bound to the exact PR head SHA; a moved head invalidates prior acceptance.
10. Browser chats may recheck every five minutes only while their session remains active. Whenever a session resumes, it must first read all issue and PR updates since its last reviewed SHA.
11. A newly added coding tool must be registered in `providers.json`, assigned a stable worker name, given a non-overlapping issue, and report honest waiting/working states.
12. GitHub Issues and linked PR comments are the only task authority; private chat instructions never override a newer GitHub instruction.
