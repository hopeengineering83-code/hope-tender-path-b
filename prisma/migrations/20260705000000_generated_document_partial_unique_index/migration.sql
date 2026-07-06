-- Migration: Replace full unique constraint on GeneratedDocument(tenderId, exactFileName)
-- with a PARTIAL unique index that only applies to non-SUPERSEDED documents.
--
-- Root cause: The engine supersedes documents (sets generationStatus='SUPERSEDED')
-- while preserving exactFileName, then inserts new rows with the same exactFileName.
-- The full unique constraint rejected this because SUPERSEDED rows still hold the name.
--
-- Fix: Drop the full unique index and create a partial one that only enforces
-- uniqueness among ACTIVE (non-SUPERSEDED) documents. This allows history rows
-- to keep their original exactFileName while preventing duplicates among active docs.

-- 1. Drop the existing full unique index (added in migration 20260704000000).
DROP INDEX IF EXISTS "GeneratedDocument_tenderId_exactFileName_key";

-- 2. Dedup any existing duplicate ACTIVE rows before adding the partial index.
-- Keep the most recently updated row; mark the rest as SUPERSEDED.
UPDATE "GeneratedDocument" gd
SET "generationStatus" = 'SUPERSEDED',
    "validationStatus" = 'SUPERSEDED',
    "reviewStatus" = 'SUPERSEDED',
    "reviewNotes" = COALESCE("reviewNotes", '') || ' [Auto-superseded: duplicate exactFileName among active docs]',
    "updatedAt" = NOW()
WHERE gd."exactFileName" IS NOT NULL
  AND gd."generationStatus" != 'SUPERSEDED'
  AND gd.id NOT IN (
    SELECT DISTINCT ON ("tenderId", "exactFileName") id
    FROM "GeneratedDocument"
    WHERE "exactFileName" IS NOT NULL
      AND "generationStatus" != 'SUPERSEDED'
    ORDER BY "tenderId", "exactFileName", "updatedAt" DESC
  );

-- 3. Create the partial unique index — only enforces uniqueness among non-SUPERSEDED rows.
CREATE UNIQUE INDEX "GeneratedDocument_tenderId_exactFileName_active_key"
  ON "GeneratedDocument"("tenderId", "exactFileName")
  WHERE "exactFileName" IS NOT NULL AND "generationStatus" != 'SUPERSEDED';
