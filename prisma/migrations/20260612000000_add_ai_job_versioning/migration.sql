-- Add versioning, staging, and canonical-promotion tracking fields to AiJob.
-- These columns enable the non-destructive AI analysis pattern: partial and
-- fallback runs write to stagedMergedResult instead of overwriting canonical
-- tender requirements; only a fully-successful run may promote to canonical.

ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "runId" TEXT;
ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "analysisInputHash" TEXT;
-- analysisVersion uses a BIGSERIAL sequence so each new AiJob gets a strictly
-- increasing value assigned atomically by PostgreSQL — no application-level
-- timestamp logic and no same-millisecond collision risk.
CREATE SEQUENCE IF NOT EXISTS "AiJob_analysisVersion_seq";
ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "analysisVersion" BIGINT NOT NULL DEFAULT 0;
-- For fresh installs: wire the column to the sequence.
-- For existing installs where the column was already added (as INTEGER or BIGINT with DEFAULT 0):
--   1. Upgrade to BIGINT if it was INTEGER.
--   2. Assign the sequence as the new default.
ALTER TABLE "AiJob" ALTER COLUMN "analysisVersion" TYPE BIGINT USING "analysisVersion"::BIGINT;
ALTER TABLE "AiJob" ALTER COLUMN "analysisVersion" SET DEFAULT nextval('"AiJob_analysisVersion_seq"');
ALTER SEQUENCE "AiJob_analysisVersion_seq" OWNED BY "AiJob"."analysisVersion";
ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "stagedMergedResult" TEXT;
ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "validationResult" TEXT;
ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "promotedAt" TIMESTAMP(3);
ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "promotedBy" TEXT;
ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "supersededBy" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "AiJob_runId_key" ON "AiJob"("runId");
