-- Durable AI Analyze jobs (additive migration).
--
-- Adds two nullable columns to AiAnalyzeChunk to support durable,
-- resumable, atomic-chunk-claim AI analysis:
--
--   1. claimedAt — set atomically when a worker claims the chunk via
--      FOR UPDATE SKIP LOCKED. A stale claim (claimedAt older than the
--      stuck threshold) can be re-claimed by another worker, making the
--      system resilient to browser interruptions and Vercel function
--      timeouts.
--
--   2. failureCategory — stores the SAFE classification only (never raw
--      provider error bodies). Values: RATE_LIMITED | TIMEOUT |
--      UNAUTHORIZED | MODEL_UNAVAILABLE | NETWORK_ERROR | UNKNOWN.
--
-- Also adds a composite index for the atomic claim query:
--   (tenderId, userId, contentHash, status)
-- which lets the claim query find the oldest QUEUED chunk for a job
-- without scanning all chunks for the tender.
--
-- This migration is ADDITIVE (ALTER TABLE ADD COLUMN + CREATE INDEX) —
-- no data is touched, no locks held beyond the brief metadata lock.
-- Both columns are nullable so existing rows (from the old single-route
-- AI Analyze) continue to work without backfill.

-- claimedAt — nullable, defaults to NULL (existing rows have no claim)
ALTER TABLE "AiAnalyzeChunk" ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3);

-- failureCategory — nullable, defaults to NULL (existing rows have no category)
ALTER TABLE "AiAnalyzeChunk" ADD COLUMN IF NOT EXISTS "failureCategory" TEXT;

-- Composite index for the atomic claim query
CREATE INDEX IF NOT EXISTS "AiAnalyzeChunk_tenderId_userId_contentHash_status_idx"
  ON "AiAnalyzeChunk" ("tenderId", "userId", "contentHash", "status");
