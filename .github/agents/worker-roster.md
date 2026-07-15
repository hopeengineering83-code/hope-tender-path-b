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

## Standby workers

- **JULES-T1 — Test Expansion Worker**
  - Negative tests, PostgreSQL assertions, release-gate coverage.
- **JULES-U1 — UI and Document Workflow Worker**
  - Broad UI scans and slower presentation repairs.
- **JULES-S2 — Security Regression Worker**
  - Cross-user and cross-company regression suites.
- **CODEX-C1 — Complex Backend Escalation**
  - Race conditions, transaction boundaries, difficult background workers, complex CI failures.
- **CLAUDE-I1 — Integration and Conflict Resolution**
  - Cross-file architecture, semantic conflicts, combined-branch regression repair.
- **GLM-R1 / CHATGPT-R1 — Independent Review Workers**
  - Review-only. Audit exact diffs and tests. They never write code on the reviewed finding.

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
