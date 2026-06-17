-- CreateTable
CREATE TABLE IF NOT EXISTS "TenderCopilotMessage" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenderCopilotMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TenderCopilotMessage_tenderId_userId_createdAt_idx" ON "TenderCopilotMessage"("tenderId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TenderCopilotMessage_tenderId_userId_idx" ON "TenderCopilotMessage"("tenderId", "userId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TenderCopilotMessage_tenderId_fkey') THEN
    ALTER TABLE "TenderCopilotMessage" ADD CONSTRAINT "TenderCopilotMessage_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
