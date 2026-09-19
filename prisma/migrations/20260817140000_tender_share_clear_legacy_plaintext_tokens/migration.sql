-- Audit C-4 follow-up: clear the legacy plaintext share tokens the hashing
-- migration left behind.
--
-- 20260817120000_tender_share_token_hash added "tokenHash" and backfilled it
-- from every existing plaintext token, but deliberately kept "token" populated
-- "for backward compatibility during the transition window".
--
-- That retention is not needed, and it costs the entire benefit of C-4. The
-- backfill in step 2 of that migration computes
--   encode(digest("token", 'sha256'), 'hex')
-- which is byte-for-byte what lib/tender-share-security.ts hashTenderShareToken
-- produces (createHash("sha256").update(token).digest("hex")). So every legacy
-- row already resolves through the O(1) hash lookup in app/share/[token]/page.tsx
-- the same way a new share does — the plaintext column is never needed to serve
-- a legacy link.
--
-- Meanwhile keeping it leaves precisely the exposure C-4 exists to remove, in
-- that migration's own words: "A DB leak (SQL injection, backup exposure,
-- insider threat) would expose every active share URL instantly." Until the
-- plaintext is gone that sentence is still true for every share created before
-- the hashing migration, and tests/deep-remediation-c3-c4-c5-h6.test.ts asserts
-- "DB leakage cannot produce usable share URLs" while the database still holds
-- the raw tokens.
--
-- Clearing the column closes that window now rather than up to 365 days from
-- now, when the last pre-hash share would finally expire.
--
-- Safety: NULL-ing "token" is non-destructive to functionality. Lookup is by
-- hash; the raw token lives only in the share URL the recipient already holds.
-- The column is nullable (step 4 of the prior migration) and its unique index
-- permits multiple NULLs in PostgreSQL. Rows that somehow have no hash are left
-- untouched, so the plaintext fallback path still serves them.

UPDATE "TenderShare"
SET "token" = NULL
WHERE "tokenHash" IS NOT NULL
  AND "token" IS NOT NULL;
