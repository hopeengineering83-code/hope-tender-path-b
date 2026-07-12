# Release Hardening Contract — 14 Phases

Status: ACTIVE. This document is an acceptance contract, not a claim that every phase is complete.

## Non-negotiable product rules

1. Tender controls scope and required outputs.
2. Company Vault is the only factual source for company capability evidence.
3. No invented evidence, projects, staff, credentials, experience, certifications, or financial facts.
4. Anthropic remains last in the provider fallback order.
5. Regex or deterministic fallback is never presented as AI success.
6. Partial, fallback, deadline-skipped, stale, or unbound analysis cannot unlock generation or export.
7. Roles, ownership, tenant boundaries, and supplied relational IDs are verified server-side.
8. Zero GeneratedDocument rows exist before valid extraction, source-grounded requirements, Company Vault evidence, and a current Build Plan are rechecked transactionally.
9. Final ZIP gates fail closed and verify exact persisted bytes.
10. Vercel Git deployment remains disabled during hardening.

## Phase acceptance matrix

| Phase | Required acceptance evidence | Status |
|---|---|---|
| 1. Stabilization | Protected main, policy-compliant branches, all required CI green, no direct release from red CI | IN PROGRESS |
| 2. Canonical architecture | One generation gate, export gate, integrity service, evidence boundary, workflow decision service, and authorization policy | IN PROGRESS |
| 3. AI engine hardening | Provider order contract, content-hash binding, DB concurrency proof, no fallback-as-evidence, partial blocks downstream actions | IN PROGRESS |
| 4. Transaction safety | Executable race tests prove no document row is created after readiness changes; PDF supersede/create and storage use compensation | BLOCKED |
| 5. Company Vault | Versioned assets, ownership, approval, expiry, byte integrity, extraction provenance, and tenant isolation | IN PROGRESS |
| 6. Tender intelligence | Source-grounded extraction, eligibility, risk, gaps, and matching with explicit confidence and provenance | PLANNED |
| 7. Proposal generation | Required document plan drives generation; no unplanned document creation; Word/PDF/ZIP outputs remain gated | IN PROGRESS |
| 8. Document engine | Template fidelity, numbering, TOC, headers/footers, revision history, exact filenames, and deterministic rendering tests | PLANNED |
| 9. Security | RBAC, tenant isolation, secure uploads, rate limits, secret hygiene, audit logging, and cross-user browser tests | IN PROGRESS |
| 10. Testing | Unit, PostgreSQL integration, concurrency, migration, browser, security, PDF, ZIP, and rollback suites execute in CI | IN PROGRESS |
| 11. Performance | Large-file, large-vault, queue, streaming, query, memory, timeout, and load acceptance budgets | PLANNED |
| 12. Enterprise features | Multi-company, branches, users, approvals, history, notifications, reporting, backup, and recovery | PLANNED |
| 13. Engineering quality | Strict TypeScript, bounded modules, structured logs, dependency controls, release notes, and maintainable tests | IN PROGRESS |
| 14. Release certification | Green CI, migration rehearsal, end-to-end golden tender, production smoke test, rollback proof, zero high blockers | BLOCKED |

## Required PR sequence

1. Release-control and contract checks.
2. Merge-safe correction of current release blockers without overlapping open PRs.
3. Canonical integrity and transaction consolidation.
4. Authorization and tenant-isolation coverage.
5. Executable AI concurrency, PDF, and ZIP acceptance.
6. Document-engine quality and template fidelity.
7. Performance and enterprise capabilities.
8. Release certification.

Each PR must be draft initially, avoid unrelated files, state overlap with open PRs, keep Vercel deployment disabled, and must not be merged until its own behavioral acceptance is green.
