-- CreateTable
CREATE TABLE "AiAnalyzeRetryState" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMPTZ,
    "retryReason" TEXT NOT NULL,
    "failureCategory" TEXT NOT NULL,
    "nonRetryable" BOOLEAN NOT NULL DEFAULT false,
    "lastProviderAvailable" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AiAnalyzeRetryState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiAnalyzeRetryState_jobId_key" ON "AiAnalyzeRetryState"("jobId");

-- CreateIndex
CREATE INDEX "AiAnalyzeRetryState_tenderId_contentHash_idx" ON "AiAnalyzeRetryState"("tenderId", "contentHash");

-- CreateIndex
CREATE INDEX "AiAnalyzeRetryState_nextRetryAt_idx" ON "AiAnalyzeRetryState"("nextRetryAt");

-- CreateIndex
CREATE INDEX "AiAnalyzeRetryState_nonRetryable_nextRetryAt_idx" ON "AiAnalyzeRetryState"("nonRetryable", "nextRetryAt");
