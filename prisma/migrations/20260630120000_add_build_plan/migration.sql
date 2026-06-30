CREATE TABLE IF NOT EXISTS "BuildPlan" (
  "id" TEXT NOT NULL,
  "tenderId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "contentHash" TEXT NOT NULL,
  "confirmedRevision" INTEGER,
  "confirmedContentHash" TEXT,
  "itemsJson" TEXT NOT NULL DEFAULT '[]',
  "validationJson" TEXT NOT NULL DEFAULT '{}',
  "builtById" TEXT NOT NULL,
  "confirmedById" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BuildPlan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BuildPlan_tenderId_idx" ON "BuildPlan"("tenderId");
CREATE UNIQUE INDEX IF NOT EXISTS "BuildPlan_tenderId_status_key" ON "BuildPlan"("tenderId", "status");
ALTER TABLE "BuildPlan" ADD CONSTRAINT "BuildPlan_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
