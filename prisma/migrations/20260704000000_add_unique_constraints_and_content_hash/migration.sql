-- Migration: Add unique constraints + contentHash column
--
-- Closes 3 remaining schema-level gaps:
-- 1. ProposalVersion @@unique([tenderId, version]) — prevents duplicate version numbers
--    from concurrent /generate calls (TOCTOU race in generate-elite.ts).
-- 2. GeneratedDocument @@unique([tenderId, exactFileName]) — prevents duplicate
--    document rows from concurrent /generate calls (TOCTOU race).
-- 3. TenderFile contentHash column + @@unique([tenderId, contentHash]) — prevents
--    duplicate uploads of the same file content.
--
-- DEDUP: Before adding each unique constraint, delete duplicate rows (keep the
-- most recently updated). This is safe because the application code already
-- treats the "first" or "most recent" row as canonical.

-- ─── 1. ProposalVersion: dedup + unique constraint ──────────────────────────

-- Delete duplicate ProposalVersion rows (keep the one with the latest createdAt).
DELETE FROM "ProposalVersion" pv
WHERE pv.id NOT IN (
  SELECT DISTINCT ON ("tenderId", "version") id
  FROM "ProposalVersion"
  ORDER BY "tenderId", "version", "createdAt" DESC
);

CREATE UNIQUE INDEX "ProposalVersion_tenderId_version_key"
  ON "ProposalVersion"("tenderId", "version");

-- ─── 2. GeneratedDocument: dedup + unique constraint ────────────────────────

-- Delete duplicate GeneratedDocument rows where exactFileName is not null
-- (keep the one with the latest updatedAt). Rows with null exactFileName are
-- excluded from the constraint (partial unique index).
DELETE FROM "GeneratedDocument" gd
WHERE gd."exactFileName" IS NOT NULL
  AND gd.id NOT IN (
    SELECT DISTINCT ON ("tenderId", "exactFileName") id
    FROM "GeneratedDocument"
    WHERE "exactFileName" IS NOT NULL
    ORDER BY "tenderId", "exactFileName", "updatedAt" DESC
  );

CREATE UNIQUE INDEX "GeneratedDocument_tenderId_exactFileName_key"
  ON "GeneratedDocument"("tenderId", "exactFileName")
  WHERE "exactFileName" IS NOT NULL;

-- ─── 3. TenderFile: contentHash column + unique constraint ──────────────────

ALTER TABLE "TenderFile" ADD COLUMN "contentHash" TEXT;

-- Populate contentHash for existing rows using md5 of fileContent or extractedText.
-- This is a best-effort backfill — new uploads will compute the hash at upload time.
UPDATE "TenderFile"
SET "contentHash" = md5(COALESCE("fileContent", "extractedText", ''))
WHERE "contentHash" IS NULL
  AND ("fileContent" IS NOT NULL OR "extractedText" IS NOT NULL);

-- Dedup TenderFile rows by (tenderId, contentHash) where contentHash is not null
-- and not empty. Keep the most recently updated.
DELETE FROM "TenderFile" tf
WHERE tf."contentHash" IS NOT NULL
  AND tf."contentHash" != ''
  AND tf.id NOT IN (
    SELECT DISTINCT ON ("tenderId", "contentHash") id
    FROM "TenderFile"
    WHERE "contentHash" IS NOT NULL AND "contentHash" != ''
    ORDER BY "tenderId", "contentHash", "updatedAt" DESC
  );

CREATE UNIQUE INDEX "TenderFile_tenderId_contentHash_key"
  ON "TenderFile"("tenderId", "contentHash")
  WHERE "contentHash" IS NOT NULL AND "contentHash" != '';
