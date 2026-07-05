-- Migration: tender_share_add_columns
-- Adds revokedAt, maxDownloads, downloadCount to TenderShare.
-- The prior migration (20260605000000_add_tender_share) created the table
-- without these columns; this migration adds them safely.

ALTER TABLE "TenderShare" ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3);
ALTER TABLE "TenderShare" ADD COLUMN IF NOT EXISTS "maxDownloads" INTEGER;
ALTER TABLE "TenderShare" ADD COLUMN IF NOT EXISTS "downloadCount" INTEGER NOT NULL DEFAULT 0;
