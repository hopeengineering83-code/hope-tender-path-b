-- Legal/Financial/Compliance records had no trustLevel/review/provenance
-- concept at all: every record (manual create AND Plan-B bulk import) was
-- fed directly into generation evidence with zero gating, unlike
-- Expert/Project which require trustLevel = 'REVIEWED'. This adds the same
-- durable-provenance fields Expert/Project already have so
-- lib/vault-review-provenance.ts's evidence gate can cover these three
-- record types too.

ALTER TABLE "LegalRecord"
  ADD COLUMN "trustLevel" TEXT NOT NULL DEFAULT 'AI_DRAFT',
  ADD COLUMN "reviewedBy" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewNotes" TEXT,
  ADD COLUMN "sourceDocumentId" TEXT;

ALTER TABLE "FinancialRecord"
  ADD COLUMN "trustLevel" TEXT NOT NULL DEFAULT 'AI_DRAFT',
  ADD COLUMN "reviewedBy" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewNotes" TEXT,
  ADD COLUMN "sourceDocumentId" TEXT;

ALTER TABLE "CompanyComplianceRecord"
  ADD COLUMN "trustLevel" TEXT NOT NULL DEFAULT 'AI_DRAFT',
  ADD COLUMN "reviewedBy" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewNotes" TEXT,
  ADD COLUMN "sourceDocumentId" TEXT;

-- Existing rows (created before this migration, with no trust concept at
-- all) get the column DEFAULT 'AI_DRAFT' applied by ADD COLUMN itself —
-- assuming REVIEWED without durable provenance is not safe.

ALTER TABLE "LegalRecord"
  ADD CONSTRAINT "LegalRecord_sourceDocumentId_fkey"
  FOREIGN KEY ("sourceDocumentId") REFERENCES "CompanyDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinancialRecord"
  ADD CONSTRAINT "FinancialRecord_sourceDocumentId_fkey"
  FOREIGN KEY ("sourceDocumentId") REFERENCES "CompanyDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CompanyComplianceRecord"
  ADD CONSTRAINT "CompanyComplianceRecord_sourceDocumentId_fkey"
  FOREIGN KEY ("sourceDocumentId") REFERENCES "CompanyDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "LegalRecord_companyId_idx" ON "LegalRecord"("companyId");
CREATE INDEX "LegalRecord_trustLevel_idx" ON "LegalRecord"("trustLevel");

CREATE INDEX "FinancialRecord_companyId_idx" ON "FinancialRecord"("companyId");
CREATE INDEX "FinancialRecord_trustLevel_idx" ON "FinancialRecord"("trustLevel");

CREATE INDEX "CompanyComplianceRecord_companyId_idx" ON "CompanyComplianceRecord"("companyId");
CREATE INDEX "CompanyComplianceRecord_trustLevel_idx" ON "CompanyComplianceRecord"("trustLevel");
