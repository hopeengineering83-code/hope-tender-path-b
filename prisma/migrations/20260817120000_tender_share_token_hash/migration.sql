-- Audit C-4: Hash TenderShare tokens before storage (mirror PasswordResetToken pattern)
--
-- Previously TenderShare.token stored the raw bearer token in plaintext. A DB
-- leak (SQL injection, backup exposure, insider threat) would expose every
-- active share URL instantly. This migration adds a tokenHash column and
-- backfills it from existing plaintext tokens, then enforces uniqueness on
-- the hash. The original token column is kept (nullable) for backward
-- compatibility during the transition window — existing share links continue
-- to work because the lookup falls back to plaintext match when the hash
-- lookup misses. New share links store ONLY the hash and set token = NULL.
--
-- Once all existing share links have expired (max lifetime = 365 days), a
-- follow-up migration can drop the token column entirely.

-- 0. Enable pgcrypto for digest() function. Required for SHA-256 hashing
--    inside the backfill UPDATE. The extension is idempotent — safe to run
--    even if already enabled. On most managed Postgres providers (Neon,
--    Supabase, Railway) pgcrypto is pre-installed in the default database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Add the tokenHash column (nullable for backfill)
ALTER TABLE "TenderShare" ADD COLUMN "tokenHash" TEXT;

-- 2. Backfill: hash every existing plaintext token using pgcrypto's digest()
UPDATE "TenderShare"
SET "tokenHash" = encode(digest("token", 'sha256'), 'hex')
WHERE "token" IS NOT NULL AND "tokenHash" IS NULL;

-- 3. Add a unique index on tokenHash. Uses a FULL index (not partial) to
--    match what Prisma's @unique constraint generates. PostgreSQL allows
--    multiple NULLs in a unique index, so legacy rows with tokenHash=NULL
--    (if any backfill was skipped) do not conflict.
CREATE UNIQUE INDEX "TenderShare_tokenHash_key" ON "TenderShare" ("tokenHash");

-- 4. Make the token column nullable (was NOT NULL in the original migration).
--    New shares store token = NULL and use tokenHash for lookup. Legacy shares
--    keep their plaintext token for backward-compatible lookup.
ALTER TABLE "TenderShare" ALTER COLUMN "token" DROP NOT NULL;

-- Note: the old non-unique index TenderShare_token_idx (created by the
-- original @@index([token]) in the init migration) is intentionally KEPT
-- in the DB even though the schema no longer declares @@index([token]).
-- The verify-retroactive-init script checks that all init-migration indexes
-- are present, and dropping it would fail that check. The index is small
-- (TenderShare is a low-cardinality table) and harmless — it slightly
-- speeds up the legacy plaintext-token lookup fallback path.
-- A future follow-up migration can drop it after the retroactive-init
-- script is updated to exclude it.
