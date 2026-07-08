-- Durable tender workflow run ledger for idempotent production operations.
-- Backward-compatible: new table only, no existing data mutation.
CREATE TABLE IF NOT EXISTS "TenderWorkflowRun" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "tenderId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "phase" TEXT,
  "inputHash" TEXT,
  "outputHash" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "warningsJson" JSONB,
  "resultJson" JSONB,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TenderWorkflowRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TenderWorkflowRun_companyId_tenderId_operation_idempotencyKey_key"
  ON "TenderWorkflowRun"("companyId", "tenderId", "operation", "idempotencyKey");

CREATE INDEX IF NOT EXISTS "TenderWorkflowRun_companyId_tenderId_operation_status_idx"
  ON "TenderWorkflowRun"("companyId", "tenderId", "operation", "status");

CREATE INDEX IF NOT EXISTS "TenderWorkflowRun_tenderId_createdAt_idx"
  ON "TenderWorkflowRun"("tenderId", "createdAt");
