-- Add source-evidence fields for reference and submissionEmailSubject
-- These are policy-critical metadata fields that need durable source grounding
-- with active TenderFile ID, valid page, and contained quote for export validation.

ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "referenceSourceFileId" TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "referenceSourcePage" INTEGER;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "referenceSourceQuote" TEXT;

ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "submissionEmailSubjectSourceFileId" TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "submissionEmailSubjectSourcePage" INTEGER;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "submissionEmailSubjectSourceQuote" TEXT;
