-- Persisted, versioned submission plan + requirement-level evidence decisions.
--
-- This migration replaces the virtual Build Plan with a durable, reviewer-confirmed
-- persisted plan. The plan is the authoritative generation authorization source.
-- A virtual preview may remain for the UI, but it must never authorize generation.
--
-- Models created:
--   SubmissionPlanRevision — persisted plan header (one active revision per tender)
--   SubmissionPlanItem     — persisted plan items (exact files, envelopes, requirements)
--   RequirementEvidenceDecision — per-requirement evidence approval decisions
--
-- Existing SubmissionPlanState is preserved for backward compatibility (UI reads
-- the aggregate counts from it). The new SubmissionPlanRevision is the authoritative
-- source; SubmissionPlanState is updated as a derived projection.

-- ─── SubmissionPlanRevision ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SubmissionPlanRevision" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "tenderId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "sourceContentHash" TEXT NOT NULL,
  "requirementsHash" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "confirmedById" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMPTZ,
  "supersededAt" TIMESTAMPTZ,
  "invalidatedAt" TIMESTAMPTZ,
  "invalidationReason" TEXT,
  "confirmationHash" TEXT,
  CONSTRAINT "SubmissionPlanRevision_tenderId_fkey"
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SubmissionPlanRevision_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SubmissionPlanRevision_confirmedById_fkey"
    FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- One active (non-superseded, non-invalidated) revision per tender
CREATE UNIQUE INDEX IF NOT EXISTS "SubmissionPlanRevision_tenderId_active_unique"
  ON "SubmissionPlanRevision" ("tenderId")
  WHERE "status" IN ('DRAFT', 'REVIEW_REQUIRED', 'CONFIRMED');

CREATE INDEX IF NOT EXISTS "SubmissionPlanRevision_tenderId_idx"
  ON "SubmissionPlanRevision" ("tenderId");
CREATE INDEX IF NOT EXISTS "SubmissionPlanRevision_status_idx"
  ON "SubmissionPlanRevision" ("status");

-- ─── SubmissionPlanItem ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SubmissionPlanItem" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "submissionPlanId" TEXT NOT NULL,
  "exactFileName" TEXT NOT NULL,
  "exactOrder" INTEGER NOT NULL,
  "documentType" TEXT NOT NULL DEFAULT 'TENDER_REQUIRED_FILE',
  "format" TEXT NOT NULL DEFAULT 'DOCX',
  "envelope" TEXT NOT NULL DEFAULT 'TECHNICAL',
  "status" TEXT NOT NULL DEFAULT 'PLANNED',
  "sourceRequirementIds" TEXT NOT NULL DEFAULT '[]',
  "sourceFileCitations" TEXT NOT NULL DEFAULT '[]',
  "requiresOriginalUpload" BOOLEAN NOT NULL DEFAULT false,
  "generatedDocumentId" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubmissionPlanItem_submissionPlanId_fkey"
    FOREIGN KEY ("submissionPlanId") REFERENCES "SubmissionPlanRevision"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SubmissionPlanItem_generatedDocumentId_fkey"
    FOREIGN KEY ("generatedDocumentId") REFERENCES "GeneratedDocument"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "SubmissionPlanItem_submissionPlanId_idx"
  ON "SubmissionPlanItem" ("submissionPlanId");
CREATE INDEX IF NOT EXISTS "SubmissionPlanItem_generatedDocumentId_idx"
  ON "SubmissionPlanItem" ("generatedDocumentId");

-- ─── RequirementEvidenceDecision ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "RequirementEvidenceDecision" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "tenderRequirementId" TEXT NOT NULL,
  "tenderFileId" TEXT NOT NULL,
  "pageNumber" INTEGER NOT NULL,
  "exactQuote" TEXT NOT NULL,
  "evidenceType" TEXT NOT NULL,
  "companyAssetType" TEXT NOT NULL,
  "companyAssetId" TEXT NOT NULL,
  "relevanceExplanation" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "decisionStatus" TEXT NOT NULL DEFAULT 'DRAFT',
  "sourceContentHash" TEXT NOT NULL,
  "companyEvidenceHash" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "invalidatedAt" TIMESTAMPTZ,
  "invalidationReason" TEXT,
  CONSTRAINT "RequirementEvidenceDecision_tenderRequirementId_fkey"
    FOREIGN KEY ("tenderRequirementId") REFERENCES "TenderRequirement"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RequirementEvidenceDecision_tenderFileId_fkey"
    FOREIGN KEY ("tenderFileId") REFERENCES "TenderFile"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RequirementEvidenceDecision_reviewerId_fkey"
    FOREIGN KEY ("reviewerId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "RequirementEvidenceDecision_tenderRequirementId_idx"
  ON "RequirementEvidenceDecision" ("tenderRequirementId");
CREATE INDEX IF NOT EXISTS "RequirementEvidenceDecision_decisionStatus_idx"
  ON "RequirementEvidenceDecision" ("decisionStatus");
CREATE INDEX IF NOT EXISTS "RequirementEvidenceDecision_companyAssetId_idx"
  ON "RequirementEvidenceDecision" ("companyAssetId");
