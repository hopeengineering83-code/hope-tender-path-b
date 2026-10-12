-- Blocker 5: Plan B staging model
-- Synthetic JSON artifacts from Plan B import must NEVER become an official
-- CompanyDocument source. This table stores diagnostic-only staging data.
CREATE TABLE "PlanBStaging" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceCategory" TEXT,
    "normalizedCategory" TEXT,
    "rawText" TEXT,
    "parsedExperts" INTEGER,
    "parsedProjects" INTEGER,
    "suppliedSha256" TEXT,
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanBStaging_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanBStaging_companyId_idx" ON "PlanBStaging"("companyId");

-- CreateIndex
CREATE INDEX "PlanBStaging_originalFileName_idx" ON "PlanBStaging"("originalFileName");

-- AddForeignKey
ALTER TABLE "PlanBStaging" ADD CONSTRAINT "PlanBStaging_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
