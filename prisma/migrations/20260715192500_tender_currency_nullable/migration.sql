-- AlterTable: make Tender.currency nullable and drop the USD default
-- Previously: currency String @default("USD") (NOT NULL with default)
-- Now: currency String? (nullable, no default)
--
-- This fixes the screenshot gap where corrupted tenders
-- (EXTRACTION_CORRUPTED_AI_SKIPPED) showed "Currency: USD" even when
-- all other extracted fields were null. The USD default was a schema
-- artifact, not a sourced value.
--
-- Conservative backfill: clear currency ONLY for rows where the tender
-- status proves the currency was never sourced from the document text.
-- Genuinely sourced currency (any tender with a non-corrupted status)
-- is preserved.

-- Step 1: Drop the default and NOT NULL constraint
ALTER TABLE "Tender" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "Tender" ALTER COLUMN "currency" DROP NOT NULL;

-- Step 2: Conservative backfill — clear USD only where the tender
-- status proves extraction was corrupted/skipped (currency was never
-- sourced from the document text; it was the schema default).
-- Statuses that prove currency was never sourced:
--   EXTRACTION_CORRUPTED_AI_SKIPPED — extraction failed, AI skipped
--   OCR_REQUIRED — extraction too weak for AI
--   EXTRACTION_WEAK_REVIEW_REQUIRED — extraction below AI threshold
-- Any other status (DRAFT, ACTIVE, ANALYZED, etc.) preserves the
-- currency value because it may have been sourced or manually set.
UPDATE "Tender"
SET "currency" = NULL
WHERE "currency" = 'USD'
  AND "status" IN ('EXTRACTION_CORRUPTED_AI_SKIPPED', 'OCR_REQUIRED', 'EXTRACTION_WEAK_REVIEW_REQUIRED');
