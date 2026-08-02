-- Plan B repair: convert legacy fabricated "SYSTEM_AUTO_VERIFIED" REVIEWED
-- rows back to machine SOURCE_VERIFIED with no reviewer identity, or — when
-- the row's reviewNotes cannot be re-interpreted as source-verification
-- provenance — reset the row to AI_DRAFT so the next automatic verification
-- pass re-decides from scratch.
--
-- Background
-- ----------
-- `lib/company-auto-verification.ts` previously wrote:
--     trustLevel = 'REVIEWED', reviewedBy = 'SYSTEM_AUTO_VERIFIED',
--     reviewedAt = <now>, reviewNotes = <source-verification provenance>
-- on every record it could machine-verify against owned source bytes. The
-- trust model treats REVIEWED as a genuine human-approval state
-- (`isDurablyReviewed` requires a non-empty `reviewedBy` that matches the
-- reviewer id inside the persisted review provenance), so the only reason
-- those rows were usable at runtime was that consumers were branch-coded
-- to also accept SOURCE_VERIFIED. The OR clauses in
-- `autoVerifyCompanyKnowledge` kept re-matching and re-writing them on
-- every ingest — a perpetual crutch that preserved a fabricated
-- human-approval state forever.
--
-- Plan B removes the OR branch from the application code (so automation
-- never accepts or re-touches REVIEWED) and runs this one-shot migration
-- to convert any existing fabricated rows. After this migration:
--
--   * `trustLevel = 'REVIEWED'` is reserved for genuine human approval
--     (the `reviewedBy` value is a real user id, never 'SYSTEM_AUTO_VERIFIED').
--   * Machine source verification lives entirely under
--     `trustLevel = 'SOURCE_VERIFIED'` with `reviewedBy = NULL` and
--     `reviewedAt = NULL`.
--   * Rows whose persisted provenance cannot be re-interpreted as
--     source-verification evidence (because the source bytes, extraction
--     revision, or bound field values have since changed) are reset to
--     `trustLevel = 'AI_DRAFT'` so the next automatic verification pass
--     re-decides. Their `sourceDocumentId` link is preserved.
--
-- Idempotency
-- -----------
-- Both UPDATE statements are predicate-guarded on
-- `reviewedBy = 'SYSTEM_AUTO_VERIFIED'` and `trustLevel = 'REVIEWED'`, so
-- re-running the migration is a no-op. After the migration runs once,
-- no row in any of the five tables can ever match that fingerprint again
-- (the application code path that produced it has been removed).

-- Experts
UPDATE "Expert"
SET
  "trustLevel"  = CASE
    WHEN "reviewNotes" IS NOT NULL
     AND "reviewNotes" LIKE 'vault-source-verification:v1:%'
    THEN 'SOURCE_VERIFIED'
    ELSE 'AI_DRAFT'
  END,
  "reviewedBy"   = NULL,
  "reviewedAt"   = NULL,
  "updatedAt"    = NOW()
WHERE "trustLevel" = 'REVIEWED'
  AND "reviewedBy" = 'SYSTEM_AUTO_VERIFIED';

-- Projects
UPDATE "Project"
SET
  "trustLevel"  = CASE
    WHEN "reviewNotes" IS NOT NULL
     AND "reviewNotes" LIKE 'vault-source-verification:v1:%'
    THEN 'SOURCE_VERIFIED'
    ELSE 'AI_DRAFT'
  END,
  "reviewedBy"   = NULL,
  "reviewedAt"   = NULL,
  "updatedAt"    = NOW()
WHERE "trustLevel" = 'REVIEWED'
  AND "reviewedBy" = 'SYSTEM_AUTO_VERIFIED';

-- LegalRecord
UPDATE "LegalRecord"
SET
  "trustLevel"  = CASE
    WHEN "reviewNotes" IS NOT NULL
     AND "reviewNotes" LIKE 'vault-source-verification:v1:%'
    THEN 'SOURCE_VERIFIED'
    ELSE 'AI_DRAFT'
  END,
  "reviewedBy"   = NULL,
  "reviewedAt"   = NULL,
  "updatedAt"    = NOW()
WHERE "trustLevel" = 'REVIEWED'
  AND "reviewedBy" = 'SYSTEM_AUTO_VERIFIED';

-- FinancialRecord
UPDATE "FinancialRecord"
SET
  "trustLevel"  = CASE
    WHEN "reviewNotes" IS NOT NULL
     AND "reviewNotes" LIKE 'vault-source-verification:v1:%'
    THEN 'SOURCE_VERIFIED'
    ELSE 'AI_DRAFT'
  END,
  "reviewedBy"   = NULL,
  "reviewedAt"   = NULL,
  "updatedAt"    = NOW()
WHERE "trustLevel" = 'REVIEWED'
  AND "reviewedBy" = 'SYSTEM_AUTO_VERIFIED';

-- CompanyComplianceRecord
UPDATE "CompanyComplianceRecord"
SET
  "trustLevel"  = CASE
    WHEN "reviewNotes" IS NOT NULL
     AND "reviewNotes" LIKE 'vault-source-verification:v1:%'
    THEN 'SOURCE_VERIFIED'
    ELSE 'AI_DRAFT'
  END,
  "reviewedBy"   = NULL,
  "reviewedAt"   = NULL,
  "updatedAt"    = NOW()
WHERE "trustLevel" = 'REVIEWED'
  AND "reviewedBy" = 'SYSTEM_AUTO_VERIFIED';
