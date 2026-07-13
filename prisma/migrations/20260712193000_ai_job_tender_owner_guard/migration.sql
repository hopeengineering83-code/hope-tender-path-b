-- Enforce tenant ownership at the database boundary for every AiJob writer.
-- Jobs without a tender (for example profile extraction) remain permitted.

CREATE OR REPLACE FUNCTION "enforce_ai_job_tender_owner"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."tenderId" IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM "Tender" AS tender
       WHERE tender."id" = NEW."tenderId"
         AND tender."userId" = NEW."userId"
     )
  THEN
    RAISE EXCEPTION 'AI_JOB_TENDER_OWNER_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "AiJob_tender_owner_guard" ON "AiJob";

CREATE TRIGGER "AiJob_tender_owner_guard"
BEFORE INSERT OR UPDATE OF "tenderId", "userId"
ON "AiJob"
FOR EACH ROW
EXECUTE FUNCTION "enforce_ai_job_tender_owner"();
