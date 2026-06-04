-- Migration: add_source_traceability_and_client_fields
-- Adds all columns introduced in PRs #579, #580, #581:
--   • Tender: 5 extended client fields + 3 source-audit fields
--   • TenderRequirement: 5 source-traceability fields
--   • TenderFile: 2 extraction-detail fields (ocrModel, pageStatusJson)
-- All new columns are nullable (or have defaults) — fully non-breaking.

-- ── Tender: extended client / procuring-entity metadata ──────────────────────
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "clientCity"              TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "clientWebsite"           TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "submissionEmailSubject"  TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "preBidChannel"           TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "clientRepresentative"    TEXT;

-- ── Tender: source-audit fields ───────────────────────────────────────────────
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "clientNameSourceQuote"       TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "contactDetailsSourceJson"    TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "evaluationCriteriaSourceJson" TEXT;

-- ── TenderRequirement: per-requirement source traceability ────────────────────
ALTER TABLE "TenderRequirement" ADD COLUMN IF NOT EXISTS "sourceTenderFileId"   TEXT;
ALTER TABLE "TenderRequirement" ADD COLUMN IF NOT EXISTS "sourcePageNumber"     INTEGER;
ALTER TABLE "TenderRequirement" ADD COLUMN IF NOT EXISTS "sourceSectionHeading" TEXT;
ALTER TABLE "TenderRequirement" ADD COLUMN IF NOT EXISTS "sourceExactQuote"     TEXT;
ALTER TABLE "TenderRequirement" ADD COLUMN IF NOT EXISTS "sourceConfidence"     DOUBLE PRECISION NOT NULL DEFAULT 0;

-- ── TenderFile: additional extraction-detail fields ───────────────────────────
ALTER TABLE "TenderFile" ADD COLUMN IF NOT EXISTS "ocrModel"       TEXT;
ALTER TABLE "TenderFile" ADD COLUMN IF NOT EXISTS "pageStatusJson" TEXT;
