-- CreateTable
CREATE TABLE IF NOT EXISTS "TenderMetadataOverride" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "fieldState" TEXT NOT NULL,
    "overrideValue" TEXT,
    "reason" TEXT,
    "previousValue" TEXT,
    "overriddenBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenderMetadataOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TenderMetadataOverride_tenderId_field_key" ON "TenderMetadataOverride"("tenderId", "field");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TenderMetadataOverride_tenderId_idx" ON "TenderMetadataOverride"("tenderId");

-- AddForeignKey
ALTER TABLE "TenderMetadataOverride" ADD CONSTRAINT "TenderMetadataOverride_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "Tender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderMetadataOverride" ADD CONSTRAINT "TenderMetadataOverride_overriddenBy_fkey" FOREIGN KEY ("overriddenBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
