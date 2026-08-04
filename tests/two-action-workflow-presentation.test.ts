import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { CanonicalWorkflowDecision, WorkflowBlockerPriority } from "../lib/engine/canonical-workflow-decision";
import { presentTwoActionWorkflowDecision } from "../lib/engine/two-action-workflow-presentation";

function decision(stage: WorkflowBlockerPriority): CanonicalWorkflowDecision {
  return {
    currentBlockingStage: stage,
    nextRequiredAction: "LEGACY_ACTION",
    nextRequiredActionLabel: "Legacy label",
    nextRequiredActionReason: "Legacy reason",
    blockingStageCode: stage,
    blockerCodes: [stage],
    blockerDetails: [`Blocker ${stage}`],
    stageStates: { RUN_AI_ANALYZE: "COMPLETE", BUILD_SUBMISSION_PLAN: "READY" },
    stageAvailability: { RUN_AI_ANALYZE: false, BUILD_SUBMISSION_PLAN: true },
    downstreamSuppressedBy: stage,
    partialAnalysis: false,
    staleAnalysis: false,
    confirmedBuildPlanExists: false,
    mandatoryRequirementCount: 3,
    mandatoryTracedCount: 3,
    mandatoryComplianceRowsCount: 0,
    mandatoryFullOrSubstantialCoverageCount: 0,
    requiredDocumentsTotal: 4,
    generatedDocumentsTotal: 0,
    exportReadyDocumentsTotal: 0,
    pdfRequiredButUnavailable: false,
    finalExportAllowed: false,
  };
}

describe("two-action workflow presentation", () => {
  it("maps engine-owned intermediate blockers to Run Engine", () => {
    for (const stage of [
      "NO_CONFIRMED_BUILD_PLAN",
      "MANDATORY_NO_COMPLIANCE_ROWS",
      "REQUIRED_DOCS_NOT_GENERATED",
    ] as const) {
      const source = decision(stage);
      const presented = presentTwoActionWorkflowDecision(source)!;
      assert.equal(presented.nextRequiredAction, "RUN_ENGINE");
      assert.equal(presented.nextRequiredActionLabel, "Run Engine");
      assert.equal(presented.currentBlockingStage, stage);
      assert.deepEqual(presented.blockerCodes, source.blockerCodes);
      assert.deepEqual(presented.stageStates, source.stageStates);
      assert.equal(presented.finalExportAllowed, false);
    }
  });

  it("maps server-owned finalization stages to automatic processing", () => {
    for (const stage of ["PDF_REQUIRED_UNAVAILABLE", "DOCS_NOT_VALIDATED"] as const) {
      const presented = presentTwoActionWorkflowDecision(decision(stage))!;
      assert.equal(presented.nextRequiredAction, "AUTOMATIC_PROCESSING");
      assert.equal(presented.nextRequiredActionLabel, "Processing automatically");
      assert.equal(presented.currentBlockingStage, stage);
    }
  });

  it("does not hide genuine source or authority actions", () => {
    for (const stage of [
      "EXTRACTION_UNSAFE",
      "CRITICAL_TENDER_DETAILS_INVALID",
      "REQUIREMENTS_NOT_SOURCE_GROUNDED",
      "MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE",
      "DOCS_NOT_APPROVED_EXPORT_READY",
      "AUTHORITY_OR_QUALITY_BLOCKERS",
      "EXPORT_BLOCKED",
    ] as const) {
      const source = decision(stage);
      const presented = presentTwoActionWorkflowDecision(source)!;
      assert.equal(presented, source);
    }
  });

  it("preserves null when no canonical decision exists", () => {
    assert.equal(presentTwoActionWorkflowDecision(null), null);
  });
});
