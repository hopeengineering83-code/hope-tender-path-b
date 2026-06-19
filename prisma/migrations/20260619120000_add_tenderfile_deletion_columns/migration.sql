-- Production schema-drift recovery for the TenderFile soft-delete columns.
--
-- The `20260601000000_init` migration defines `TenderFile.lastDeletionError`
-- and `TenderFile.deletedAt`, but production databases that were baselined from
-- an older init (the failed-init retroactive recovery path) are missing them.
-- Because init is already recorded as "applied", Prisma reports "no pending
-- migrations" and never backfills the columns — leaving the live schema drifted
-- from the Prisma schema. Any query that loads TenderFile via `include`
-- (selecting every scalar column) then fails at runtime with
-- `P2022: column "lastDeletionError" does not exist`, which in the AI Analyze
-- path is swallowed and degrades the run to the regex fallback.
--
-- These statements are idempotent: databases that already have the columns
-- (created from the current init) are unaffected by `IF NOT EXISTS`, while
-- drifted production databases get the missing columns added.

ALTER TABLE "TenderFile" ADD COLUMN IF NOT EXISTS "lastDeletionError" TEXT;
ALTER TABLE "TenderFile" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
