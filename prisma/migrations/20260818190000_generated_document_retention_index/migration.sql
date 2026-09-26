-- Retention cleanup scans GeneratedDocument for SUPERSEDED rows older than a
-- cutoff with no tenderId filter, so the existing (tenderId) index cannot serve
-- it. EXPLAIN on a fresh database confirmed a sequential scan over the table
-- that stores base64 document bytes.
--
-- Additive and backward compatible: adds an index, changes no column, no data.
-- IF NOT EXISTS keeps a re-deploy idempotent against a database where an
-- operator already created it by hand.
CREATE INDEX IF NOT EXISTS "GeneratedDocument_generationStatus_updatedAt_idx"
  ON "GeneratedDocument" ("generationStatus", "updatedAt");
