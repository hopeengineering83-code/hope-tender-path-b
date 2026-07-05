-- Fix: AiUsageRecord.tenderId has NO foreign key constraint in the database.
-- The Prisma schema declares onDelete: SetNull, but the migration that
-- created the table (20260620160000) never created the FK constraint.
-- This causes Tender deletion to fail because Prisma expects the FK to exist.

-- Add the missing FK constraint (IF NOT EXISTS for idempotency).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'AiUsageRecord_tenderId_fkey'
  ) THEN
    ALTER TABLE "AiUsageRecord"
    ADD CONSTRAINT "AiUsageRecord_tenderId_fkey"
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
