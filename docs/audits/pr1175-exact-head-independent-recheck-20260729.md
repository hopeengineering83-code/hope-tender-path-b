# PR #1175 exact-head independent recheck — 2026-07-29

## Frozen live authority

- Governing PR #1175 is the only open pull request, remains draft and unmerged, and points to `release/consolidated-recovery-20260717` at `272b5823c6e118ac7e56f9c38e8f1b8c959b93d5`.
- Its exact base is `integration/controlled-recovery` at `b3c9db5de89a2a665e61a83facbff0f276f9983c`.
- PR #1274 is closed. Its final head, `0611690b1486402df6fb5431b055b219390517e7`, is an ancestor of the frozen #1175 head.
- The canonical changed-file and unique-code disposition remains `docs/audits/open-pr-unique-code-ledger-20260728.md`; no new open donor PR exists to classify.

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
