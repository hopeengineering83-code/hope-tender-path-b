-- AlterTable: add SHA-256 digest + byte size columns for file byte integrity
ALTER TABLE "GeneratedDocument" ADD COLUMN "sha256" TEXT;
ALTER TABLE "GeneratedDocument" ADD COLUMN "byteSize" INTEGER;
ALTER TABLE "TenderFile" ADD COLUMN "sha256" TEXT;
ALTER TABLE "TenderFile" ADD COLUMN "byteSize" INTEGER;
