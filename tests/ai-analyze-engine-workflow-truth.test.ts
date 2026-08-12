import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  describeAIAnalyzeWorkflowState,
  type AIAnalyzeEngineState,
} from "../components/ai-analyze-panel";
import { describeMatchingEngineState } from "../components/matching-selected-evidence-panel";
import { buildCanonicalWorkflowDecision } from "../lib/engine/canonical-workflow-decision";

function state(overrides: Partial<AIAnalyzeEngineState> = {}): AIAnalyzeEngineState {
  return {
    analysisCurrent: true,
    engineRunning: false,
    engineComplete: false,
    engineFailed: false,
    canRunEngine: true,
    activeJob: null,
    ...overrides,
  };
}

describe("AI Analyze panel uses canonical current-revision Engine truth", () => {
  it("asks for Run Engine only when the current revision has not run", () => {
    assert.equal(describeAIAnalyzeWorkflowState(state()), "AI Analyze complete. Run Engine to continue.");
  });

  it("reports a queued Engine job without asking for another run", () => {
    const message = describeAIAnalyzeWorkflowState(state({
      engineRunning: true,
      canRunEngine: false,
      activeJob: { id: "engine-queued", status: "QUEUED", createdAt: "2026-08-11T10:00:00.000Z" },
    }));
    assert.match(message, /Engine is queued/);
    assert.doesNotMatch(message, /Run Engine/);
    assert.doesNotMatch(message, /Engine is running/);
  });

  it("reports a running Engine job", () => {
    const message = describeAIAnalyzeWorkflowState(state({
      engineRunning: true,
      canRunEngine: false,
      activeJob: { id: "engine-running", status: "RUNNING", createdAt: "2026-08-11T10:00:00.000Z" },
    }));
    assert.match(message, /Engine is running/);
    assert.doesNotMatch(message, /Run Engine/);
  });

  it("stops at current AI Analysis after Engine completes", () => {
    const message = describeAIAnalyzeWorkflowState(state({ engineComplete: true, canRunEngine: false }));
    assert.equal(message, "AI Analysis is complete and current.");
    assert.doesNotMatch(message, /Run Engine|continue|source evidence/i);
  });

  it("requests AI Analyze again when analysis is stale", () => {
    const message = describeAIAnalyzeWorkflowState(state({ analysisCurrent: false, canRunEngine: false }));
    assert.match(message, /stale or incomplete/);
    assert.match(message, /Run AI Analyze again/);
    assert.doesNotMatch(message, /Run Engine/);
  });

  it("does not count an older-revision Engine completion as current", () => {
    // engine-readiness revision-filters jobs; an old success therefore arrives
    // as no current completion and canRunEngine=true.
    const message = describeAIAnalyzeWorkflowState(state({ engineComplete: false, canRunEngine: true }));
    assert.match(message, /Run Engine to continue/);
  });

  it("reports a failed current Engine run without presenting it as complete", () => {
    const message = describeAIAnalyzeWorkflowState(state({ engineFailed: true }));
    assert.match(message, /Engine run failed/);
    assert.doesNotMatch(message, /Run Engine to continue/);
  });
});

describe("cross-panel next-action semantics", () => {
  const downstreamReady = {
    hasFiles: true, extractionUnsafe: false, extractionCorrupted: false, ocrRequired: false,
    aiAnalysisExists: true, aiAnalysisTrusted: true, aiAnalysisPartial: false,
    aiAnalysisStale: false, resumableAnalysisAvailable: false,
    criticalTenderDetailsValid: true, requirementsExist: true, requirementsTrusted: true,
    mandatoryRequirementCount: 1, mandatoryTracedCount: 1,
    mandatoryComplianceRowsCount: 1, mandatoryFullOrSubstantialCoverageCount: 1,
    confirmedBuildPlanExists: true, requiredDocumentsTotal: 1,
    generatedDocumentsTotal: 1, exportReadyDocumentsTotal: 1,
    documentsValidated: true, documentsApproved: false,
    pdfRequiredButUnavailable: false, finalExportAllowed: true,
    authorityOrQualityBlockers: false,
  } as const;

  it("does not require routine per-document human approval after machine validation", () => {
    const decision = buildCanonicalWorkflowDecision(downstreamReady);
    assert.equal(decision.finalExportAllowed, true);
    assert.equal(decision.currentBlockingStage, "EXPORT_ZIP_READY");
    assert.doesNotMatch(decision.blockerCodes.join(" "), /DOCS_NOT_APPROVED/);
  });

  it("never promotes ungrounded requirements through review or confirmation", () => {
    const decision = buildCanonicalWorkflowDecision({
      ...downstreamReady,
      requirementsTrusted: false,
      generatedDocumentsTotal: 0,
      documentsValidated: false,
      finalExportAllowed: false,
    });
    assert.equal(decision.currentBlockingStage, "REQUIREMENTS_NOT_SOURCE_GROUNDED");
    assert.equal(decision.nextRequiredAction, "REPAIR_SOURCE_GROUNDING");
    assert.doesNotMatch(`${decision.nextRequiredAction} ${decision.nextRequiredActionLabel}`, /REVIEW_REQUIREMENTS|CONFIRM_REQUIREMENTS/i);
    assert.match(decision.nextRequiredActionReason, /cannot promote unsupported provenance/i);
  });

  it("does not contradict Source evidence required after current Engine completion", () => {
    // This is the original Preview state: current trusted analysis, a current
    // confirmed plan, and incomplete mandatory evidence coverage. Derive the
    // headline from the real canonical resolver rather than hard-coding the
    // expected label in this semantic test.
    const decision = buildCanonicalWorkflowDecision({
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
      mandatoryRequirementCount: 4,
      mandatoryTracedCount: 4,
      mandatoryComplianceRowsCount: 4,
      mandatoryFullOrSubstantialCoverageCount: 2,
      confirmedBuildPlanExists: true,
      requiredDocumentsTotal: 4,
      generatedDocumentsTotal: 0,
      exportReadyDocumentsTotal: 0,
      documentsValidated: false,
      documentsApproved: false,
      pdfRequiredButUnavailable: false,
      finalExportAllowed: false,
      authorityOrQualityBlockers: false,
    });
    const engine = state({ engineComplete: true, canRunEngine: false });
    const aiPanel = describeAIAnalyzeWorkflowState(engine);
    const matchingPanel = describeMatchingEngineState({
      ...engine,
      analysisBlocker: null,
      blocker: null,
    }, true, {
      nextRequiredAction: decision.nextRequiredAction,
      nextRequiredActionLabel: decision.nextRequiredActionLabel,
      nextRequiredActionReason: decision.nextRequiredActionReason,
      currentBlockingStage: decision.currentBlockingStage,
      downstreamSuppressedBy: decision.downstreamSuppressedBy,
      finalExportAllowed: decision.finalExportAllowed,
      activeJob: null,
    });

    assert.equal(decision.nextRequiredAction, "LINK_VAULT_EVIDENCE");
    assert.equal(decision.nextRequiredActionLabel, "Source evidence required");
    assert.equal(aiPanel, "AI Analysis is complete and current.");
    assert.match(matchingPanel, /Engine complete/);
    assert.match(matchingPanel, /paused — source evidence required/);
    for (const panelMessage of [aiPanel, matchingPanel]) {
      assert.doesNotMatch(panelMessage, /Run Engine|Run AI Analyze/);
    }
    assert.doesNotMatch(decision.nextRequiredActionReason, /Run Engine|Run AI Analyze/);
  });
});
