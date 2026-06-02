-- Migration: add_client_extraction_fields
-- Adds extended client/procuring-entity extraction fields to the Tender model.
-- PR XX-CLIENT

ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "procuringEntityName" TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "legalClientName" TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "donorAgency" TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "implementingAgency" TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "metadataContaminated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "clientNameSourcePage" INTEGER;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "clientNameSourceQuote" TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "submissionEmailSourcePage" INTEGER;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "analysisExtractionStatus" TEXT;
