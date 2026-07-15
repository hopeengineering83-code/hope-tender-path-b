# Permanent Worker Roster

This file assigns stable identities and scopes to every coding and review chat used by Hope.

## Management

- **CHATGPT-M1 — App Manager and Release Controller**
  - Owns issue creation, assignment, PR review, exact-SHA decisions, GitHub/Vercel inspection, and release readiness.
  - Does not merge, approve, or deploy automatically.

## GLM 5.2 Pro workers

- **GLM-A1 — AI Analyze Worker**
  - Upload, extraction, analysis state, stale-hash, provider output validation.
- **GLM-A2 — Generation and Fallback Worker**
  - Proposal generation, fallback provenance, GeneratedDocument gates.
- **GLM-S1 — Security and Ownership Worker**
  - Roles, tenant isolation, company ownership, session boundaries.
- **GLM-D1 — Database and Migration Worker**
  - PostgreSQL integration tests, Prisma, migrations, transactions.
- **GLM-X1 — PDF, ZIP, and Export Worker**
  - Finalization, PDF, ZIP, manifest, byte integrity, export gates.
- **GLM-R1 — Independent Reviewer**
  - Review-only. Audits diffs, tests, stale assumptions, and overlap. Does not write code.

## Jules workers

- **JULES-T1 — Test Expansion Worker**
  - Negative tests, PostgreSQL assertions, release-gate coverage.
- **JULES-U1 — UI and Document Workflow Worker**
  - Upload UI, workflow states, document experience, non-runtime presentation defects.
- **JULES-S2 — Security Regression Worker**
  - Cross-user and cross-company regression suites.

## Escalation workers

- **CODEX-C1 — Complex Backend Escalation**
  - Race conditions, transaction boundaries, difficult background workers, complex CI failures.
- **CLAUDE-I1 — Integration and Conflict Resolution**
  - Cross-file architecture, semantic conflicts, combined-branch regression repair.

## Operating rules

1. One worker owns one finding.
2. No two coding workers may edit the same function at the same time.
3. All worker PRs target `integration/controlled-recovery`.
4. Infrastructure PRs target `automation/control-plane`.
5. No worker merges, approves, deploys, or runs production migrations.
6. All revision work stays in the same PR.
7. Every persistence-sensitive fix requires executable database assertions.
8. The integration branch is written only by the integrator workflow.
