# PR #1175 Review Inbox authority falsification — 2026-07-29

## Frozen input

- Governing draft PR: `#1175`
- Audited head: `c0f442427b53f2e58b9738b17814e1f3fb83278d`
- Base: `b3c9db5de89a2a665e61a83facbff0f276f9983c`
- Live open-PR list at the start of the pass: `#1175` only
- Incorporated consolidation: closed `#1274` head
  `0611690b1486402df6fb5431b055b219390517e7` is an ancestor of the audited
  head.

## Falsified green-screen claim

The exact-head route audit passed its HTTP, runtime-error, and horizontal
overflow assertions, but visual inspection of its tablet Review Inbox image
found a product-authority contradiction:

- the page heading and dashboard header said **Review Inbox**;
- the active Company workspace tab said **Diagnostics**; and
- a separate **Review Board** tab navigated to the legacy compatibility route,
  which immediately redirected to the same Review Inbox.

The same obsolete compatibility route was still emitted by the generation
readiness action, the Plan B import control, and deep-reasoning guidance. This
did not create a second server mutation owner, but it did present duplicate and
contradictory controls for one canonical workflow authority.

## Repair

- The Company workspace now exposes exactly one canonical **Review Inbox** tab
  at `/dashboard/company/review`.
- Production actions and guidance navigate directly to that canonical route.
- User-facing Company Vault and Plan B messages consistently call the workflow
  **Review Inbox**.
- `/dashboard/company/review-board` remains a redirect-only compatibility route
  for historical bookmarks; it is not presented as a live control.
- The existing Review Inbox authority contract now rejects a duplicate legacy
  tab, the misleading Diagnostics label, and production callers of the legacy
  route.

## Independent verification on the repaired tree

- Clean locked install completed without tracked-source mutation.
- Prisma validation/client generation passed.
- All 43 migrations deployed to a new local PostgreSQL 16 database; critical
  schema, retroactive bootstrap structure, idempotent second deployment, and
  zero drift passed.
- Release-integrity checked 418 routes and 1,390 files successfully.
- Typecheck and lint passed with zero warnings.
- Targeted Review Inbox/navigation coverage passed: 41 tests.
- Complete unit/PostgreSQL run passed: 8,928 tests, zero failures and zero
  skips.
- Production build passed.
- Fresh authenticated screenshot acceptance passed with retries disabled: one
  test covering desktop, tablet, and mobile; no HTTP failure, authentication
  loss, horizontal overflow, console error, page error, failed request, or 5xx.
- The repaired tablet screenshot visibly shows one active **Review Inbox** tab
  and no Review Board or Diagnostics duplicate.

The first two local Playwright attempts failed before executing application
code because the clean container lacked the browser binary and then its system
libraries. After `npx playwright install chromium` and
`npx playwright install-deps chromium`, the same command passed. Those setup
failures are environment preparation evidence, not application failures.

## Remaining holds

This repair does not close the external security/acceptance holds already
recorded on #1175. The next pushed head still requires its own exact-head CI,
Git-triggered preview identity, preview runtime-log query, and updated PR
description. Provider-backed preview workflow acceptance remains blocked until
approved synthetic preview credentials exist; real-account testing remains
prohibited while the credential rotation hold is open.
