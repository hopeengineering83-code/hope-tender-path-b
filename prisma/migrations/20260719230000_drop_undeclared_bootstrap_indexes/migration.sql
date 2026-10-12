-- Drop the three indexes the runtime bootstrap used to create outside the
-- migration history. Databases that only ever ran migrations never had them;
-- databases that BOOTED the app (production included) accumulated them and
-- then failed the release zero-drift check, and the two unique ones doubled
-- write-side index maintenance by duplicating the Prisma-declared constraints
-- ("MatchScoreBreakdown_..._dimensionC_key" and
--  "SectionEvidenceMap_tenderId_proposalVersion_sectionId_key", which remain
-- and continue to enforce the same uniqueness).
-- "DocumentComment_documentId_idx" is covered by the schema-declared
-- composite indexes ("documentId","createdAt") and ("documentId","parentId").
-- The bootstrap statements themselves were removed in the same release
-- (see tests/bootstrap-index-migration-parity.test.ts), so the indexes can
-- never be re-created.

DROP INDEX IF EXISTS "DocumentComment_documentId_idx";
DROP INDEX IF EXISTS "MatchScoreBreakdown_unique_dim";
DROP INDEX IF EXISTS "SectionEvidenceMap_unique_section";
