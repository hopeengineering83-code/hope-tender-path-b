-- AiAnalyzeChunk gained "failureCategory" and "jobId" in schema.prisma, but no
-- migration ever added them. Databases created by the init migration or the
-- 20260611000000 migration therefore lack both columns. Because the generated
-- Prisma client selects every model column on findMany, getAnalyzeCheckpoints
-- failed with P2022 (column does not exist), surfacing as the Recovery Command
-- Center error "Checkpoint getAnalyzeCheckpoints failed:
-- PrismaClientKnownRequestError" and hard-blocking AI Analyze. Add the columns
-- (and the jobId FK + index) idempotently so existing data is preserved.

ALTER TABLE "AiAnalyzeChunk" ADD COLUMN IF NOT EXISTS "failureCategory" TEXT;
ALTER TABLE "AiAnalyzeChunk" ADD COLUMN IF NOT EXISTS "jobId" TEXT;

CREATE INDEX IF NOT EXISTS "AiAnalyzeChunk_jobId_idx" ON "AiAnalyzeChunk"("jobId");

-- Re-establish the foreign key to AiJob (ON DELETE CASCADE) only when it is not
-- already present, so re-running the migration is safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AiAnalyzeChunk_jobId_fkey'
  ) THEN
    ALTER TABLE "AiAnalyzeChunk"
      ADD CONSTRAINT "AiAnalyzeChunk_jobId_fkey"
      FOREIGN KEY ("jobId") REFERENCES "AiJob"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
