-- Reconcile indexes and revision uniqueness that are declared in the
-- authoritative Prisma schema but were absent from earlier raw-SQL migrations.
-- This migration is additive and fails closed if legacy revision duplicates exist.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "SubmissionPlanRevision"
    GROUP BY "tenderId", "revision"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate SubmissionPlanRevision (tenderId, revision) rows must be resolved before migration';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "SubmissionPlanRevision_tenderId_revision_key"
  ON "SubmissionPlanRevision" ("tenderId", "revision");

CREATE INDEX IF NOT EXISTS "TenderFile_tenderId_deletionStatus_idx"
  ON "TenderFile" ("tenderId", "deletionStatus");

CREATE INDEX IF NOT EXISTS "TenderRequirement_tenderId_priority_idx"
  ON "TenderRequirement" ("tenderId", "priority");
