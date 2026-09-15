# Controlled Recovery Consolidation Matrix

## Authority

`release/consolidated-recovery-20260717` is the single application consolidation branch. It was created from the exact reconciliation head `14ef4ab81654eb4f23617ae2886222644c15b6ac`, which already contains the current `main` tree plus the reviewed `integration/controlled-recovery` history.

PR #1175 now targets `integration/controlled-recovery` directly. PR #1166 is therefore preserved in #1175 ancestry and is superseded as a separate merge path.

No donor PR is merged blindly. Important code is ported, reconciled, tested, and either accepted, rewritten, or explicitly rejected. A failing donor check does not automatically disqualify useful code, but no known unsafe or contradictory implementation may become final authority.

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
| #1174 | PORT / CLOSED | Exact Review Board page and test preserved at `fd554925915273e6434ed8b96cf0b92043c193f0` | deterministic Blocked / Review required / Ready / Unavailable presentation | execute authenticated state and viewport tests |
| #1173 | PORT / CLOSED | Exact History page and test preserved at `16a5cfe3e7369ddd040ae34755f7a57d34f78757` | canonical statuses, responsive cards, filter/search preservation | execute authenticated responsive tests |
| #1172 | SELECTIVE PORT / CLOSED | Forty-three unique files preserved at `95a49834d8ea2c2b3dab35b19ad9a287f7ae51e6`; six overlapping files rejected | SVG icons, overflow fixes, navigation, readiness/export parity, focused/e2e tests | validate imported files with stronger consolidated overlap owners |
| #1171 | PORT / CLOSED | Incorporated through donor PR #1176; merge commit `f0be0aaee2aad99b3c4aaabe20e3852ea15f62db` | executive canonical metrics, selected-only counts, action deduplication, progressive disclosure | validate against final readiness authority and all viewports |
| #1170 | PRIMARY UI DONOR / CLOSED | Incorporated through donor PR #1177; merge commit `ad217eff2ee7cc9c23a3c9e7a721d9c1e73d67ae` | provider-registry AI environment reporting, explicit configuration states, responsive renderer, root-link truth | documents reconciled with #1168; exact-head tests pending |
| #1169 | PORT / CLOSED | Ported at `1b45e47c37347b6ff5090134daba123233524ffe` and `6d52742f859f2d14384e2a0c12f4965fd159d688` | controlled-recovery CI routing, Prisma zero-drift check, regression contract | execute actionlint and stock PostgreSQL workflow |
| #1168 | PORT / CLOSED | Unique files ported at `c3eb138a3b34347b8433996b16de09871e672a87` and `42e7732b5ffec5874dddc3733e1ddc05cae48f5f` | canonical readiness refresh after review, fail-closed unavailable state, truthful document workspace | validate browser mutation/refresh behavior against final envelope |
| #1167 | SUPERSEDED / CLOSED | No unique authority after #1170 | none beyond stronger donor | none |
| #1166 | RECONCILIATION ANCESTRY / SUPERSEDE | Exact head `14ef4ab81654eb4f23617ae2886222644c15b6ac` is an ancestor of #1175 | reconciled current-main and controlled-recovery histories | close separate PR after recording supersession |
| #1165 | SUPERSEDED / CLOSED | Replaced by stronger #1170/#1168 combination | no unique application authority | none |
| #1164 | SUPERSEDED / CLOSED | Duplicate UI rejected; temporary matching `take:20` rejected | historical evidence remains in closed PR | use preserved #1139 matching subsystem |
| #1163 | PORT / CLOSED | Incorporated through donor PR #1179; merge commit `57e9d46712d8643f6913e978263c5fc1979d0cf5` | exact-head preview-only workflow | preview currently fails at Vercel configuration pull; repair credentials/config contract |
| #1157 | FOUNDATIONAL SELECTIVE PORT / OPEN | Public envelope hardened at `650102c420a0517467b6dbea20c0eb455ddd0fd4`; comparison #1180 conflicts | public response sanitization and count-invariant protection | preserve confirmed Build Plan and route agreement without overwriting newer code |
| #1146 | PRIVACY DONOR / CLOSED | Exact 14-file donor tree preserved at `268aa04f21ea0cbddc63504927252ebd6c975488` | server minimization, pagination, activity redaction, field-mutation checks, focused/Postgres tests | replace mutable `reviewNotes` authority through #1149/#1151 |
| #1139 | MATCHING DONOR / CLOSED | Exact eight-file donor tree preserved at `e8cf853f47d38b8cab4047403a137e3d9278f714` | conflict rules, score calibration, deterministic pagination, server-truth refresh | remove structural provenance fallback, persist zero-candidate blocker, bound selected UI |
| #1130 | KEEP SEPARATE / OPEN | Not part of application PR | control-plane history remains separate | resolve safety/activation requirements independently |
| #1128 | EVIDENCE ONLY / OPEN | Not merged | baseline route inventory and gap register | final integrated screenshot evidence must replace baseline proof |

## Missing critical work not supplied by a final donor

| Issue | Required implementation |
|---|---|
| #1151 | company-scoped membership, role, user administration, tenant migration/backfill, and cross-company denial |
| #1149 | immutable/revisioned reviewed-evidence authority and protected source-byte integrity binding |
| #1152 | zero-row/zero-byte fail-closed proposal persistence for partial/fallback/stale/mixed output |
| #1153 | bounded deterministic analysis-input manifest and execution-budget proof |
| #1154 | durable private storage, password-reset mail, backup/restore, and recovery proof |
| #1155 | final analytics, landing/account truth, and integrated 70-route screenshot regression |

## Remaining integration order

1. Execute exact-head CI and resolve donor integration failures.
2. Complete selective #1157 confirmed Build Plan and route-authority reconciliation.
3. Implement company membership authority (#1151).
4. Implement immutable reviewed-evidence authority (#1149).
5. Rewire preserved Vault and matching consumers to the new authority.
6. Implement proposal generation zero-write invariant (#1152).
7. Implement bounded deterministic AI analysis manifest (#1153).
8. Implement durable private artifacts, mail, backup and recovery (#1154).
9. Complete analytics, product copy, account truth and final responsive cleanup (#1155).
10. Run exact integrated release validation and replacement screenshot artifact.

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

## Current validation truth

- PR #1175 remains draft and must not merge.
- Full exact-head CI has not yet been proven green.
- Vercel Preview run `29595794316` failed at `Pull Vercel preview configuration`; no preview build or deployment occurred.
- No production deployment or production migration has been authorized or performed.

## Current status

`ALL OPEN APPLICATION DONORS ACCOUNTED FOR / CORE ARCHITECTURE IN PROGRESS / DRAFT / DO NOT MERGE`

PR #1175 is the only future application merge candidate. Closed donor PRs must not be reopened or merged independently.