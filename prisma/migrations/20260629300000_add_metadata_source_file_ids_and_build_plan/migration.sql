-- Add sourceFileId columns to Tender for metadata source traceability
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "clientNameSourceFileId" TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "submissionMethodSourceFileId" TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "submissionAddressSourceFileId" TEXT;
ALTER TABLE "Tender" ADD COLUMN IF NOT EXISTS "submissionEmailSourceFileId" TEXT;

-- CreateTable: BuildPlan persists submission plans bound to content hash
CREATE TABLE IF NOT EXISTS "BuildPlan" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "filesList" TEXT NOT NULL DEFAULT '[]',
    "plannedDocuments" TEXT NOT NULL DEFAULT '[]',
    "planType" TEXT NOT NULL DEFAULT 'DERIVED',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuildPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique constraint on tenderId (one plan per tender)
CREATE UNIQUE INDEX IF NOT EXISTS "BuildPlan_tenderId_key" ON "BuildPlan"("tenderId");

-- CreateIndex: content hash lookups
CREATE INDEX IF NOT EXISTS "BuildPlan_contentHash_idx" ON "BuildPlan"("contentHash");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'BuildPlan_tenderId_fkey'
  ) THEN
    ALTER TABLE "BuildPlan"
    ADD CONSTRAINT "BuildPlan_tenderId_fkey"
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
