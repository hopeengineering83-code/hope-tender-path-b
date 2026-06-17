-- Migration: add_tender_share
-- Adds the TenderShare model for share-link collaboration.
-- External reviewers can access a read-only view of a tender via a token URL.

CREATE TABLE IF NOT EXISTS "TenderShare" (
  "id"          TEXT NOT NULL,
  "tenderId"    TEXT NOT NULL,
  "token"       TEXT NOT NULL,
  "label"       TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"   TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  CONSTRAINT "TenderShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TenderShare_token_key" ON "TenderShare"("token");
CREATE INDEX IF NOT EXISTS "TenderShare_tenderId_idx" ON "TenderShare"("tenderId");
CREATE INDEX IF NOT EXISTS "TenderShare_token_idx" ON "TenderShare"("token");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TenderShare_tenderId_fkey'
  ) THEN
    ALTER TABLE "TenderShare" ADD CONSTRAINT "TenderShare_tenderId_fkey"
      FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TenderShare_createdById_fkey'
  ) THEN
    ALTER TABLE "TenderShare" ADD CONSTRAINT "TenderShare_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
