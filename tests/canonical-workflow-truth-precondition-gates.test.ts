// Canonical workflow truth — precondition gate tests.
//
// Tests that the canonical workflow decision helper enforces correct
// blocker priority and that panels display consistent stage states.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { buildCanonicalWorkflowDecision } from "../lib/engine/canonical-workflow-decision";

const read = (p: string) => readFileSync(p, "utf8");

// Helper: build the screenshot fixture input
function screenshotFixtureInput() {
  return {
    hasFiles: true,
    extractionUnsafe: false,
    extractionCorrupted: false,
    ocrRequired: false,
    aiAnalysisExists: true,
    aiAnalysisTrusted: true,
    aiAnalysisPartial: true, // partial AI
    aiAnalysisStale: true,   // content changed
    resumableAnalysisAvailable: true,
    criticalTenderDetailsValid: true,
    requirementsExist: true,
    requirementsTrusted: true,
    mandatoryRequirementCount: 8,
    mandatoryTracedCount: 8,
    mandatoryComplianceRowsCount: 0, // no compliance rows
    mandatoryFullOrSubstantialCoverageCount: 0,
    confirmedBuildPlanExists: false, // no confirmed build plan
    requiredDocumentsTotal: 10,
    generatedDocumentsTotal: 0,
    exportReadyDocumentsTotal: 0,
    documentsValidated: false,
    documentsApproved: false,
    pdfRequiredButUnavailable: true, // PDF required
    finalExportAllowed: false,
    authorityOrQualityBlockers: false,
  };
}

// ─── 1. Screenshot fixture: partial AI → Resume/Re-run AI Analyze ─────────

describe("Screenshot fixture — partial AI + stale + no build plan + no compliance rows + PDF required", () => {
  it("nextRequiredAction is RESUME_AI_ANALYZE, not GENERATE_DOCUMENTS", () => {
    const decision = buildCanonicalWorkflowDecision(screenshotFixtureInput());
    assert.equal(decision.nextRequiredAction, "RESUME_AI_ANALYZE");
    assert.notEqual(decision.nextRequiredAction, "GENERATE_DOCUMENTS");
  });

  it("currentBlockingStage is PARTIAL_AI_ANALYSIS (highest priority)", () => {
    const decision = buildCanonicalWorkflowDecision(screenshotFixtureInput());
    assert.equal(decision.currentBlockingStage, "PARTIAL_AI_ANALYSIS");
  });

  it("downstreamSuppressedBy is set (downstream stages are suppressed)", () => {
    const decision = buildCanonicalWorkflowDecision(screenshotFixtureInput());
    assert.ok(decision.downstreamSuppressedBy);
    assert.equal(decision.downstreamSuppressedBy, "PARTIAL_AI_ANALYSIS");
  });
});

// ─── 2. Stage states agree ─────────────────────────────────────────────────

describe("Stage states — downstream stages are BLOCKED_BY_PRIOR_STEP", () => {
  it("Generate Documents is BLOCKED_BY_PRIOR_STEP when AI is partial", () => {
    const decision = buildCanonicalWorkflowDecision(screenshotFixtureInput());
    assert.equal(decision.stageStates["GENERATE_DOCUMENTS"], "BLOCKED_BY_PRIOR_STEP");
  });

  it("Export ZIP is BLOCKED_BY_PRIOR_STEP when AI is partial", () => {
    const decision = buildCanonicalWorkflowDecision(screenshotFixtureInput());
    assert.equal(decision.stageStates["EXPORT_ZIP"], "BLOCKED_BY_PRIOR_STEP");
  });

  it("Build Plan is BLOCKED_BY_PRIOR_STEP when AI is partial", () => {
    const decision = buildCanonicalWorkflowDecision(screenshotFixtureInput());
    assert.equal(decision.stageStates["BUILD_SUBMISSION_PLAN"], "BLOCKED_BY_PRIOR_STEP");
  });

  it("Match Evidence is BLOCKED_BY_PRIOR_STEP when AI is partial", () => {
    const decision = buildCanonicalWorkflowDecision(screenshotFixtureInput());
    assert.equal(decision.stageStates["MATCH_EVIDENCE"], "BLOCKED_BY_PRIOR_STEP");
  });

  it("Validate Docs is BLOCKED_BY_PRIOR_STEP when AI is partial", () => {
    const decision = buildCanonicalWorkflowDecision(screenshotFixtureInput());
    assert.equal(decision.stageStates["VALIDATE_DOCS"], "BLOCKED_BY_PRIOR_STEP");
  });
});

// ─── 3. No confirmed Build Plan blocks later stages ────────────────────────

describe("No confirmed Build Plan — blocks later stages consistently", () => {
  it("Generate Documents is BLOCKED_BY_PRIOR_STEP when no Build Plan", () => {
    const decision = buildCanonicalWorkflowDecision({
      ...screenshotFixtureInput(),
      aiAnalysisPartial: false,
      aiAnalysisStale: false,
      // Now the first blocker should be NO_CONFIRMED_BUILD_PLAN
    });
    assert.equal(decision.currentBlockingStage, "NO_CONFIRMED_BUILD_PLAN");
    assert.equal(decision.stageStates["GENERATE_DOCUMENTS"], "BLOCKED_BY_PRIOR_STEP");
    assert.equal(decision.nextRequiredAction, "BUILD_SUBMISSION_PLAN");
  });
});

// ─── 4. Mandatory requirements with zero compliance rows ───────────────────

describe("Mandatory requirements with zero compliance rows — Match Evidence before Generate", () => {
  it("nextRequiredAction is LINK_VAULT_EVIDENCE, not GENERATE_DOCUMENTS", () => {
    const decision = buildCanonicalWorkflowDecision({
      ...screenshotFixtureInput(),
      aiAnalysisPartial: false,
      aiAnalysisStale: false,
      confirmedBuildPlanExists: true, // build plan exists
      // mandatoryComplianceRowsCount: 0 (from fixture)
    });
    assert.equal(decision.currentBlockingStage, "MANDATORY_NO_COMPLIANCE_ROWS");
    assert.equal(decision.nextRequiredAction, "LINK_VAULT_EVIDENCE");
    assert.notEqual(decision.nextRequiredAction, "GENERATE_DOCUMENTS");
  });
});

// ─── 5. PDF required blocker appears as future, not highest priority ───────

describe("PDF required — future blocker, not higher than stale AI or missing Build Plan", () => {
  it("PDF blocker does not outrank PARTIAL_AI_ANALYSIS", () => {
    const decision = buildCanonicalWorkflowDecision(screenshotFixtureInput());
    assert.notEqual(decision.currentBlockingStage, "PDF_REQUIRED_UNAVAILABLE");
    // PDF blocker is NOT in blockerCodes when upstream blockers exist — it's
    // a future blocker that hasn't been reached in the priority chain.
    // The pdfRequiredButUnavailable flag IS set so consumers know it exists.
    assert.ok(decision.pdfRequiredButUnavailable);
    assert.ok(!decision.blockerCodes.includes("PDF_REQUIRED_UNAVAILABLE"));
  });

  it("PDF blocker does not outrank NO_CONFIRMED_BUILD_PLAN", () => {
    const decision = buildCanonicalWorkflowDecision({
      ...screenshotFixtureInput(),
      aiAnalysisPartial: false,
      aiAnalysisStale: false,
    });
    assert.notEqual(decision.currentBlockingStage, "PDF_REQUIRED_UNAVAILABLE");
    assert.equal(decision.currentBlockingStage, "NO_CONFIRMED_BUILD_PLAN");
  });
});

// ─── 6. Final export remains fail-closed ───────────────────────────────────

describe("Final export fail-closed", () => {
  it("finalExportAllowed is false when any blocker exists", () => {
    const decision = buildCanonicalWorkflowDecision(screenshotFixtureInput());
    assert.equal(decision.finalExportAllowed, false);
  });

  it("finalExportAllowed is true only when no blockers exist", () => {
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
      mandatoryRequirementCount: 0,
      mandatoryTracedCount: 0,
      mandatoryComplianceRowsCount: 0,
      mandatoryFullOrSubstantialCoverageCount: 0,
      confirmedBuildPlanExists: true,
      requiredDocumentsTotal: 3,
      generatedDocumentsTotal: 3,
      exportReadyDocumentsTotal: 3,
      documentsValidated: true,
      documentsApproved: true,
      pdfRequiredButUnavailable: false,
      finalExportAllowed: true,
      authorityOrQualityBlockers: false,
    });
    assert.equal(decision.blockerCodes.length, 0);
    assert.equal(decision.currentBlockingStage, "EXPORT_ZIP_READY");
  });
});

// ─── 7. Requirement Coverage panel — coverage 0% + no warnings ─────────────

describe("Requirement Coverage panel — coverage 0% does not say 'acceptable traceability'", () => {
  it("does not show 'All requirements and selected evidence have acceptable traceability' when coverage is 0", () => {
    const src = read("components/requirement-coverage-panel.tsx");
    // The old unconditional message must be replaced with a coverage check
    assert.ok(
      src.includes("coveragePct > 0"),
      "must check coveragePct > 0 before showing 'acceptable traceability'",
    );
    assert.ok(
      src.includes("No compliance coverage has been confirmed yet"),
      "must show 'No compliance coverage has been confirmed yet' when coverage is 0",
    );
  });
});

// ─── 8. Authority Review — precondition blocked mode ────────────────────────

describe("Authority Review — precondition blocked mode", () => {
  it("shows 'prerequisites not met' when no generated docs", () => {
    const src = read("components/authority-review-panel.tsx");
    assert.ok(
      src.includes("prerequisites not met"),
      "must show 'prerequisites not met' heading when preconditions are not satisfied",
    );
    assert.ok(
      src.includes("Preliminary only"),
      "must label score as 'Preliminary only' when preconditions are not met",
    );
    assert.ok(
      src.includes("preconditionBlocked"),
      "must compute preconditionBlocked flag",
    );
  });
});

// ─── 9. No user-facing metadata wording ────────────────────────────────────

describe("No user-facing metadata wording", () => {
  it("canonical-workflow-decision.ts has no user-facing metadata text", () => {
    const src = read("lib/engine/canonical-workflow-decision.ts");
    assert.ok(
      !/>.*[Mm]etadata.*</.test(src),
      "must not contain user-facing 'metadata' label",
    );
  });
});

// ─── 10. Canonical helper exists and is exported ───────────────────────────

describe("Canonical workflow decision helper", () => {
  it("buildCanonicalWorkflowDecision is exported", () => {
    const src = read("lib/engine/canonical-workflow-decision.ts");
    assert.ok(src.includes("export function buildCanonicalWorkflowDecision"));
  });

  it("returns all required fields", () => {
    const decision = buildCanonicalWorkflowDecision(screenshotFixtureInput());
    assert.ok(decision.currentBlockingStage);
    assert.ok(decision.nextRequiredAction);
    assert.ok(decision.nextRequiredActionLabel);
    assert.ok(decision.nextRequiredActionReason);
    assert.ok(decision.blockingStageCode);
    assert.ok(Array.isArray(decision.blockerCodes));
    assert.ok(Array.isArray(decision.blockerDetails));
    assert.ok(decision.stageStates);
    assert.ok(decision.stageAvailability);
    assert.equal(typeof decision.downstreamSuppressedBy, "string");
    assert.equal(typeof decision.partialAnalysis, "boolean");
    assert.equal(typeof decision.staleAnalysis, "boolean");
    assert.equal(typeof decision.confirmedBuildPlanExists, "boolean");
    assert.equal(typeof decision.mandatoryRequirementCount, "number");
    assert.equal(typeof decision.mandatoryComplianceRowsCount, "number");
    assert.equal(typeof decision.mandatoryFullOrSubstantialCoverageCount, "number");
    assert.equal(typeof decision.requiredDocumentsTotal, "number");
    assert.equal(typeof decision.generatedDocumentsTotal, "number");
    assert.equal(typeof decision.exportReadyDocumentsTotal, "number");
    assert.equal(typeof decision.pdfRequiredButUnavailable, "boolean");
    assert.equal(typeof decision.finalExportAllowed, "boolean");
  });
});
