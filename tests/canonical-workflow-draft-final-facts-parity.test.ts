import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { buildCanonicalWorkflowDecision } from "../lib/engine/canonical-workflow-decision";

function readyInput() {
  return {
    hasFiles: true,
    extractionUnsafe: false,
    extractionCorrupted: false,
    ocrRequired: false,
    aiAnalysisExists: true,
    aiAnalysisTrusted: true,
    aiAnalysisPartial: false,
    aiAnalysisStale: false,
    resumableAnalysisAvailable: false,
    criticalTenderDetailsValid: true,
    requirementsExist: true,
    requirementsTrusted: true,
    mandatoryRequirementCount: 0,
    mandatoryTracedCount: 0,
    mandatoryComplianceRowsCount: 0,
    mandatoryFullOrSubstantialCoverageCount: 0,
    confirmedBuildPlanExists: true,
    requiredDocumentsTotal: 1,
    generatedDocumentsTotal: 1,
    exportReadyDocumentsTotal: 1,
    documentsValidated: true,
    documentsApproved: true,
    pdfRequiredButUnavailable: false,
    finalExportAllowed: true,
    authorityOrQualityBlockers: false,
  };
}

describe("canonical workflow Tender Facts authority", () => {
  it("blocks draft workflow when the canonical draft Tender Facts resolver blocks", () => {
    const decision = buildCanonicalWorkflowDecision({
      ...readyInput(),
      criticalTenderDetailsValid: false,
      finalExportAllowed: false,
    });

    assert.equal(decision.currentBlockingStage, "CRITICAL_TENDER_DETAILS_INVALID");
    assert.equal(decision.nextRequiredAction, "EDIT_TENDER_METADATA");
    assert.equal(decision.stageAvailability["BUILD_SUBMISSION_PLAN"], false);
    assert.equal(decision.stageAvailability["GENERATE_DOCUMENTS"], false);
  });

  it("keeps final-only authority failure at the export boundary", () => {
    const decision = buildCanonicalWorkflowDecision({
      ...readyInput(),
      criticalTenderDetailsValid: true,
      finalExportAllowed: false,
    });

    assert.equal(decision.currentBlockingStage, "EXPORT_BLOCKED");
    assert.equal(decision.stageAvailability["GENERATE_DOCUMENTS"], false);
    assert.equal(decision.stageStates["EXPORT_ZIP"], "BLOCKED");
  });
});

describe("canonical workflow DB resolver wiring", () => {
  const source = readFileSync("lib/engine/canonical-workflow-decision.ts", "utf8");

  it("does not hard-code Tender Details as valid", () => {
    assert.doesNotMatch(source, /const criticalTenderDetailsValid = true/);
  });

  it("uses the snapshot draft authority signal for pre-generation stages", () => {
    assert.match(
      source,
      /const criticalTenderDetailsValid = !snapshot\.metadata\.hasGenerationBlocker/,
    );
    assert.doesNotMatch(
      source,
      /const criticalTenderDetailsValid = snapshot\.metadata\.gateValid/,
    );
  });

  it("keeps the strict final authority in the final ZIP eligibility signal", () => {
    assert.match(source, /const finalExportAllowed = snapshot\.finalZipEligible/);
  });
});
