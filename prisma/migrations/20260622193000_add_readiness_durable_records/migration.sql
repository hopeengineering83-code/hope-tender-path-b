-- Central generation-readiness gate durable records.
--
-- FallbackApprovalRecord: an auditable approval of a regex-fallback analysis,
-- bound to the EXACT (tenderId, jobId, contentHash) it was approved against.
-- The unique key makes the approval self-invalidating: a new analysis job or any
-- change to tender content moves the hash, so a stale approval no longer matches.
-- A tender-wide ComplianceGap can never authorize fallback on its own.
--
-- ExtractionQualityOverride: an auditable human override allowing final
-- generation/export on a WEAK (not corrupted) extraction for one tender file.
-- One active override per (tenderId, tenderFileId). Corrupted extraction is never
-- overridable.
--
-- Both store only safe metadata (ids, hashes, scores, reasons). No keys/prompts.

CREATE TABLE IF NOT EXISTS "FallbackApprovalRecord" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "tenderId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "approverId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "approvalRoute" TEXT NOT NULL DEFAULT 'manual',
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "FallbackApprovalRecord_tenderId_jobId_contentHash_key"
  ON "FallbackApprovalRecord" ("tenderId", "jobId", "contentHash");
CREATE INDEX IF NOT EXISTS "FallbackApprovalRecord_tenderId_contentHash_idx"
  ON "FallbackApprovalRecord" ("tenderId", "contentHash");
CREATE INDEX IF NOT EXISTS "FallbackApprovalRecord_jobId_contentHash_idx"
  ON "FallbackApprovalRecord" ("jobId", "contentHash");

CREATE TABLE IF NOT EXISTS "ExtractionQualityOverride" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "tenderId" TEXT NOT NULL,
  "tenderFileId" TEXT NOT NULL,
  "qualityScore" DOUBLE PRECISION NOT NULL,
  "overrideReason" TEXT NOT NULL,
  "overriddenBy" TEXT NOT NULL,
  "overriddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExtractionQualityOverride_tenderId_tenderFileId_key"
  ON "ExtractionQualityOverride" ("tenderId", "tenderFileId");
CREATE INDEX IF NOT EXISTS "ExtractionQualityOverride_tenderId_idx"
  ON "ExtractionQualityOverride" ("tenderId");
CREATE INDEX IF NOT EXISTS "ExtractionQualityOverride_tenderFileId_idx"
  ON "ExtractionQualityOverride" ("tenderFileId");
