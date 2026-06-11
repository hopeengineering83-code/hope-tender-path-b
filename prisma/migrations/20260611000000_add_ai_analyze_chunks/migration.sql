CREATE TABLE IF NOT EXISTS "AiAnalyzeChunk" (
  "id" TEXT NOT NULL,
  "tenderId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "totalChunks" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "provider" TEXT,
  "resultJson" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AiAnalyzeChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiAnalyzeChunk_tenderId_userId_contentHash_chunkIndex_key"
  ON "AiAnalyzeChunk"("tenderId", "userId", "contentHash", "chunkIndex");

CREATE INDEX IF NOT EXISTS "AiAnalyzeChunk_tenderId_userId_contentHash_idx"
  ON "AiAnalyzeChunk"("tenderId", "userId", "contentHash");

CREATE INDEX IF NOT EXISTS "AiAnalyzeChunk_status_idx"
  ON "AiAnalyzeChunk"("status");
