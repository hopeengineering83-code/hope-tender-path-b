# PR #1175 Current-Head Audit Restart — 2026-07-27

## Frozen authority

- Governing PR: `#1175`
- Base branch: `integration/controlled-recovery`
- Head branch: `release/consolidated-recovery-20260717`
- Frozen head SHA: `04490a7dda46909a8cda00b4ee7657ed76254576`
- Previous audit SHA: `01aa15406e397facb1d1cd373417641914a02d73`
- Delta from previous freeze: 2 commits, 12 net changed files

This audit is fail-closed. No merge, approval, production deployment, or production migration is authorized by this document.

## Intervening-delta disposition

The current head incorporates these net changes from the earlier audit branch:

1. Revision-bound legal, financial, and compliance review writes.
2. Four audit ledgers.
3. A new `EXTRACT_TEXT` service and handler-dispatch wrapper.
4. `TENDER_FILE_EXTRACTION` audit-action support.
5. A vault-review concurrency test.

The current head does **not** incorporate the request-bounded upload implementations developed later on the closed child branch. Both canonical upload routes still require independent verification for synchronous extraction/OCR.

## Immediate release blockers at the frozen head

### R001 — Main CI is red

GitHub Actions run `30292360317` failed in the unit/database integration step. Build and authenticated Playwright were skipped.

Observed total: 8,872 tests; 8,847 passed; 25 failed across 14 suites.

Primary failure cluster:

- `ai-job-handlers.ts` was changed from the canonical handler implementation into a thin wrapper.
- Multiple load-bearing tests still inspect `ai-job-handlers.ts` for AI analysis, proposal generation, retry, upload orchestration, and extraction authority.
- The implementation now exists partly in `ai-job-handlers-legacy.ts` and partly in `ai-jobs/tender-extraction-service.ts`, creating a split authority and invalidating current release proof.

A separate behavioral failure shows that a terminal `EXTRACT_TEXT_INPUT_INVALID` error is persisted only as `INTERNAL_JOB_ERROR`, losing the expected safe diagnostic category.

### R002 — Request-bound extraction remains open

The incorporated extraction service is a worker implementation, but an implementation is not sufficient evidence that production upload routes enqueue it. Both upload call graphs must be re-traced from the HTTP request through storage, row creation, deterministic job creation, and exact-once analysis continuation.

### R003 — PR description is stale

PR #1175 still declares `01aa15406e...` as the current exact head even though the actual head is `04490a7dda...`. Its verification totals and exact-head preview claims therefore do not describe the current authority SHA.

### R004 — Current-head verification is incomplete

- Screenshot workflow passed.
- Main CI failed.
- One Vercel project status is successful and a separate `Vercel – repo` status is failed.
- Production build, authenticated Playwright, and cross-user isolation did not run in the failed CI job.

## Required audit sequence

1. Inspect both intervening commits and every net changed file.
2. Reconcile canonical handler ownership and remove duplicate/dead authority.
3. Trace both upload routes and prove or repair background extraction enqueueing.
4. Repair behavioral and structural CI failures without weakening the underlying gates.
5. Re-run exact-head CI and inspect retained evidence.
6. Continue the original five-pass audit against the new frozen SHA.

## Status

`IN PROGRESS — NOT MERGEABLE`
