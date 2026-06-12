-- Add versioning, staging, and canonical-promotion tracking fields to AiJob.
-- These columns enable the non-destructive AI analysis pattern: partial and
-- fallback runs write to stagedMergedResult instead of overwriting canonical
-- tender requirements; only a fully-successful run may promote to canonical.

ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "runId" TEXT;
ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "analysisInputHash" TEXT;
ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "analysisVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "stagedMergedResult" TEXT;
ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "validationResult" TEXT;
ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "promotedAt" TIMESTAMP(3);
ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "promotedBy" TEXT;
ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "supersededBy" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "AiJob_runId_key" ON "AiJob"("runId");
