# Current Readiness Blockers

Last updated: 2026-05-23

This document tracks known PRs and issues that block or threaten production readiness.
It is the authoritative reference for triage decisions — do not merge any PR listed here
without reading its status note first.

---

## Merge policy (enforced)

**No PR may be merged if GitHub CI (the "Typecheck, test, and build" check) has failed,
even when the Vercel deployment check is green.**

Vercel can succeed on a build that skips typecheck and tests (it only runs `next build`).
GitHub Actions CI runs the full suite: typecheck → tests → build. Both must pass.
Where Datadog Synthetic tests are configured they are also required before merge.

Required passing checks before merging to `main`:
1. GitHub Actions CI — "Typecheck, test, and build"
2. Vercel deployment preview
3. Datadog Synthetic tests (where configured for the affected route)

---

## PR #407 — closed, redundant, do not merge

**Status:** Closed and unmerged.

PR #407 contained early readiness scaffolding that was superseded by later PRs.
Its changes have diverged from main. **Do not reopen or merge it** — cherry-picking
individual commits requires a manual review to confirm no regression is introduced.

Action: None. PR is closed. Mark any referenced issues as resolved by subsequent work.

---

## PR #404 — diverged readiness work, do not merge directly

**Status:** Open but significantly diverged from main.

PR #404 contains readiness-gate work that was partially absorbed by later PRs
(#415, #416). Merging it directly will introduce merge conflicts and may reintroduce
code that was intentionally changed or removed.

Action: If any specific fix from PR #404 is needed, **extract and apply it manually
after a line-by-line review** against current main. Do not click "Merge" on the PR
as-is.

---

## PR #419 — pricing hygiene fix, pending CI

**Status:** Vercel passed; GitHub CI status must be confirmed green before merge.

PR #419 contains pricing display hygiene changes. Vercel reported success on preview
but GitHub CI must also be green before this PR can be merged. CI is the required gate.

Action: Check the "Typecheck, test, and build" check on PR #419. If it is red, fix
the failing step before merging. Do not merge on Vercel-green alone.

---

## Source grounding blocker

**Status:** Active blocker on final proposal export quality.

Proposals generated without grounded source citations may fail compliance checks.
This must be fixed through dedicated `repair-source-grounding` work (see
`app/api/tenders/[id]/repair-export-gaps/route.ts` for the repair endpoint scaffolding).

Action: Do not mark the export flow as "production ready" until source grounding is
verified end-to-end on a real tender with REVIEWED vault records.

---

## Export ZIP flow — regression test required

**Status:** Flow is implemented; regression test is not yet in CI.

The export ZIP route assembles the final proposal package. A regression in this flow
would silently break the deliverable without a test catching it.

Action: Before shipping any change that touches `app/api/tenders/[id]/export*` or
`lib/engine/generate*`, confirm that an integration or snapshot test covers the ZIP
output. Adding that test is a prerequisite for marking the export flow production-safe.

---

## Notes on the large-vault engine blocker (resolved in PRs #415 and #416)

PRs #415 and #416 fixed the `ASYNC_ENGINE_TIMEOUT` at `engine.analyze` for vaults
with >30 reviewed records:

- PR #415: large-vault safe mode, stuck-recovery threshold 90s, Gap 8 sanitizer
- PR #416: 50k char cap in safe mode for the analyze step, 25s heartbeat interval

These are merged. If a new `ASYNC_ENGINE_TIMEOUT` appears, check:
1. Was the job dispatched with `safe: true`? (UI should do this automatically for large vaults)
2. Is the heartbeat firing? (check AiJobStep rows for `engine.heartbeat` entries)
3. Is the tender text exceeding 50k chars after deduplication?
