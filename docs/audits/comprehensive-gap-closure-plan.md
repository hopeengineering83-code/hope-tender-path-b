# Comprehensive Gap Closure Plan

This branch closes the verified application gaps identified during the June 2026 repository audit.

## Implemented

- Added deterministic requirement-to-source-file resolution with ambiguity-safe confidence handling.
- Added database validation for explicit source file IDs and exact-quote source backfilling.
- Added a database guard that prevents deletion of the final canonical requirement set without a recent staged AI Analyze or Engine run.
- Added structured `SubmissionPlanState` storage and automatic refresh triggers.
- Removed the active page's legacy TenderDetail action surface and deleted `LegacyTenderActionHider`.
- Added a dedicated tender source-file upload, download, classification, extraction-status, and deletion panel.
- Organized the tender workspace into five collapsible workflow stages.
- Added static regression tests to ensure authoritative actions render once.
- Added a deterministic ZIP assembler and archive integration tests.
- Added PostgreSQL-backed integration tests for source linkage, canonical preservation, plan provenance, and export blockers.
- Expanded CI to deploy migrations, run lint, execute database integration tests, build, and run Playwright smoke checks.
- Removed accidental root marker files.
- Updated the current readiness audit.

## Automated validation required

PR #714 remains draft until all of these pass on the final head commit:

- Prisma migration deployment
- TypeScript typecheck
- ESLint
- Unit tests
- PostgreSQL integration tests
- Production build
- Playwright browser smoke tests
- Datadog Synthetic tests
- Vercel preview deployment

## Operational verification still required

Automated coverage cannot replace one representative authenticated preview run. Before release, an operator should complete upload, extraction, engine, evidence review, generation, approval, and final ZIP download, then compare the archive with the tender's exact submission instructions.
