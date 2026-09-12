-- The GeneratedDocument invalidation trigger (added in
-- 20260731183000_automatic_requirement_coverage_invalidation) fired on
-- AFTER UPDATE for ANY column change, including validationStatus and
-- reviewStatus bumps that do not touch the document's actual bytes or
-- identity. validateTender() ends by stamping validationStatus PASSED/FAILED
-- on every document it just checked, and reconcileAutomaticRequirementCoverage
-- (called earlier in the SAME function, and by AUTO_FINALIZE's coverage-reconcile
-- step) had just created a "this requirement is answered by this exact,
-- byte-verified document" evidence row citing that document's id. The
-- validationStatus bump's own UPDATE then fired this trigger, which deleted
-- the evidence it had no reason to invalidate -- the document's content never
-- changed, only a workflow-outcome column did. So a tender with a real,
-- validated, byte-verified Cover Letter still failed
-- MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE forever: every reconcile-then-validate
-- pass recreated the evidence and immediately destroyed it again.
--
-- Narrow the GeneratedDocument trigger to fire only when a column the
-- evidence actually depends on changes: its bytes (contentSha256/fileContent/
-- storagePath), its lifecycle state (generationStatus -- catches
-- supersession), or its declared identity (exactFileName/format). A
-- validationStatus or reviewStatus change alone no longer invalidates
-- evidence about content that has not moved.

DROP TRIGGER IF EXISTS "invalidate_auto_requirement_coverage" ON "GeneratedDocument";
CREATE TRIGGER "invalidate_auto_requirement_coverage"
AFTER UPDATE ON "GeneratedDocument"
FOR EACH ROW
WHEN (
  OLD."contentSha256" IS DISTINCT FROM NEW."contentSha256"
  OR OLD."fileContent" IS DISTINCT FROM NEW."fileContent"
  OR OLD."storagePath" IS DISTINCT FROM NEW."storagePath"
  OR OLD."generationStatus" IS DISTINCT FROM NEW."generationStatus"
  OR OLD."exactFileName" IS DISTINCT FROM NEW."exactFileName"
  OR OLD."format" IS DISTINCT FROM NEW."format"
)
EXECUTE FUNCTION "invalidateAutomaticRequirementCoverage"();

DROP TRIGGER IF EXISTS "invalidate_auto_requirement_coverage_delete" ON "GeneratedDocument";
CREATE TRIGGER "invalidate_auto_requirement_coverage_delete"
AFTER DELETE ON "GeneratedDocument"
FOR EACH ROW EXECUTE FUNCTION "invalidateAutomaticRequirementCoverage"();
