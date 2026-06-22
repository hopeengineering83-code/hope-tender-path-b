-- Phase 5: Worker Hardening + Cold Restart
-- Add lease management fields for worker coordination

ALTER TABLE "AiJob" ADD COLUMN "leaseOwner" TEXT;
ALTER TABLE "AiJob" ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);
ALTER TABLE "AiJob" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

-- Index for finding jobs with expired leases
CREATE INDEX "AiJob_leaseExpiresAt_status_idx" ON "AiJob"("leaseExpiresAt", "status");

-- Index for finding jobs ready for next attempt
CREATE INDEX "AiJob_nextAttemptAt_status_idx" ON "AiJob"("nextAttemptAt", "status");
