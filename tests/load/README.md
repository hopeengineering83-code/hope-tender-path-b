# Load Tests (k6)

**Branch:** `fix/exhaustive-current-gap-cleanup`
**Addresses audit gap:** GAP-PERF-07 (partial — scaffolding only)

## Purpose

This directory will house k6 load tests for the Hope Tender Engine. Currently
it contains only scaffolding; the actual k6 scripts will be added in a
follow-up PR (deferred to avoid adding a dev dependency in this cleanup PR).

## Intended scenarios

| Scenario | Target RPS | Notes |
|---|---|---|
| `tender-list.ts` | 100 | `GET /api/tenders` with cursor pagination |
| `tender-detail.ts` | 50 | `GET /api/tenders/[id]` with full include |
| `tender-upload.ts` | 10 | `POST /api/tenders/upload-first` with 5 MB PDF |
| `ai-analyze.ts` | 5 | `POST /api/tenders/[id]/ai-analyze` with mocked providers |
| `generate.ts` | 2 | `POST /api/tenders/[id]/generate` with mocked AI |
| `download-zip.ts` | 50 | `GET /api/tenders/[id]/download` |
| `dashboard.ts` | 200 | `GET /dashboard` (RSC) |

## Intended SLOs

See `docs/runbooks/slos.md` for the latency targets these tests should
verify.

## Implementation status

| Item | Status |
|---|---|
| Directory created | Done (this PR) |
| SLOs documented | Done (`docs/runbooks/slos.md`) |
| k6 scripts written | Not started (follow-up PR) |
| Weekly CI job configured | Not started (follow-up PR) |
| Staging environment provisioned | Not started (operator action — GAP-DEVOPS-02) |

## Why deferred

Adding k6 as a dev dependency and writing the test scripts is an S effort
per scenario (7 scenarios total = ~3 days). The deferral is intentional:

1. k6 is a significant new tooling addition that warrants its own PR review.
2. Load tests require a staging environment with realistic data
   (GAP-DEVOPS-02 is an operator action).
3. SLO targets in `docs/runbooks/slos.md` need operator sign-off before
   tests can validate them.

This scaffolding establishes the directory and intent so the follow-up PR
can proceed without further architectural discussion.
