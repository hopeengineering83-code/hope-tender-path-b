-- Forward-only migration: unify BuildPlan architecture
--
-- The DRAFT/CONFIRMED BuildPlan service (lib/engine/build-plan.ts) writes
-- builtById, confirmedRevision, confirmedContentHash, confirmedById, and
-- confirmedAt. The original 20260629300000 migration only added `confirmedBy`
-- and `confirmedAt`; it omitted `builtById`, `confirmedRevision`,
-- `confirmedContentHash`, and `confirmedById`. As a result, every DRAFT build
-- and CONFIRMED update at runtime threw "Unknown argument" Prisma errors,
-- which mock-only tests could not detect.
--
-- This migration is purely additive: it adds the missing columns with safe
-- defaults so existing rows (if any) remain readable. It does NOT drop or
-- rename the legacy `createdBy` / `confirmedBy` columns; the bootstrap and
-- service are updated to treat `builtById`/`confirmedById` as authoritative
-- while `createdBy`/`confirmedBy` are kept as audit-only aliases for
-- backward compatibility with the submission-plan/build route.

-- builtById: who built the DRAFT plan (replaces createdBy for the
-- DRAFT/CONFIRMED service; createdBy is retained as an alias).
ALTER TABLE "BuildPlan" ADD COLUMN IF NOT EXISTS "builtById" TEXT;

-- confirmedRevision: the revision number captured at confirmation time. Used
-- to detect post-confirmation edits to the DRAFT row (revision mismatch =>
-- stale confirmation).
ALTER TABLE "BuildPlan" ADD COLUMN IF NOT EXISTS "confirmedRevision" INTEGER;

-- confirmedContentHash: the contentHash captured at confirmation time. Used
-- together with the live computed hash to detect any drift in tender files,
-- requirements, or submission instructions after confirmation.
ALTER TABLE "BuildPlan" ADD COLUMN IF NOT EXISTS "confirmedContentHash" TEXT;

-- confirmedById: who confirmed the plan (separate from legacy `confirmedBy`
-- so the audit trail of DRAFT builder vs. CONFIRMED approver is unambiguous).
ALTER TABLE "BuildPlan" ADD COLUMN IF NOT EXISTS "confirmedById" TEXT;

-- Backfill: if older rows used `createdBy` for the builder, copy it into
-- `builtById` so the unified service can read a single authoritative column.
UPDATE "BuildPlan" SET "builtById" = "createdBy" WHERE "builtById" IS NULL AND "createdBy" IS NOT NULL;

-- Backfill: if older rows used `confirmedBy` for the approver, copy it into
-- `confirmedById` so the unified service can read a single authoritative column.
UPDATE "BuildPlan" SET "confirmedById" = "confirmedBy" WHERE "confirmedById" IS NULL AND "confirmedBy" IS NOT NULL;
