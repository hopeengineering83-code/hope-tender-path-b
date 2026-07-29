# PR #1175 exact-head independent recheck — 2026-07-29

## Frozen live authority

- At the start of the independent recheck, governing PR #1175 was the only open pull request. It remains draft and unmerged and points to `release/consolidated-recovery-20260717` at `272b5823c6e118ac7e56f9c38e8f1b8c959b93d5`.
- Its exact base is `integration/controlled-recovery` at `b3c9db5de89a2a665e61a83facbff0f276f9983c`.
- PR #1274 is closed. Its final head, `0611690b1486402df6fb5431b055b219390517e7`, is an ancestor of the frozen #1175 head.
- The canonical changed-file and unique-code disposition remains `docs/audits/open-pr-unique-code-ledger-20260728.md`; no new product-code donor PR exists to classify.

## Publication reconciliation

- Publishing the independent recheck created documentation-only draft PR #1277 at `42508f13ed99bbbee724436b0c2b1f0514744f27`, one commit ahead of #1175. Its only files are this audit record and the matching `operator_handoff.md` entry; it introduces no product, schema, migration, dependency, test, or workflow-authority code.
- This child branch preserves that complete commit rather than reimplementing or silently discarding it. PR #1277 must remain open until the documentation is incorporated into #1175 and the resulting exact #1175 head is reverified; only then may it be closed with a disposition comment.

## Independently repeated checks

- A clean `npm ci` completed and a tracked-file hash comparison proved that installation did not mutate source.
- `npx prisma validate`, `npx prisma generate`, the release-integrity audit (418 routes and 1,390 files), workflow-state audit, TypeScript, ESLint with `--max-warnings 0`, and a production build with synthetic local build-only configuration passed.
- The production build's tracked-file hash comparison proved that the build did not mutate source.
- A local PostgreSQL-enabled full-suite attempt was stopped after the configured remote Neon test database was unreachable. No migration was run against that remote database. Exact-head GitHub CI remains the disposable-PostgreSQL authority for migration and integration proof.

## Exact-head GitHub and preview proof

- Exact-head workflow runs `30471518423`, `30471523601`, and `30471524083` report success for `272b5823c6e118ac7e56f9c38e8f1b8c959b93d5`.
- Their retained evidence reports 43 disposable-database migrations, idempotency and drift checks, 8,930 passing tests, a successful build, 178 passing Playwright tests with four environment-conditional skips, and 111/111 screenshot route/viewport combinations without overflow findings.
- The Git-triggered `hope-tender-path-b` preview deployment is successful. Live `/api/version` and `/api/health` returned HTTP 200 and identified the exact frozen SHA; health reported durable private Blob storage and required critical tables.
- The duplicate `repo` Vercel project deployment still reports failure.

## Release disposition

No new product defect or unincorporated open-PR code was found in this recheck, so the frozen #1175 product head was not modified. Release completion is not claimed. Synthetic persisted artifact proof is retained by the exact-head workflow, but approved synthetic preview credentials and Vercel log access were unavailable for an independently repeated provider-backed persisted preview workflow and runtime-log audit.

The external holds in #1175 remain mandatory: rotate the exposed real password, revoke sessions, replace the affected automation secret, sanitize credential-bearing artifacts, complete owner UAT, resolve the duplicate failing Vercel project, obtain authorized synthetic preview acceptance credentials, and complete a compatible dependency remediation for remaining advisories. Keep #1175 draft and unmerged.

## 2026-07-29 live-authority refresh

- GitHub was refetched after the preceding recheck. PR #1175 is the only open
  pull request, remains draft and unmerged, and points to
  `0340de8830568cce42c8f52e411924ff273be7e7`. The closed #1274 head
  `0611690b1486402df6fb5431b055b219390517e7` is its ancestor by nine commits.
- Exact-head GitHub runs `30475698923`, `30475699219`, and `30475699011` are
  successful. Their retained artifacts report 8,930/8,930 unit/PostgreSQL
  assertions, 178 passed and four environment-conditional skipped Playwright
  assertions, and 111/111 screenshot route/viewport combinations without a
  critical finding, warning, uncovered route, or horizontal overflow.
- The Git-triggered preview `dpl_3GL39CC25cjZFT8oMwMcN6ubfSoi` is `READY` and
  identifies exact SHA `0340de8830568cce42c8f52e411924ff273be7e7`.
  `/api/version` and `/api/health` returned HTTP 200; health reported the five
  critical tables and durable private Blob storage ready.
- Vercel retained-log access is now available. A deployment-scoped 24-hour
  query returned 12 request-log records and no `error`, `fatal`, HTTP 500,
  `P2022`, `P2002`, raw Prisma, timeout, stuck-job, or duplicate-job match.
  This supersedes only the earlier *log-access unavailable* statement; it does
  not substitute for an authenticated persisted workflow capable of producing
  representative runtime logs.
- No approved synthetic preview account credential is present in this
  environment. The provider-backed persisted preview workflow therefore
  remains unexecuted, and real-account credentials remain prohibited while the
  rotation/session-revocation hold is active.
- The duplicate `repo` Vercel project still fails for this exact commit. It is
  an external project-configuration blocker, not a code change to hide in this
  branch.

This refresh found no new product-code donor and no evidence supporting a gate
weakened or a production change. Release completion is still not claimed.
