# Controlled Recovery Consolidation Matrix

## Authority

This branch is the single application consolidation candidate created from `sync/main-into-controlled-recovery-20260717` at `14ef4ab81654eb4f23617ae2886222644c15b6ac`.

It is intentionally stacked on PR #1166 until reconciliation is incorporated into `integration/controlled-recovery`. After #1166 merges, this PR must be retargeted to `integration/controlled-recovery`; only the final reviewed integration candidate may later target `main`.

No donor PR is merged blindly. Important code is ported, reconciled, tested, and either accepted, rewritten, or explicitly rejected. A donor's failing check does not automatically disqualify useful code, but no known unsafe or contradictory implementation may become final authority.

## Non-negotiable application invariants

1. Company and role authority is company-scoped and fail-closed.
2. Reviewed evidence authority is immutable/revisioned and bound to protected source bytes.
3. Matching, generation, readiness, document finalization, PDF, ZIP, download, and export consume the same current evidence authority.
4. Partial, stale, fallback, mixed-provider, deterministic-fallback, or provider-exhausted output creates zero authoritative document rows and zero stored bytes.
5. AI analysis input is deterministic, bounded, reproducible, company-scoped, and privacy-safe.
6. Build Plan confirmation and canonical final-package readiness are the only package/export authority.
7. Final artifacts are private, company-owned, actual-byte-integrity verified, current, reviewed, and approved.
8. Public responses and UI never expose secrets, storage paths, provider payloads, raw internal diagnostics, or cross-company information.
9. No false Ready, Clear, 100%, generated, AI, approved, or exportable state may be displayed.
10. Exact-head validation, stock PostgreSQL, authenticated browser proof, migration upgrade proof, and rollback evidence are required before merge.

## PR disposition and incorporation status

| PR | Decision | Consolidation status | Important code preserved | Remaining correction |
|---|---|---|---|---|
| #1171 | PORT / CLOSED AS SUPERSEDED | Incorporated through donor PR #1176; merge commit `f0be0aaee2aad99b3c4aaabe20e3852ea15f62db` | executive canonical metrics, selected-only counts, action deduplication, progressive disclosure | validate against final readiness authority and all viewports |
| #1170 | PRIMARY UI DONOR / CLOSED AS SUPERSEDED | Incorporated through donor PR #1177; merge commit `ad217eff2ee7cc9c23a3c9e7a721d9c1e73d67ae` | provider-registry AI environment reporting, explicit configuration states, responsive renderer, root-link truth | evidence records are not release acceptance; documents reconciled with #1168 |
| #1169 | PORT / CLOSED AS SUPERSEDED | Ported directly at `1b45e47c37347b6ff5090134daba123233524ffe` and `6d52742f859f2d14384e2a0c12f4965fd159d688` | controlled-recovery CI routing, Prisma zero-drift check, regression contract | execute actionlint and stock PostgreSQL workflow on final base |
| #1168 | PORT / CLOSED AS SUPERSEDED | Unique files ported at `c3eb138a3b34347b8433996b16de09871e672a87` and `42e7732b5ffec5874dddc3733e1ddc05cae48f5f` | canonical readiness refresh after review, fail-closed unavailable state, truthful document workspace, focused test | validate browser mutation/refresh behavior against final envelope |
| #1167 | SUPERSEDED / CLOSED | No unique authority after #1170; intentionally not merged | none beyond stronger donor | none |
| #1166 | BASE ONLY / OPEN | Consolidation branch starts from exact reconciliation head `14ef4ab81654eb4f23617ae2886222644c15b6ac` | reconciled current-main tree | validate and merge #1166, then retarget #1175 to `integration/controlled-recovery` |
| #1165 | SUPERSEDED / CLOSED | Replaced by stronger #1170/#1168 combination | no unique application authority | none |
| #1164 | SUPERSEDED / CLOSED | Duplicate UI rejected; temporary matching `take:20` rejected | historical evidence remains in closed PR | use #1139's complete matching design instead |
| #1163 | PORT / CLOSED AS SUPERSEDED | Incorporated through donor PR #1179; merge commit `57e9d46712d8643f6913e978263c5fc1979d0cf5` | exact-head preview-only workflow | review permissions, secrets, fork behavior, and no-production proof |
| #1157 | FOUNDATIONAL SELECTIVE PORT / OPEN | Comparison PR #1180 conflicts; sanitized public envelope hardened at `650102c420a0517467b6dbea20c0eb455ddd0fd4` | public response sanitization, count-invariant protection; remaining Build Plan/route work queued | selectively reconcile confirmed Build Plan and route agreement without overwriting newer files |
| #1146 | PRIVACY DONOR + AUTHORITY REWRITE / OPEN | Comparison PR #1181 conflicts; no force merge | server minimization, pagination, activity redaction, mutation tests remain donor candidates | replace mutable `reviewNotes` authority through #1149 and #1151 before consumer integration |
| #1139 | MATCHING DONOR + AUTHORITY REWRITE / OPEN | Not yet incorporated | conflict rules, score calibration, deterministic pagination, server-truth refresh | remove structural provenance fallback, persist zero-candidate blocker, bound selected UI |
| #1130 | KEEP SEPARATE / OPEN | Not part of application PR | none | control-plane safety and activation remain separate |
| #1128 | EVIDENCE ONLY / OPEN | Not merged | baseline route inventory and gap register | final integrated screenshots must replace baseline proof |

## Missing critical work not supplied by a mergeable donor

| Issue | Required implementation |
|---|---|
| #1151 | company-scoped membership, role, user administration, tenant migration/backfill, and cross-company denial |
| #1149 | immutable/revisioned reviewed-evidence authority and protected source-byte integrity binding |
| #1152 | zero-row/zero-byte fail-closed proposal persistence for partial/fallback/stale/mixed output |
| #1153 | bounded deterministic analysis-input manifest and execution-budget proof |
| #1154 | durable private storage, password-reset mail, backup/restore, and recovery proof |
| #1155 | final analytics, landing/account truth, and integrated 70-route screenshot regression |

## Integration order

1. Reconciliation base verification (#1166).
2. Safe isolated UI/CI ports (#1169, #1170, #1168, #1171, #1163) — substantially incorporated; exact-head validation pending.
3. Company membership authority (#1151).
4. Immutable reviewed-evidence authority (#1149).
5. Vault privacy consumers and review workflow (#1146 safe parts rewritten onto new authority).
6. Matching quality and evidence selection (#1139 safe parts rewritten onto new authority).
7. Canonical final-package readiness and public envelope (#1157 selectively reconciled).
8. Proposal generation zero-write invariant (#1152).
9. Bounded deterministic AI analysis manifest (#1153).
10. Durable private artifacts, mail, and recovery (#1154).
11. Analytics, product copy, account truth, and final responsive cleanup (#1155).
12. Exact integrated release validation and replacement screenshot artifact.

## Validation ledger requirements

Every accepted donor or new implementation must record:

- donor PR and exact donor SHA;
- target commit SHA;
- files/functions accepted;
- files/functions rejected or rewritten;
- overlap resolution;
- focused tests and full integration tests;
- PostgreSQL execution status;
- authenticated browser execution status;
- security/tenant review status;
- rollback or supersession path.

## Current status

`SAFE_DONOR_LAYER_INCORPORATED / CORE_ARCHITECTURE_IN_PROGRESS / DRAFT / DO_NOT_MERGE`

PR #1175 is the only future application merge candidate. Closed donor PRs must not be reopened or merged independently. Open architectural donors remain references until their safe code is reconciled into this branch.