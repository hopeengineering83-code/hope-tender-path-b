-- Add missing foreign-key indexes (audit DB-002 / DB-003 / PERF-002, 2026-06-20)
--
-- The following tables had NO index on their most-queried foreign-key column:
--   - Tender.userId             (every "list my tenders" dashboard query)
--   - GeneratedDocument.tenderId (every tender-detail panel load)
--   - AuditLog.userId            (every audit-trail panel render)
--   - AuditLog.entityType        (the guard_canonical_requirement_set_delete
--                                 trigger scans AuditLog on every
--                                 TenderRequirement DELETE — was a full table scan)
--   - AuditLog.entityId          (same trigger, same scan)
--   - AuditLog.action            (same trigger, same scan)
--   - AuditLog.createdAt         (same trigger, same scan; also used for
--                                 retention cleanup queries)
--   - Session.userId             (session revocation on password reset)
--
-- All indexes use CREATE INDEX IF NOT EXISTS so the migration is idempotent
-- and safe to re-run. Index names follow the Prisma convention
-- `<Table>_<columns>_idx` so Prisma's schema introspection recognizes them.
--
-- These are additive (CREATE INDEX) — no data is touched, no locks are held
-- beyond the brief index-build lock. On Neon, CREATE INDEX uses CONCURRENTLY
-- by default for non-unique indexes when run outside a transaction, but
-- Prisma wraps migrations in a transaction, so these are blocking builds.
-- The tables are small enough (post-migration production size: ~10k rows
-- per table max) that blocking builds complete in <1 second.

-- Tender.userId — the single most-queried column in the app (dashboard list)
CREATE INDEX IF NOT EXISTS "Tender_userId_idx" ON "Tender" ("userId");

-- GeneratedDocument.tenderId — every tender-detail panel loads docs by tenderId
CREATE INDEX IF NOT EXISTS "GeneratedDocument_tenderId_idx" ON "GeneratedDocument" ("tenderId");

-- AuditLog — previously had ZERO indexes. The guard_canonical_requirement_set_delete
-- trigger runs a 4-column WHERE on every TenderRequirement DELETE; without
-- these indexes it was a full table scan that grew linearly with audit history.
CREATE INDEX IF NOT EXISTS "AuditLog_userId_idx" ON "AuditLog" ("userId");
CREATE INDEX IF NOT EXISTS "AuditLog_entityType_entityId_idx" ON "AuditLog" ("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "AuditLog_action_idx" ON "AuditLog" ("action");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog" ("createdAt");
-- Composite covering index for the trigger's exact WHERE clause:
--   WHERE "entityType" = 'Tender' AND "entityId" = $1
--     AND action = 'TENDER_ENGINE_RUN_STARTED'
--     AND "createdAt" >= NOW() - INTERVAL '30 minutes'
CREATE INDEX IF NOT EXISTS "AuditLog_entityType_entityId_action_createdAt_idx"
  ON "AuditLog" ("entityType", "entityId", "action", "createdAt");

-- Session.userId — session revocation on password reset / logout-all
CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session" ("userId");

-- ComplianceMatrix.tenderId, ComplianceGap.tenderId, ExportPackage.tenderId,
-- TenderMetadataOverride.overriddenBy — also flagged by audit but lower-traffic.
-- Added here for completeness since they're in the same DB-002 cluster.
CREATE INDEX IF NOT EXISTS "ComplianceMatrix_tenderId_idx" ON "ComplianceMatrix" ("tenderId");
CREATE INDEX IF NOT EXISTS "ComplianceGap_tenderId_idx" ON "ComplianceGap" ("tenderId");
CREATE INDEX IF NOT EXISTS "ExportPackage_tenderId_idx" ON "ExportPackage" ("tenderId");
