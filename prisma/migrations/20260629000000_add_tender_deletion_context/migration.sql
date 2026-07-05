-- Migration: Add transaction-local tender-deletion context to the trigger
--
-- The guard_canonical_requirement_set_delete trigger blocks deletion of the
-- final canonical TenderRequirement set unless an active AiJob exists.
--
-- This migration adds a narrow, transaction-local, server-set authorization:
-- the DELETE handler sets a PostgreSQL session GUC via:
--   SET LOCAL app.tender_deletion_context = '<tenderId>';
-- inside the delete transaction (after ownership verification). The trigger
-- checks this GUC and allows the deletion if it matches the affected tenderId.
--
-- Security properties:
-- - Transaction-local: SET LOCAL only lasts for the current transaction
-- - Server-set: only the DELETE handler sets this, never the client
-- - Narrow: only the specific tenderId in the GUC is authorized
-- - Ownership-verified: the handler sets this AFTER requireRole + findFirst
-- - Direct deletion outside tender deletion remains blocked (no GUC set)

CREATE OR REPLACE FUNCTION guard_canonical_requirement_set_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected record;
  remaining_count integer;
  authorized boolean;
  deletion_context text;
BEGIN
  FOR affected IN
    SELECT d."tenderId", COUNT(*)::integer AS deleted_count
    FROM deleted_requirements d
    GROUP BY d."tenderId"
  LOOP
    -- Exempt cascade deletes: parent Tender no longer exists.
    IF NOT EXISTS (SELECT 1 FROM "Tender" t WHERE t.id = affected."tenderId") THEN
      CONTINUE;
    END IF;

    -- Exempt authorized tender-deletion transactions.
    -- The DELETE handler sets this GUC via SET LOCAL after ownership
    -- verification. Only the specific tenderId in the GUC is authorized.
    deletion_context := current_setting('app.tender_deletion_context', true);
    IF deletion_context IS NOT NULL AND deletion_context = affected."tenderId" THEN
      CONTINUE;
    END IF;

    -- Only guard deletion of the final canonical set.
    SELECT COUNT(*)::integer
      INTO remaining_count
    FROM "TenderRequirement" tr
    WHERE tr."tenderId" = affected."tenderId";

    IF remaining_count > 0 THEN
      CONTINUE;
    END IF;

    -- Check for an active AI job or engine run (original authorization path).
    SELECT (
      EXISTS (
        SELECT 1
        FROM "AiJob" j
        WHERE j."tenderId" = affected."tenderId"
          AND j."jobType" IN ('AI_ANALYZE', 'ENGINE_RUN')
          AND j.status IN ('QUEUED', 'RUNNING')
          AND COALESCE(j."startedAt", j."createdAt") >= NOW() - INTERVAL '30 minutes'
      )
      OR EXISTS (
        SELECT 1
        FROM "AuditLog" a
        WHERE a."entityType" = 'Tender'
          AND a."entityId" = affected."tenderId"
          AND a.action = 'TENDER_ENGINE_RUN_STARTED'
          AND a."createdAt" >= NOW() - INTERVAL '30 minutes'
      )
    ) INTO authorized;

    IF NOT authorized THEN
      RAISE EXCEPTION USING
        ERRCODE = 'check_violation',
        MESSAGE = 'Refusing to delete the final canonical tender requirement set without an active staged analysis or engine run',
        DETAIL = format('tenderId=%s deleted=%s', affected."tenderId", affected.deleted_count),
        HINT = 'Create and persist the AiJob/staged result before promoting replacement requirements.';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "TenderRequirement_guard_final_set_delete" ON "TenderRequirement";
CREATE TRIGGER "TenderRequirement_guard_final_set_delete"
AFTER DELETE ON "TenderRequirement"
REFERENCING OLD TABLE AS deleted_requirements
FOR EACH STATEMENT
EXECUTE FUNCTION guard_canonical_requirement_set_delete();
