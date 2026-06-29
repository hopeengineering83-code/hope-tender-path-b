-- Persisted, versioned submission plan + relational requirement/evidence authority.
-- This migration is pending in this branch; origin/main could not be fetched in
-- this environment, but local migrations did not contain this version.

DO $$ BEGIN
  CREATE TYPE "SubmissionPlanRevisionStatus" AS ENUM ('DRAFT', 'REVIEW_REQUIRED', 'CONFIRMED', 'SUPERSEDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SubmissionPlanEnvelope" AS ENUM ('TECHNICAL', 'FINANCIAL', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "RequirementEvidenceStatus" AS ENUM ('RECOMMENDED', 'APPROVED', 'REJECTED', 'STALE', 'INVALIDATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "SubmissionPlanRevision" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenderId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" "SubmissionPlanRevisionStatus" NOT NULL DEFAULT 'DRAFT',
  "sourceContentHash" TEXT NOT NULL,
  "requirementsHash" TEXT NOT NULL,
  "confirmationSnapshot" JSONB,
  "confirmationHash" TEXT,
  "createdById" TEXT NOT NULL,
  "confirmedById" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "supersededAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3),
  "invalidationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubmissionPlanRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SubmissionPlanRevision_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SubmissionPlanRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SubmissionPlanRevision_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "SubmissionPlanRevision_tenderId_revision_key" ON "SubmissionPlanRevision"("tenderId", "revision");
CREATE INDEX IF NOT EXISTS "SubmissionPlanRevision_tenderId_status_idx" ON "SubmissionPlanRevision"("tenderId", "status");
CREATE INDEX IF NOT EXISTS "SubmissionPlanRevision_sourceContentHash_idx" ON "SubmissionPlanRevision"("sourceContentHash");
CREATE INDEX IF NOT EXISTS "SubmissionPlanRevision_requirementsHash_idx" ON "SubmissionPlanRevision"("requirementsHash");
CREATE UNIQUE INDEX IF NOT EXISTS "SubmissionPlanRevision_one_working_plan" ON "SubmissionPlanRevision"("tenderId") WHERE "status" IN ('DRAFT', 'REVIEW_REQUIRED');
CREATE UNIQUE INDEX IF NOT EXISTS "SubmissionPlanRevision_one_confirmed_plan" ON "SubmissionPlanRevision"("tenderId") WHERE "status" = 'CONFIRMED';

CREATE TABLE IF NOT EXISTS "SubmissionPlanItem" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "submissionPlanId" TEXT NOT NULL,
  "exactFileName" TEXT NOT NULL,
  "exactOrder" INTEGER NOT NULL,
  "documentType" TEXT NOT NULL,
  "format" TEXT NOT NULL DEFAULT 'DOCX',
  "envelope" "SubmissionPlanEnvelope" NOT NULL,
  "requiresOriginalUpload" BOOLEAN NOT NULL DEFAULT false,
  "generatedDocumentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubmissionPlanItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SubmissionPlanItem_submissionPlanId_fkey" FOREIGN KEY ("submissionPlanId") REFERENCES "SubmissionPlanRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SubmissionPlanItem_generatedDocumentId_fkey" FOREIGN KEY ("generatedDocumentId") REFERENCES "GeneratedDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SubmissionPlanItem_exactOrder_positive" CHECK ("exactOrder" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "SubmissionPlanItem_plan_filename_key" ON "SubmissionPlanItem"("submissionPlanId", "exactFileName");
CREATE UNIQUE INDEX IF NOT EXISTS "SubmissionPlanItem_plan_order_key" ON "SubmissionPlanItem"("submissionPlanId", "exactOrder");
CREATE UNIQUE INDEX IF NOT EXISTS "SubmissionPlanItem_generatedDocumentId_key" ON "SubmissionPlanItem"("generatedDocumentId") WHERE "generatedDocumentId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "SubmissionPlanItem_submissionPlanId_idx" ON "SubmissionPlanItem"("submissionPlanId");

CREATE TABLE IF NOT EXISTS "SubmissionPlanItemRequirement" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "submissionPlanItemId" TEXT NOT NULL,
  "tenderRequirementId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubmissionPlanItemRequirement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SubmissionPlanItemRequirement_item_fkey" FOREIGN KEY ("submissionPlanItemId") REFERENCES "SubmissionPlanItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SubmissionPlanItemRequirement_requirement_fkey" FOREIGN KEY ("tenderRequirementId") REFERENCES "TenderRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "SubmissionPlanItemRequirement_item_requirement_key" ON "SubmissionPlanItemRequirement"("submissionPlanItemId", "tenderRequirementId");
CREATE INDEX IF NOT EXISTS "SubmissionPlanItemRequirement_requirement_idx" ON "SubmissionPlanItemRequirement"("tenderRequirementId");

CREATE TABLE IF NOT EXISTS "SubmissionPlanItemCitation" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "submissionPlanItemId" TEXT NOT NULL,
  "tenderFileId" TEXT NOT NULL,
  "pageNumber" INTEGER NOT NULL,
  "exactQuote" TEXT NOT NULL,
  "sourceContentHash" TEXT NOT NULL,
  "citationHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubmissionPlanItemCitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SubmissionPlanItemCitation_item_fkey" FOREIGN KEY ("submissionPlanItemId") REFERENCES "SubmissionPlanItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SubmissionPlanItemCitation_file_fkey" FOREIGN KEY ("tenderFileId") REFERENCES "TenderFile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SubmissionPlanItemCitation_page_positive" CHECK ("pageNumber" > 0),
  CONSTRAINT "SubmissionPlanItemCitation_meaningful_quote" CHECK (length(btrim("exactQuote")) >= 12)
);
CREATE UNIQUE INDEX IF NOT EXISTS "SubmissionPlanItemCitation_unique_source" ON "SubmissionPlanItemCitation"("submissionPlanItemId", "tenderFileId", "pageNumber", "citationHash");
CREATE INDEX IF NOT EXISTS "SubmissionPlanItemCitation_file_idx" ON "SubmissionPlanItemCitation"("tenderFileId");
CREATE INDEX IF NOT EXISTS "SubmissionPlanItemCitation_source_hash_idx" ON "SubmissionPlanItemCitation"("sourceContentHash");

CREATE TABLE IF NOT EXISTS "TenderMetadataEvidence" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenderId" TEXT NOT NULL,
  "fieldKey" TEXT NOT NULL,
  "tenderFileId" TEXT NOT NULL,
  "pageNumber" INTEGER NOT NULL,
  "exactQuote" TEXT NOT NULL,
  "extractionRevision" TEXT NOT NULL,
  "sourceContentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "invalidatedAt" TIMESTAMP(3),
  "invalidationReason" TEXT,
  CONSTRAINT "TenderMetadataEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TenderMetadataEvidence_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TenderMetadataEvidence_file_fkey" FOREIGN KEY ("tenderFileId") REFERENCES "TenderFile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TenderMetadataEvidence_page_positive" CHECK ("pageNumber" > 0),
  CONSTRAINT "TenderMetadataEvidence_meaningful_quote" CHECK (length(btrim("exactQuote")) >= 12)
);
CREATE UNIQUE INDEX IF NOT EXISTS "TenderMetadataEvidence_field_source_key" ON "TenderMetadataEvidence"("tenderId", "fieldKey", "tenderFileId", "pageNumber", "sourceContentHash");
CREATE INDEX IF NOT EXISTS "TenderMetadataEvidence_tender_field_idx" ON "TenderMetadataEvidence"("tenderId", "fieldKey");
CREATE INDEX IF NOT EXISTS "TenderMetadataEvidence_file_idx" ON "TenderMetadataEvidence"("tenderFileId");
CREATE INDEX IF NOT EXISTS "TenderMetadataEvidence_source_hash_idx" ON "TenderMetadataEvidence"("sourceContentHash");

CREATE TABLE IF NOT EXISTS "RequirementEvidenceDecision" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "tenderId" TEXT NOT NULL,
  "tenderRequirementId" TEXT NOT NULL,
  "tenderFileId" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "status" "RequirementEvidenceStatus" NOT NULL DEFAULT 'RECOMMENDED',
  "pageNumber" INTEGER NOT NULL,
  "exactQuote" TEXT NOT NULL,
  "sourceContentHash" TEXT NOT NULL,
  "assetContentHash" TEXT NOT NULL,
  "expertId" TEXT,
  "projectId" TEXT,
  "legalRecordId" TEXT,
  "companyComplianceRecordId" TEXT,
  "companyAssetId" TEXT,
  "originalUploadId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3),
  "invalidationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RequirementEvidenceDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RequirementEvidenceDecision_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RequirementEvidenceDecision_requirement_fkey" FOREIGN KEY ("tenderRequirementId") REFERENCES "TenderRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RequirementEvidenceDecision_file_fkey" FOREIGN KEY ("tenderFileId") REFERENCES "TenderFile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RequirementEvidenceDecision_reviewer_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RequirementEvidenceDecision_expert_fkey" FOREIGN KEY ("expertId") REFERENCES "Expert"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RequirementEvidenceDecision_project_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RequirementEvidenceDecision_legalRecord_fkey" FOREIGN KEY ("legalRecordId") REFERENCES "LegalRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RequirementEvidenceDecision_compliance_fkey" FOREIGN KEY ("companyComplianceRecordId") REFERENCES "CompanyComplianceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RequirementEvidenceDecision_companyAsset_fkey" FOREIGN KEY ("companyAssetId") REFERENCES "CompanyAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RequirementEvidenceDecision_originalUpload_fkey" FOREIGN KEY ("originalUploadId") REFERENCES "CompanyAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RequirementEvidenceDecision_page_positive" CHECK ("pageNumber" > 0),
  CONSTRAINT "RequirementEvidenceDecision_meaningful_quote" CHECK (length(btrim("exactQuote")) >= 12),
  CONSTRAINT "RequirementEvidenceDecision_one_asset" CHECK (
    (("expertId" IS NOT NULL)::int + ("projectId" IS NOT NULL)::int + ("legalRecordId" IS NOT NULL)::int +
     ("companyComplianceRecordId" IS NOT NULL)::int + ("companyAssetId" IS NOT NULL)::int + ("originalUploadId" IS NOT NULL)::int) = 1
  )
);
CREATE INDEX IF NOT EXISTS "RequirementEvidenceDecision_tender_status_idx" ON "RequirementEvidenceDecision"("tenderId", "status");
CREATE INDEX IF NOT EXISTS "RequirementEvidenceDecision_requirement_status_idx" ON "RequirementEvidenceDecision"("tenderRequirementId", "status");
CREATE INDEX IF NOT EXISTS "RequirementEvidenceDecision_file_idx" ON "RequirementEvidenceDecision"("tenderFileId");
CREATE INDEX IF NOT EXISTS "RequirementEvidenceDecision_reviewer_idx" ON "RequirementEvidenceDecision"("reviewerId");
CREATE INDEX IF NOT EXISTS "RequirementEvidenceDecision_source_hash_idx" ON "RequirementEvidenceDecision"("sourceContentHash");
CREATE INDEX IF NOT EXISTS "RequirementEvidenceDecision_asset_hash_idx" ON "RequirementEvidenceDecision"("assetContentHash");
