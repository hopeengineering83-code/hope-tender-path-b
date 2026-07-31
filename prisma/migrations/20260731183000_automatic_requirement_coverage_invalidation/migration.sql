-- Automatic requirement-evidence rows are derived cache, not an independent
-- authority. Keep them unique and delete them atomically whenever either side
-- of their provenance changes. The next Engine/auto-sync pass recreates only
-- rows that still satisfy byte, ownership, expiry, source-quote, and relevance
-- checks.

CREATE UNIQUE INDEX IF NOT EXISTS "ComplianceMatrix_auto_requirement_evidence_unique"
  ON "ComplianceMatrix" ("tenderId", "requirementId", "notes")
  WHERE "notes" LIKE 'automatic-requirement-evidence:v1:%';

CREATE OR REPLACE FUNCTION "invalidateAutomaticRequirementCoverage"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_id TEXT := OLD."id"::text;
  prefix_pattern CONSTANT TEXT := 'automatic-requirement-evidence:v1:%';
BEGIN
  IF TG_TABLE_NAME = 'TenderRequirement' THEN
    DELETE FROM "ComplianceMatrix"
      WHERE "requirementId" = target_id
        AND "notes" LIKE prefix_pattern;
  ELSIF TG_TABLE_NAME IN ('CompanyDocument', 'BuildPlan') THEN
    DELETE FROM "ComplianceMatrix"
      WHERE "notes" LIKE prefix_pattern
        AND (
          "notes" LIKE ('%"recordId":"' || target_id || '%')
          OR "notes" LIKE ('%"sourceDocumentId":"' || target_id || '"%')
        );
  ELSE
    DELETE FROM "ComplianceMatrix"
      WHERE "notes" LIKE prefix_pattern
        AND "notes" LIKE ('%"recordId":"' || target_id || '"%');
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "invalidate_auto_requirement_coverage" ON "TenderRequirement";
CREATE TRIGGER "invalidate_auto_requirement_coverage"
AFTER UPDATE OR DELETE ON "TenderRequirement"
FOR EACH ROW EXECUTE FUNCTION "invalidateAutomaticRequirementCoverage"();

DROP TRIGGER IF EXISTS "invalidate_auto_requirement_coverage" ON "Expert";
CREATE TRIGGER "invalidate_auto_requirement_coverage"
AFTER UPDATE OR DELETE ON "Expert"
FOR EACH ROW EXECUTE FUNCTION "invalidateAutomaticRequirementCoverage"();

DROP TRIGGER IF EXISTS "invalidate_auto_requirement_coverage" ON "Project";
CREATE TRIGGER "invalidate_auto_requirement_coverage"
AFTER UPDATE OR DELETE ON "Project"
FOR EACH ROW EXECUTE FUNCTION "invalidateAutomaticRequirementCoverage"();

DROP TRIGGER IF EXISTS "invalidate_auto_requirement_coverage" ON "LegalRecord";
CREATE TRIGGER "invalidate_auto_requirement_coverage"
AFTER UPDATE OR DELETE ON "LegalRecord"
FOR EACH ROW EXECUTE FUNCTION "invalidateAutomaticRequirementCoverage"();

DROP TRIGGER IF EXISTS "invalidate_auto_requirement_coverage" ON "FinancialRecord";
CREATE TRIGGER "invalidate_auto_requirement_coverage"
AFTER UPDATE OR DELETE ON "FinancialRecord"
FOR EACH ROW EXECUTE FUNCTION "invalidateAutomaticRequirementCoverage"();

DROP TRIGGER IF EXISTS "invalidate_auto_requirement_coverage" ON "CompanyComplianceRecord";
CREATE TRIGGER "invalidate_auto_requirement_coverage"
AFTER UPDATE OR DELETE ON "CompanyComplianceRecord"
FOR EACH ROW EXECUTE FUNCTION "invalidateAutomaticRequirementCoverage"();

DROP TRIGGER IF EXISTS "invalidate_auto_requirement_coverage" ON "CompanyDocument";
CREATE TRIGGER "invalidate_auto_requirement_coverage"
AFTER UPDATE OR DELETE ON "CompanyDocument"
FOR EACH ROW EXECUTE FUNCTION "invalidateAutomaticRequirementCoverage"();

DROP TRIGGER IF EXISTS "invalidate_auto_requirement_coverage" ON "GeneratedDocument";
CREATE TRIGGER "invalidate_auto_requirement_coverage"
AFTER UPDATE OR DELETE ON "GeneratedDocument"
FOR EACH ROW EXECUTE FUNCTION "invalidateAutomaticRequirementCoverage"();

DROP TRIGGER IF EXISTS "invalidate_auto_requirement_coverage" ON "BuildPlan";
CREATE TRIGGER "invalidate_auto_requirement_coverage"
AFTER UPDATE OR DELETE ON "BuildPlan"
FOR EACH ROW EXECUTE FUNCTION "invalidateAutomaticRequirementCoverage"();
