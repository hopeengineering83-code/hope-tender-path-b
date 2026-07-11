-- Persisted actual-byte integrity for every release-relevant file class.
-- Existing rows intentionally remain UNKNOWN until their bytes are re-read and
-- verified; no legacy row is silently trusted.

ALTER TABLE "TenderFile"
  ADD COLUMN "contentSha256" TEXT,
  ADD COLUMN "contentByteLength" INTEGER,
  ADD COLUMN "contentMimeType" TEXT,
  ADD COLUMN "detectedFormat" TEXT,
  ADD COLUMN "integrityStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "integrityVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "integrityFailureCode" TEXT;

ALTER TABLE "CompanyDocument"
  ADD COLUMN "contentSha256" TEXT,
  ADD COLUMN "contentByteLength" INTEGER,
  ADD COLUMN "contentMimeType" TEXT,
  ADD COLUMN "detectedFormat" TEXT,
  ADD COLUMN "integrityStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "integrityVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "integrityFailureCode" TEXT;

ALTER TABLE "CompanyAsset"
  ADD COLUMN "contentSha256" TEXT,
  ADD COLUMN "contentByteLength" INTEGER,
  ADD COLUMN "contentMimeType" TEXT,
  ADD COLUMN "detectedFormat" TEXT,
  ADD COLUMN "integrityStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "integrityVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "integrityFailureCode" TEXT;

ALTER TABLE "GeneratedDocument"
  ADD COLUMN "contentSha256" TEXT,
  ADD COLUMN "contentByteLength" INTEGER,
  ADD COLUMN "contentMimeType" TEXT,
  ADD COLUMN "detectedFormat" TEXT,
  ADD COLUMN "integrityStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "integrityVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "integrityFailureCode" TEXT;

CREATE INDEX "TenderFile_integrityStatus_idx" ON "TenderFile"("integrityStatus");
CREATE INDEX "CompanyDocument_integrityStatus_idx" ON "CompanyDocument"("integrityStatus");
CREATE INDEX "CompanyAsset_integrityStatus_idx" ON "CompanyAsset"("integrityStatus");
CREATE INDEX "GeneratedDocument_integrityStatus_idx" ON "GeneratedDocument"("integrityStatus");
