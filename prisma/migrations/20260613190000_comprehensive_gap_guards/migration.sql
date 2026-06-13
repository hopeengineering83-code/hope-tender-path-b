-- Comprehensive gap guards
-- 1. Resolve requirement source files from unique exact-quote matches.
-- 2. Prevent an unstaged fallback from deleting the final canonical requirement set.
-- 3. Persist submission-plan provenance as structured state rather than relying only on contentSummary markers.

CREATE OR REPLACE FUNCTION resolve_tender_requirement_source_file()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  matched_count integer := 0;
  matched_id text;
  matched_method text;
  quote_text text;
BEGIN
  IF NEW."sourceTenderFileId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "TenderFile" tf
      WHERE tf.id = NEW."sourceTenderFileId"
        AND tf."tenderId" = NEW."tenderId"
    ) THEN
      RAISE EXCEPTION 'sourceTenderFileId % does not belong to tender %', NEW."sourceTenderFileId", NEW."tenderId";
    END IF;
    RETURN NEW;
  END IF;

  quote_text := NULLIF(BTRIM(COALESCE(NEW."sourceExactQuote", '')), '');
  IF quote_text IS NULL OR char_length(quote_text) < 16 THEN
    IF NEW."sourcePageNumber" IS NOT NULL OR quote_text IS NOT NULL THEN
      NEW."sourceConfidence" := LEAST(GREATEST(COALESCE(NEW."sourceConfidence", 0), 0.25), 0.45);
    END IF;
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::integer, MIN(tf.id), MIN(tf."extractionMethod")
    INTO matched_count, matched_id, matched_method
  FROM "TenderFile" tf
  WHERE tf."tenderId" = NEW."tenderId"
    AND position(lower(quote_text) in lower(COALESCE(tf."extractedText", ''))) > 0;

  IF matched_count = 1 THEN
    NEW."sourceTenderFileId" := matched_id;
    NEW."sourceExtractionMethod" := COALESCE(NULLIF(matched_method, ''), NEW."sourceExtractionMethod", 'text');
    NEW."sourceConfidence" := GREATEST(
      COALESCE(NEW."sourceConfidence", 0),
      CASE WHEN NEW."sourcePageNumber" IS NOT NULL THEN 0.95 ELSE 0.85 END
    );
  ELSE
    -- Missing or ambiguous source-file matches must never be represented as high confidence.
    NEW."sourceConfidence" := LEAST(GREATEST(COALESCE(NEW."sourceConfidence", 0), 0.25), 0.45);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "TenderRequirement_resolve_source_file" ON "TenderRequirement";
CREATE TRIGGER "TenderRequirement_resolve_source_file"
BEFORE INSERT OR UPDATE OF "sourceTenderFileId", "sourceExactQuote", "sourcePageNumber", "sourceConfidence"
ON "TenderRequirement"
FOR EACH ROW
EXECUTE FUNCTION resolve_tender_requirement_source_file();

-- Backfill only unambiguous exact-quote matches. The trigger validates every update.
UPDATE "TenderRequirement" tr
SET "sourceExactQuote" = tr."sourceExactQuote"
WHERE tr."sourceTenderFileId" IS NULL
  AND char_length(BTRIM(COALESCE(tr."sourceExactQuote", ''))) >= 16;

CREATE OR REPLACE FUNCTION guard_canonical_requirement_set_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected record;
  remaining_count integer;
  authorized boolean;
BEGIN
  FOR affected IN
    SELECT d."tenderId", COUNT(*)::integer AS deleted_count
    FROM deleted_requirements d
    GROUP BY d."tenderId"
  LOOP
    -- Cascading tender deletion is legitimate because the parent no longer exists.
    IF NOT EXISTS (SELECT 1 FROM "Tender" t WHERE t.id = affected."tenderId") THEN
      CONTINUE;
    END IF;

    SELECT COUNT(*)::integer
      INTO remaining_count
    FROM "TenderRequirement" tr
    WHERE tr."tenderId" = affected."tenderId";

    -- Only guard deletion of the final canonical set. Individual edits remain possible
    -- while at least one canonical requirement survives.
    IF remaining_count > 0 THEN
      CONTINUE;
    END IF;

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

CREATE TABLE IF NOT EXISTS "SubmissionPlanState" (
  "tenderId" text PRIMARY KEY,
  "provenance" text NOT NULL DEFAULT 'NONE',
  "confirmationStatus" text NOT NULL DEFAULT 'NOT_REQUIRED',
  "derivedDocumentCount" integer NOT NULL DEFAULT 0,
  "activeDocumentCount" integer NOT NULL DEFAULT 0,
  "confirmedAt" timestamptz,
  "updatedAt" timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "SubmissionPlanState_tenderId_fkey"
    FOREIGN KEY ("tenderId") REFERENCES "Tender"(id) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION refresh_submission_plan_state(target_tender_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  active_count integer := 0;
  derived_count integer := 0;
  confirmed_derived_count integer := 0;
  next_provenance text;
  next_confirmation text;
BEGIN
  IF target_tender_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE gd."generationStatus" <> 'SUPERSEDED')::integer,
    COUNT(*) FILTER (
      WHERE gd."generationStatus" <> 'SUPERSEDED'
        AND COALESCE(gd."contentSummary", '') LIKE '%DERIVED_DRAFT_UNCONFIRMED%'
    )::integer,
    COUNT(*) FILTER (
      WHERE gd."generationStatus" <> 'SUPERSEDED'
        AND COALESCE(gd."contentSummary", '') LIKE '%DERIVED_DRAFT_UNCONFIRMED%'
        AND gd."reviewStatus" IN ('CONFIRMED', 'APPROVED', 'READY_FOR_EXPORT', 'REPLACE_WITH_ORIGINAL')
    )::integer
  INTO active_count, derived_count, confirmed_derived_count
  FROM "GeneratedDocument" gd
  WHERE gd."tenderId" = target_tender_id;

  next_provenance := CASE
    WHEN active_count = 0 THEN 'NONE'
    WHEN derived_count > 0 THEN 'DERIVED_FROM_REQUIREMENTS'
    ELSE 'SOURCE_BACKED'
  END;

  next_confirmation := CASE
    WHEN derived_count = 0 THEN 'NOT_REQUIRED'
    WHEN confirmed_derived_count = derived_count THEN 'CONFIRMED'
    ELSE 'UNCONFIRMED'
  END;

  INSERT INTO "SubmissionPlanState" (
    "tenderId", "provenance", "confirmationStatus", "derivedDocumentCount",
    "activeDocumentCount", "confirmedAt", "updatedAt"
  ) VALUES (
    target_tender_id,
    next_provenance,
    next_confirmation,
    derived_count,
    active_count,
    CASE WHEN next_confirmation = 'CONFIRMED' THEN NOW() ELSE NULL END,
    NOW()
  )
  ON CONFLICT ("tenderId") DO UPDATE SET
    "provenance" = EXCLUDED."provenance",
    "confirmationStatus" = EXCLUDED."confirmationStatus",
    "derivedDocumentCount" = EXCLUDED."derivedDocumentCount",
    "activeDocumentCount" = EXCLUDED."activeDocumentCount",
    "confirmedAt" = CASE
      WHEN EXCLUDED."confirmationStatus" = 'CONFIRMED'
        THEN COALESCE("SubmissionPlanState"."confirmedAt", NOW())
      ELSE NULL
    END,
    "updatedAt" = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION refresh_submission_plan_state_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_tender_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_tender_id := OLD."tenderId";
  ELSE
    target_tender_id := NEW."tenderId";
  END IF;

  PERFORM refresh_submission_plan_state(target_tender_id);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "GeneratedDocument_refresh_plan_state" ON "GeneratedDocument";
CREATE TRIGGER "GeneratedDocument_refresh_plan_state"
AFTER INSERT OR UPDATE OF "tenderId", "generationStatus", "reviewStatus", "contentSummary" OR DELETE
ON "GeneratedDocument"
FOR EACH ROW
EXECUTE FUNCTION refresh_submission_plan_state_trigger();

-- Backfill structured state for existing tenders with planned/generated documents.
DO $$
DECLARE
  row_data record;
BEGIN
  FOR row_data IN SELECT DISTINCT gd."tenderId" FROM "GeneratedDocument" gd LOOP
    PERFORM refresh_submission_plan_state(row_data."tenderId");
  END LOOP;
END;
$$;
