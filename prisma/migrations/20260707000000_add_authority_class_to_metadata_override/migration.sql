-- Additive migration: add authority model columns to TenderMetadataOverride
--
-- Adds three nullable columns to support the manual tender facts
-- flexibility authority model:
--
--   authorityClass    — the authority class of the override
--   confirmationBasis — the external source the user cited
--   confirmedAt       — when the user confirmed the value
--
-- All three are nullable so existing override rows continue to work
-- (they're treated as HUMAN_CONFIRMED_OPERATIONAL with unknown basis
-- by the authority classifier, which is non-blocking for draft work
-- and only blocks final export for submission-critical fields without
-- a sufficient audit).

ALTER TABLE "TenderMetadataOverride" ADD COLUMN "authorityClass" TEXT;
ALTER TABLE "TenderMetadataOverride" ADD COLUMN "confirmationBasis" TEXT;
ALTER TABLE "TenderMetadataOverride" ADD COLUMN "confirmedAt" TIMESTAMP(3);
