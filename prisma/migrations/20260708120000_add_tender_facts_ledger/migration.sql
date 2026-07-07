-- CreateTable
CREATE TABLE "TenderFact" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "semanticKey" TEXT NOT NULL,
    "displayLabel" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "valueType" TEXT NOT NULL,
    "normalizedValue" TEXT,
    "rawSourceValue" TEXT,
    "structuredValue" JSONB,
    "authorityState" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "relevance" TEXT,
    "applicability" BOOLEAN NOT NULL DEFAULT true,
    "sourceFileId" TEXT,
    "sourcePage" INTEGER,
    "sourceSheet" TEXT,
    "sourceRow" INTEGER,
    "sourceQuote" TEXT,
    "sourceHash" TEXT,
    "reviewState" TEXT NOT NULL DEFAULT 'PENDING',
    "auditHistory" JSONB,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "manualReason" TEXT,
    "manualBasis" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenderFact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TenderFact_tenderId_semanticKey_key" ON "TenderFact"("tenderId", "semanticKey");
CREATE INDEX "TenderFact_tenderId_idx" ON "TenderFact"("tenderId");

ALTER TABLE "TenderFact" ADD CONSTRAINT "TenderFact_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
