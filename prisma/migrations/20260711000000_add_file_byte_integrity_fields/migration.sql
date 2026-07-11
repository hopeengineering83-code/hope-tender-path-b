-- Additive nullable fields for file byte integrity (SHA-256 digest + size).
-- Legacy rows remain valid — NULL means "no digest stored yet".
-- Final ZIP/download must block required files with NULL digest.

-- TenderFile: source file integrity
ALTER TABLE "TenderFile" ADD COLUMN IF NOT EXISTS "sha256" TEXT;
ALTER TABLE IF NOT EXISTS "TenderFile" ADD COLUMN IF NOT EXISTS "sizeBytes" INTEGER;
ALTER TABLE IF NOT EXISTS "TenderFile" ADD COLUMN IF NOT EXISTS "storageProvider" TEXT;

-- GeneratedDocument: generated document integrity
ALTER TABLE "GeneratedDocument" ADD COLUMN IF NOT EXISTS "sha256" TEXT;
ALTER TABLE IF NOT EXISTS "GeneratedDocument" ADD COLUMN IF NOT EXISTS "sizeBytes" INTEGER;

-- CompanyAsset: company asset integrity (logos, letterheads, stamps, signatures)
ALTER TABLE "CompanyAsset" ADD COLUMN IF NOT EXISTS "sha256" TEXT;
ALTER TABLE IF NOT EXISTS "CompanyAsset" ADD COLUMN IF NOT EXISTS "sizeBytes" INTEGER;

-- Create indexes for digest lookup (not unique — multiple files can have same content)
CREATE INDEX IF NOT EXISTS "TenderFile_sha256_idx" ON "TenderFile"("sha256");
CREATE INDEX IF NOT EXISTS "GeneratedDocument_sha256_idx" ON "GeneratedDocument"("sha256");
CREATE INDEX IF NOT EXISTS "CompanyAsset_sha256_idx" ON "CompanyAsset"("sha256");
