-- The owner's pricing rate card (lib/engine/pricing-benchmarks.ts).
--
-- Each row is a sourced, dated rate the estimator reads for every tender, so
-- the owner enters a rate once instead of on each tender. Additive: a new
-- table only; no existing row or column changes. Until it exists the
-- estimator uses the shipped public benchmarks alone.
CREATE TABLE IF NOT EXISTS "PricingBenchmark" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'ET',
    "category" TEXT NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "seniority" TEXT,
    "unit" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "median" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "rateBasis" TEXT NOT NULL DEFAULT 'FEE',
    "effectiveDate" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'OWNER_RATE_CARD',
    "confidence" TEXT NOT NULL DEFAULT 'HIGH',
    "notes" TEXT,
    "lastVerified" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingBenchmark_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PricingBenchmark_companyId_category_idx" ON "PricingBenchmark"("companyId", "category");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PricingBenchmark_companyId_fkey') THEN
    ALTER TABLE "PricingBenchmark" ADD CONSTRAINT "PricingBenchmark_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
