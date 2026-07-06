-- Additive migration: TenderFactsLedger + TenderSubmissionEmail models
--
-- Creates two new tables for the universal tender facts ledger:
--
-- 1. TenderFactsLedger — replaces the fixed 26-field metadata checklist
--    with a dynamic, extensible fact store. Each fact has a semantic key,
--    display label, category, value type, authority state, source evidence,
--    and audit history.
--
-- 2. TenderSubmissionEmail — per-email source provenance for submission
--    emails, replacing the pipe-joined string with structured per-email
--    records.
--
-- Both tables are additive — no existing columns are modified.
-- Legacy Tender scalar columns remain as backward-compatible projections.

CREATE TABLE "TenderFactsLedger" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "semanticKey" TEXT NOT NULL,
    "displayLabel" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "valueType" TEXT NOT NULL,
    "normalizedValue" TEXT,
    "rawSourceValue" TEXT,
    "structuredValueJson" TEXT,
    "authorityState" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceStatus" TEXT NOT NULL DEFAULT 'active',
    "relevance" TEXT NOT NULL DEFAULT 'informational',
    "applicability" TEXT NOT NULL DEFAULT 'applies',
    "sourceFileId" TEXT,
    "sourcePage" INTEGER,
    "sourceQuote" TEXT,
    "sourceContentHash" TEXT,
    "reviewState" TEXT NOT NULL DEFAULT 'pending',
    "manuallyEntered" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "confirmationBasis" TEXT,
    "createdBy" TEXT NOT NULL,
    "confirmedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "supersededById" TEXT,

    CONSTRAINT "TenderFactsLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenderFactsLedger_tenderId_semanticKey_key" ON "TenderFactsLedger"("tenderId", "semanticKey");
CREATE INDEX "TenderFactsLedger_tenderId_idx" ON "TenderFactsLedger"("tenderId");
CREATE INDEX "TenderFactsLedger_tenderId_category_idx" ON "TenderFactsLedger"("tenderId", "category");
CREATE INDEX "TenderFactsLedger_tenderId_authorityState_idx" ON "TenderFactsLedger"("tenderId", "authorityState");

ALTER TABLE "TenderFactsLedger" ADD CONSTRAINT "TenderFactsLedger_tenderId_fkey"
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TenderSubmissionEmail" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "sourceFileId" TEXT,
    "sourcePage" INTEGER,
    "sourceQuote" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenderSubmissionEmail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenderSubmissionEmail_tenderId_email_key" ON "TenderSubmissionEmail"("tenderId", "email");
CREATE INDEX "TenderSubmissionEmail_tenderId_idx" ON "TenderSubmissionEmail"("tenderId");

ALTER TABLE "TenderSubmissionEmail" ADD CONSTRAINT "TenderSubmissionEmail_tenderId_fkey"
    FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
