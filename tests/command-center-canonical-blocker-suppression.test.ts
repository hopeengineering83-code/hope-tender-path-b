import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { CanonicalWorkflowDecision } from "../lib/engine/canonical-workflow-decision";
import type { FinalSubmissionReadiness } from "../lib/engine/final-submission-readiness";
import { reconcileReachableReleaseBlockers } from "../lib/engine/tender-release-state";

const finalSubmission = {
  tenderLevelBlockers: [
    { category: "CLIENT_NAME_MISSING", severity: "HIGH", title: "Client missing", recommendedAction: "Edit metadata" },
    { category: "NO_CURRENT_CONFIRMED_BUILD_PLAN", severity: "HIGH", title: "Plan missing", recommendedAction: "Build plan" },
  ],
  documentBlockers: [
    { documentId: "__tender__", severity: "HIGH", name: "No documents", reasons: ["No generated files"], nextActions: ["Generate documents"] },
  ],
} as unknown as FinalSubmissionReadiness;

function decision(overrides: Partial<CanonicalWorkflowDecision> = {}): CanonicalWorkflowDecision {
  return {
    currentBlockingStage: "NO_TENDER_FILE",
    nextRequiredAction: "UPLOAD_TENDER",
    nextRequiredActionLabel: "Upload tender document",
    nextRequiredActionReason: "No tender file has been uploaded.",
    blockingStageCode: "NO_TENDER_FILE",
    blockerCodes: ["NO_TENDER_FILE"],
    blockerDetails: ["No tender file has been uploaded."],
    stageStates: {},
    stageAvailability: {},
    downstreamSuppressedBy: "NO_TENDER_FILE",
    partialAnalysis: false,
    staleAnalysis: false,
    confirmedBuildPlanExists: false,
    mandatoryRequirementCount: 0,
    mandatoryTracedCount: 0,
    mandatoryComplianceRowsCount: 0,
    mandatoryFullOrSubstantialCoverageCount: 0,
    requiredDocumentsTotal: 0,
    generatedDocumentsTotal: 0,
    exportReadyDocumentsTotal: 0,
    pdfRequiredButUnavailable: false,
    finalExportAllowed: false,
    ...overrides,
  };
}

describe("Command Center canonical blocker suppression", () => {
  it("shows only the current upload blocker and suppresses downstream export defects", () => {
    const result = reconcileReachableReleaseBlockers(decision(), finalSubmission);
    assert.equal(result.blockerTotal, 1);
    assert.deepEqual(result.blockers.map((blocker) => blocker.category), ["NO_TENDER_FILE"]);
    assert.equal(result.blockers[0]?.nextAction, "Upload tender document");
    assert.doesNotMatch(JSON.stringify(result), /Build plan|Generate documents|Edit metadata/);
  });

  it("preserves the exact current Engine title-provenance failure", () => {
    const result = reconcileReachableReleaseBlockers(decision({
      currentBlockingStage: "ENGINE_RUN_FAILED",
      blockingStageCode: "TITLE_SOURCE_PROVENANCE_INVALID",
      blockerCodes: ["TITLE_SOURCE_PROVENANCE_INVALID"],
      blockerDetails: ["Tender title could not be proven at a valid active-source page. Ref: 03b9c928"],
      nextRequiredAction: "REPAIR_TITLE_SOURCE_PROVENANCE",
      nextRequiredActionLabel: "Repair tender title source",
      nextRequiredActionReason: "Repair the title file, page, and quote.",
    }), finalSubmission);
    assert.equal(result.blockers[0]?.category, "TITLE_SOURCE_PROVENANCE_INVALID");
    assert.match(result.blockers[0]?.title ?? "", /valid active-source page/);
    assert.equal(result.blockers[0]?.nextAction, "Repair tender title source");
  });

  it("does not invent a manual action for automatic downstream processing", () => {
    const result = reconcileReachableReleaseBlockers(decision({
      currentBlockingStage: "REQUIRED_DOCS_NOT_GENERATED",
      blockingStageCode: "REQUIRED_DOCS_NOT_GENERATED",
      blockerCodes: ["REQUIRED_DOCS_NOT_GENERATED"],
      blockerDetails: ["Required proposal outputs are being generated."],
      nextRequiredAction: "AUTOMATIC_PROCESSING",
      nextRequiredActionLabel: "Processing automatically",
      nextRequiredActionReason: "The durable worker owns this stage.",
    }), finalSubmission);
    assert.equal(result.blockers[0]?.nextAction, null);
  });

  it("does not add a competing Engine instruction in the empty proposal-version state", () => {
    const source = readFileSync("app/dashboard/tenders/[id]/command-center/version-actions.tsx", "utf8");
    assert.match(source, /Versions appear automatically when the canonical workflow reaches generation/);
    assert.doesNotMatch(source, /Run the engine to create the first version/i);
  });
});
