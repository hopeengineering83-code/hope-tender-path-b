-- Migration: add_extraction_quality_fields
-- Adds extraction quality tracking fields to TenderFile and Tender models.
-- All new columns are optional (nullable) so this is a non-breaking change.

-- TenderFile: per-file extraction quality metrics
ALTER TABLE "TenderFile" ADD COLUMN IF NOT EXISTS "totalPages" INTEGER;
ALTER TABLE "TenderFile" ADD COLUMN IF NOT EXISTS "extractedPages" INTEGER;
ALTER TABLE "TenderFile" ADD COLUMN IF NOT EXISTS "ocrPages" INTEGER;
ALTER TABLE "TenderFile" ADD COLUMN IF NOT EXISTS "failedPages" INTEGER;
ALTER TABLE "TenderFile" ADD COLUMN IF NOT EXISTS "extractionScore" DOUBLE PRECISION;
ALTER TABLE "TenderFile" ADD COLUMN IF NOT EXISTS "extractionMethod" TEXT;

-- Tender: rich client/procuring entity metadata + extraction status
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "procuringEntityName" TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "legalClientName" TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "donorAgency" TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "implementingAgency" TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "metadataContaminated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "analysisExtractionStatus" TEXT;
