-- Forward-only corrective migration: add the BuildPlan columns that the
-- DRAFT/CONFIRMED plan service reads and writes but that NO prior migration
-- ever created. The 20260629300000 migration created the table with
-- filesList/plannedDocuments/planType/createdBy, and 20260701000000 added
-- builtById/confirmedRevision/confirmedContentHash/confirmedById — but
-- `status`, `revision`, `itemsJson`, `validationJson`, `confirmedAt`, and
-- `confirmedBy` were only ever present in schema.prisma. On a database
-- migrated via `prisma migrate deploy` (the vercel-build path), every
-- buildPlan.upsert/findFirst in lib/engine/build-plan.ts would throw
-- "column does not exist" at runtime. Local test runs masked this because
-- they synced the schema with `prisma db push` instead of the migrations.

ALTER TABLE "BuildPlan" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "BuildPlan" ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "BuildPlan" ADD COLUMN IF NOT EXISTS "itemsJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "BuildPlan" ADD COLUMN IF NOT EXISTS "validationJson" TEXT;
ALTER TABLE "BuildPlan" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3);
ALTER TABLE "BuildPlan" ADD COLUMN IF NOT EXISTS "confirmedBy" TEXT;
