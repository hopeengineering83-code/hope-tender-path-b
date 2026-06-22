-- OBS-004: per-tenant AI usage tracking for cost monitoring.
-- Stores only safe metadata (provider, use case, token counts, latency,
-- success/failure category). Never stores API keys, prompts, or responses.

CREATE TABLE IF NOT EXISTS "AiUsageRecord" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  "tenderId" TEXT,
  "jobId" TEXT,
  "provider" TEXT NOT NULL,
  "useCase" TEXT NOT NULL,
  "model" TEXT,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "latencyMs" INTEGER NOT NULL DEFAULT 0,
  "success" BOOLEAN NOT NULL DEFAULT false,
  "failureCategory" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AiUsageRecord_userId_createdAt_idx" ON "AiUsageRecord" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiUsageRecord_tenderId_createdAt_idx" ON "AiUsageRecord" ("tenderId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiUsageRecord_provider_createdAt_idx" ON "AiUsageRecord" ("provider", "createdAt");
