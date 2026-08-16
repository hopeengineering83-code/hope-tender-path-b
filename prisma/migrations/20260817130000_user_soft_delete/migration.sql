-- Audit C-5: Add User soft-delete to prevent cascade destruction of tender history
--
-- Previously User → Tender used onDelete: Cascade, so deleting a user destroyed
-- every tender, generated document, audit log entry, and review they ever created.
-- This migration adds deletedAt + deletedBy columns to User and changes the
-- Tender.user relation to onDelete: Restrict so the DB refuses to hard-delete a
-- user with active tenders. The application layer (DELETE /api/users/[id]) now
-- performs a soft-delete: sets deletedAt + revoked sessions, but the row survives.
--
-- This is backward-compatible: existing users have deletedAt = NULL (active).
-- The auth layer (lib/auth.ts getCurrentUser) rejects soft-deleted users.

-- 1. Add deletedAt + deletedBy columns (nullable for existing rows)
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "deletedBy" TEXT;

-- 2. Add an index on deletedAt for efficient "active users" queries
CREATE INDEX "User_deletedAt_idx" ON "User" ("deletedAt");

-- 3. Change Tender.user onDelete from Cascade to Restrict.
--    This prevents accidental hard-deletes of users with tenders. The
--    application layer's soft-delete path does not trigger this constraint
--    because it UPDATEs (sets deletedAt) rather than DELETEing.
--    We must drop the existing FK constraint first, then recreate it.
ALTER TABLE "Tender" DROP CONSTRAINT "Tender_userId_fkey";
ALTER TABLE "Tender" ADD CONSTRAINT "Tender_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT;
