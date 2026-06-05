-- CreateTable
CREATE TABLE "TenderCopilotMessage" (
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
CREATE INDEX "TenderCopilotMessage_tenderId_userId_createdAt_idx" ON "TenderCopilotMessage"("tenderId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "TenderCopilotMessage_tenderId_userId_idx" ON "TenderCopilotMessage"("tenderId", "userId");

-- AddForeignKey
ALTER TABLE "TenderCopilotMessage" ADD CONSTRAINT "TenderCopilotMessage_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
