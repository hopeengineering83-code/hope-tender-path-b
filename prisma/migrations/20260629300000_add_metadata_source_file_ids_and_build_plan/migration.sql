-- Add sourceFileId columns to Tender for metadata source traceability
ALTER TABLE "Tender" ADD COLUMN "clientNameSourceFileId" TEXT;
ALTER TABLE "Tender" ADD COLUMN "submissionMethodSourceFileId" TEXT;
ALTER TABLE "Tender" ADD COLUMN "submissionAddressSourceFileId" TEXT;
ALTER TABLE "Tender" ADD COLUMN "submissionEmailSourceFileId" TEXT;

-- Create BuildPlan table for persisting submission plans bound to content hash
CREATE TABLE "BuildPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenderId" TEXT NOT NULL UNIQUE,
    "contentHash" TEXT NOT NULL,
    "filesList" TEXT NOT NULL DEFAULT '[]',
    "plannedDocuments" TEXT NOT NULL DEFAULT '[]',
    "planType" TEXT NOT NULL DEFAULT 'DERIVED',
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BuildPlan_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender" ("id") ON DELETE CASCADE
);

-- Create index for BuildPlan content hash lookups
CREATE INDEX "BuildPlan_contentHash_idx" ON "BuildPlan"("contentHash");
