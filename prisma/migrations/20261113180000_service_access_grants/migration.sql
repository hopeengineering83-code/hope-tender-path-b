-- Revocable, tenant-bound, read-only service access grants (first client: HOPE ONE AGENT).
-- Additive only: a new table, its indexes and a foreign key to "User". Nothing existing changes.
-- Only the SHA-256 hash of each 256-bit token is stored. The CHECK constraints are a second line
-- of defence behind lib/service-access.ts: an unknown audience or scope, a malformed hash or an
-- expiry outside (createdAt, createdAt + 90 days] cannot be written even by a buggy caller.
-- CreateTable
CREATE TABLE "ServiceAccessGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "useCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ServiceAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceAccessGrant_tokenHash_key" ON "ServiceAccessGrant"("tokenHash");

-- CreateIndex
CREATE INDEX "ServiceAccessGrant_userId_idx" ON "ServiceAccessGrant"("userId");

-- CreateIndex
CREATE INDEX "ServiceAccessGrant_expiresAt_idx" ON "ServiceAccessGrant"("expiresAt");

-- AddForeignKey
ALTER TABLE "ServiceAccessGrant" ADD CONSTRAINT "ServiceAccessGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddCheckConstraints
ALTER TABLE "ServiceAccessGrant" ADD CONSTRAINT "ServiceAccessGrant_tokenHash_format"
    CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "ServiceAccessGrant" ADD CONSTRAINT "ServiceAccessGrant_audience_known"
    CHECK ("audience" IN ('hope-one-agent'));
ALTER TABLE "ServiceAccessGrant" ADD CONSTRAINT "ServiceAccessGrant_scope_known"
    CHECK ("scope" IN ('tenders:status:read'));
ALTER TABLE "ServiceAccessGrant" ADD CONSTRAINT "ServiceAccessGrant_expiry_bounded"
    CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + INTERVAL '90 days');
ALTER TABLE "ServiceAccessGrant" ADD CONSTRAINT "ServiceAccessGrant_label_length"
    CHECK ("label" IS NULL OR char_length("label") <= 120);
ALTER TABLE "ServiceAccessGrant" ADD CONSTRAINT "ServiceAccessGrant_useCount_nonnegative"
    CHECK ("useCount" >= 0);
