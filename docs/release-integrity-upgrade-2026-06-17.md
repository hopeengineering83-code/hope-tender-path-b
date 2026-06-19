# Release integrity upgrade — 2026-06-17

## Scope

This integration upgrade consolidates verified security changes from PRs #753 and #754 and replaces the overlapping release/migration work in PRs #751, #755, and #758.

## Included controls

- Company-asset validation, authorization, persistent rate limiting, secure storage-adapter use, private response headers, and trusted Vercel Blob host enforcement.
- Tender-share role controls, high-entropy tokens, bounded inputs, auditable revocation, and atomic access-limit claims.
- Non-mutating install, build, typecheck, lint, and test lifecycle commands.
- Migration-built CI database; no `prisma db push` and no manual reapplication of migration SQL.
- Migration idempotency, critical-schema verification, and source-mutation guards.
- Two real seeded users with distinct owned tenders and authenticated cross-user isolation tests.
- Exact release-SHA and critical-table verification for post-deployment health.

## Retroactive initialization recovery

The production incident is restricted to the checked-in migration `20260601000000_init`.

Automatic recovery is permitted only when all of the following are true:

1. Prisma reports the known failed initialization migration.
2. The checked-in migration file exists.
3. Its SHA-256 checksum matches the unfinished migration-history row.
4. Exactly one unfinished migration exists and it is the known initialization migration.
5. Every table, column, named index, and named constraint created by that migration is present.

The recovery then marks that exact failed row rolled back, records the same migration as applied, retries `prisma migrate deploy`, and runs both initialization-history and critical-schema verification.

No other failed migration is automatically resolved. A non-empty database with no migration history is rejected for separately reviewed manual recovery. Preview deployments do not run migrations unless an isolated preview database is explicitly enabled with `ALLOW_PREVIEW_DB_MIGRATIONS=true`.

## Validation boundary

The authenticated CI proof covers sign-in, validated source intake, persistence, pre-analysis generation/export gates, and real two-owner isolation. It does not claim that external AI providers generated final submission documents because CI uses no billable provider credentials.

## Promotion gate

Do not promote to `release/production-engine-2026-06` until the exact integration head passes:

- dependency installation and clean-tree check;
- Prisma validation and generation;
- complete migration deployment and second idempotency deployment;
- initialization and critical-schema verification;
- release-integrity audit;
- typecheck, lint, unit/database tests, build;
- authenticated Playwright intake and cross-user isolation;
- final clean-tree check.

Before production promotion, confirm a current database backup and retain the previous working Vercel deployment for rollback. After deployment, `/api/health` must report `healthy`, the exact expected Git SHA, and all critical tables ready.
