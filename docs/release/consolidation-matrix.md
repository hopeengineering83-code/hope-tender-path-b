# Controlled Recovery Consolidation Matrix

## Authority

This branch is the single application consolidation candidate created from `sync/main-into-controlled-recovery-20260717` at `14ef4ab81654eb4f23617ae2886222644c15b6ac`.

It is intentionally stacked on PR #1166 until reconciliation is incorporated into `integration/controlled-recovery`. After #1166 merges, this PR must be retargeted to `integration/controlled-recovery`; only the final reviewed integration candidate may later target `main`.

No donor PR is merged wholesale. Important code is ported, reconciled, tested, and either accepted, rewritten, or explicitly rejected. A donor's failing check does not automatically disqualify useful code, but no known unsafe or contradictory implementation may become final authority.

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

## Open PR disposition

| PR | Role | Decision | Important code to preserve | Known problem to correct |
|---|---|---|---|---|
| #1171 | Executive truth and workspace density | PORT | canonical executive metrics, selected-only match metrics, action deduplication, progressive disclosure | validate against final canonical readiness service and all viewports |
| #1170 | AI environment readiness and copy | PRIMARY UI DONOR | provider-registry-derived variables, explicit configuration states, accessible responsive renderer, root-link truth | reconcile documents page with #1168; remove unverifiable evidence claims |
| #1169 | Controlled-recovery CI | PORT | CI routing and Prisma zero-drift check | validate workflow syntax and exact command behavior |
| #1168 | Document state truth | PORT | canonical readiness refresh after review, fail-closed readiness-unavailable state, proposal-document naming | reconcile with #1170 copy and final server envelope |
| #1167 | Earlier AI-readiness/404 repair | SUPERSEDE AFTER HARVEST | runtime-status explanatory wording if still unique | duplicated by #1170 |
| #1166 | Main-to-integration reconciliation | BASE ONLY | exact reconciled tree | do not mix application repair into the reconciliation PR |
| #1165 | Earlier post-merge UI repair | SUPERSEDE | no unique application authority expected after #1170/#1168 | older base and duplicated files |
| #1164 | Screenshot stopgaps | SUPERSEDE AFTER REVIEW | only any unique tests or wording | temporary matching `take` is not authoritative; duplicated UI files |
| #1163 | Preview workflow | PORT WITH SECURITY REVIEW | exact-head preview deployment and stable PR comment | permissions, secret handling, fork behavior, and no-production proof |
| #1157 | Canonical readiness | FOUNDATIONAL REWRITE/PORT | public readiness envelope, confirmed Build Plan, route agreement, count invariants | old base, non-mergeable, DB suite not accepted; reconcile with newer route behavior |
| #1146 | Vault privacy/provenance | PRIVACY DONOR + AUTHORITY REWRITE | server minimization, pagination, activity redaction, field mutation detection, review DTOs | mutable `reviewNotes` cannot remain authority; requires #1149 and #1151 architecture |
| #1139 | Matching | MATCHING DONOR + AUTHORITY REWRITE | conflict rules, score calibration, deterministic pagination, server-truth refresh | structural provenance fallback must be removed; persist zero-candidate blocker; bounded selected UI |
| #1130 | Control Tower | KEEP SEPARATE | none in this application PR | draft/inactive infrastructure with unresolved safety corrections |
| #1128 | Screenshot baseline | EVIDENCE ONLY | route inventory and original gap register | never merge temporary capture workflow as application repair |

## Missing critical work not supplied by any open PR

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
2. Safe isolated UI/CI ports (#1169, #1170 excluding documents, #1168, #1171, reviewed #1163).
3. Company membership authority (#1151).
4. Immutable reviewed-evidence authority (#1149).
5. Vault privacy consumers and review workflow (#1146 safe parts rewritten onto new authority).
6. Matching quality and evidence selection (#1139 safe parts rewritten onto new authority).
7. Canonical final-package readiness and public envelope (#1157 reconciled).
8. Proposal generation zero-write invariant (#1152).
9. Bounded deterministic AI analysis manifest (#1153).
10. Durable private artifacts, mail, and recovery (#1154).
11. Documents, executive truth, analytics, product copy, and final responsive cleanup (#1168, #1171, #1155).
12. Exact integrated release validation and replacement screenshot artifact.

## Validation ledger

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

`CONSOLIDATION_STARTED / DRAFT / DO_NOT_MERGE`

The branch currently establishes ownership and disposition only. Code ports must be committed in dependency order and the matrix updated after each accepted change.