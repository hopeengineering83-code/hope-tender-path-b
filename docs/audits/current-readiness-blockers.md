# Current Readiness Blockers

Last updated: 2026-06-13

This document records the current production-readiness controls for the Hope Tender Proposal Generator.

## Merge policy

A pull request affecting tender analysis, generation, review, or export requires all of the following:

1. GitHub Actions CI: database migrations, typecheck, lint, tests, build, and Playwright smoke checks.
2. Vercel preview deployment.
3. Datadog Synthetic checks where configured.
4. Human review of database migrations and canonical readiness/export gates.

A Vercel build alone is not sufficient.

## PR #714

**Status:** Draft while automated verification is running.

This PR addresses the June 2026 audit gaps:

- requirement-to-source-file linkage;
- protection of canonical analysis during fallback failures;
- structured submission-plan provenance;
- removal of duplicate legacy tender controls;
- staged tender workspace organization;
- PostgreSQL-backed integration tests;
- final ZIP archive regression tests;
- lint and Playwright execution in CI;
- removal of accidental repository marker files.

## Source grounding

TenderRequirement rows are linked to a TenderFile only when the source is unambiguous. Explicit file IDs are validated against the same tender. Exact-quote matches may resolve a source file. Missing or ambiguous matches remain unlinked and receive reduced confidence.

A production verification must still run one authenticated multi-file tender and confirm that displayed filenames, pages, headings, and quotes match the uploaded documents.

## Canonical analysis preservation

The database rejects deletion of the final canonical requirement set unless a recent staged AI Analyze or Engine run exists. The integration suite verifies that an unstaged delete fails and preserves existing requirements.

## Submission-plan provenance

Structured plan state is stored in `SubmissionPlanState`, including provenance, confirmation status, active and derived document counts, and confirmation timestamps. The legacy content-summary marker remains only as a backward-compatible migration input.

## Final ZIP flow

The regression suite verifies valid ZIP bytes, exact filenames, exact order, exclusion of internal artifacts, duplicate-name rejection, missing-byte rejection, and technical/financial envelope separation.

The runtime route must continue to enforce canonical readiness, authority review, document quality, file-signature validation, final-scope filtering, and strict two-envelope rules.

## Tender workspace

The active tender page now uses five stages:

1. Intake and extraction.
2. Analysis and engine.
3. Evidence and matching.
4. Generation and review.
5. Final package and submission.

Each major action appears once. Static regression tests prevent the return of hidden duplicate actions or MutationObserver-based button suppression.

## CI and release decision

CI provisions PostgreSQL, deploys Prisma migrations, runs typecheck, lint, unit and database integration tests, builds the application, and runs Playwright smoke tests against the built server.

The application should still be described as operational with controlled human review until an authenticated preview workflow completes upload, extraction, engine, review, generation, and final ZIP download on a representative tender.
