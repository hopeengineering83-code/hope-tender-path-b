-- Phase 5: Worker Hardening + Cold Restart
-- Add lease management fields for worker coordination

ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "leaseOwner" TEXT;
ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3);
ALTER TABLE "AiJob" ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3);

-- Index for finding jobs with expired leases
CREATE INDEX IF NOT EXISTS "AiJob_leaseExpiresAt_status_idx" ON "AiJob"("leaseExpiresAt", "status");

-- Index for finding jobs ready for next attempt
CREATE INDEX IF NOT EXISTS "AiJob_nextAttemptAt_status_idx" ON "AiJob"("nextAttemptAt", "status");
