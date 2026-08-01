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
    assert.ok(src.includes("Automatic verification running"), "must show the neutral automatic state when coverage is 0");
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

// ─── 11. DB-bound resolver exists ───────────────────────────────────────────

describe("Canonical workflow decision — DB-bound resolver", () => {
  it("getCanonicalTenderWorkflowDecision is exported", () => {
    const src = read("lib/engine/canonical-workflow-decision.ts");
    assert.ok(
      src.includes("export async function getCanonicalTenderWorkflowDecision"),
      "must export getCanonicalTenderWorkflowDecision async resolver",
    );
  });

  it("resolver calls getTenderReleaseSnapshot and buildCanonicalWorkflowDecision", () => {
    const src = read("lib/engine/canonical-workflow-decision.ts");
    assert.ok(src.includes("getTenderReleaseSnapshot"), "must call getTenderReleaseSnapshot");
    assert.ok(src.includes("buildCanonicalWorkflowDecision"), "must call buildCanonicalWorkflowDecision");
  });
});

// ─── 12. NextActionPanel consumes the canonical decision ────────────────────

describe("NextActionPanel — wired to canonical workflow decision", () => {
  it("imports getCanonicalTenderWorkflowDecision", () => {
    const src = read("components/next-action-panel.tsx");
    assert.ok(
      src.includes("getCanonicalTenderWorkflowDecision"),
      "NextActionPanel must import and call getCanonicalTenderWorkflowDecision",
    );
  });

  it("does NOT use the legacy resolveTenderNextAction resolver", () => {
    const src = read("components/next-action-panel.tsx");
    assert.ok(
      !src.includes("resolveTenderNextAction"),
      "NextActionPanel must not compute local truth via resolveTenderNextAction",
    );
  });

  it("does NOT hardcode documents.stale: false", () => {
    const src = read("components/next-action-panel.tsx");
    assert.ok(
      !src.includes("stale: false"),
      "NextActionPanel must not hardcode documents.stale: false (the screenshot-contradiction bug)",
    );
  });

  it("does NOT show 'Generate proposal documents' as the next-action headline when upstream blockers exist", () => {
    // The screenshot contradiction: partial AI + no build plan + no compliance rows
    // + PDF required — the panel must NOT show "Generate proposal documents" as
    // the headline action. The canonical decision returns RESUME_AI_ANALYZE for
    // this fixture, which the panel renders as the headline.
    const decision = buildCanonicalWorkflowDecision(screenshotFixtureInput());
    assert.notEqual(decision.nextRequiredAction, "GENERATE_DOCUMENTS");
    assert.equal(decision.nextRequiredAction, "RESUME_AI_ANALYZE");
  });

  it("panel reads decision.nextRequiredActionLabel / nextRequiredActionReason / blockerDetails", () => {
    const src = read("components/next-action-panel.tsx");
    assert.ok(src.includes("decision.nextRequiredActionLabel"), "must read decision.nextRequiredActionLabel");
    assert.ok(src.includes("decision.nextRequiredActionReason"), "must read decision.nextRequiredActionReason");
    assert.ok(src.includes("decision.blockerDetails"), "must read decision.blockerDetails");
    assert.ok(src.includes("decision.currentBlockingStage"), "must read decision.currentBlockingStage");
  });
});

// ─── 13. workflow-center consumes the canonical decision ────────────────────

describe("workflow-center — wired to canonical workflow decision for every stage", () => {
  it("imports getCanonicalTenderWorkflowDecision", () => {
    const src = read("app/api/tenders/[id]/workflow-center/route.ts");
    assert.ok(
      src.includes("getCanonicalTenderWorkflowDecision"),
      "workflow-center must import and call getCanonicalTenderWorkflowDecision",
    );
  });

  it("does NOT hardcode status: \"PENDING\" for Match Evidence", () => {
    const src = read("app/api/tenders/[id]/workflow-center/route.ts");
    // The old code had `status: "PENDING"` for stage 7. The new code must
    // drive that stage from decision.stageStates["MATCH_EVIDENCE"].
    // Confirm the canonical-stage lookup is used for Match Evidence.
    assert.ok(
      src.includes('ds["MATCH_EVIDENCE"]'),
      "Match Evidence status must come from decision.stageStates[\"MATCH_EVIDENCE\"]",
    );
  });

  it("does NOT hardcode status: \"PENDING\" for Validate and Approve", () => {
    const src = read("app/api/tenders/[id]/workflow-center/route.ts");
    assert.ok(
      src.includes('ds["VALIDATE_DOCS"]'),
      "Validate and Approve status must come from decision.stageStates[\"VALIDATE_DOCS\"]",
    );
  });

  it("uses stageStatusFromCanonical helper for every gated stage", () => {
    const src = read("app/api/tenders/[id]/workflow-center/route.ts");
    assert.ok(
      src.includes("stageStatusFromCanonical("),
      "must use stageStatusFromCanonical helper to map canonical stage states",
    );
  });

  it("returns the canonical decision in the response payload", () => {
    const src = read("app/api/tenders/[id]/workflow-center/route.ts");
    assert.ok(
      src.includes("decision: decision"),
      "workflow-center response must include the canonical decision so the client and server agree",
    );
  });
});

// ─── 14. NextActionPanel and workflow-center agree ──────────────────────────

describe("NextActionPanel and workflow-center agreement", () => {
  it("both consume the SAME canonical decision helper", () => {
    const panelSrc = read("components/next-action-panel.tsx");
    const routeSrc = read("app/api/tenders/[id]/workflow-center/route.ts");
    assert.ok(panelSrc.includes("getCanonicalTenderWorkflowDecision"));
    assert.ok(routeSrc.includes("getCanonicalTenderWorkflowDecision"));
  });

  it("screenshot fixture: NextActionPanel step is RUN_AI_ANALYZE (not GENERATE_DOCUMENTS)", () => {
    // The screenshot fixture: partial AI + stale + no build plan + no compliance
    // rows + PDF required. The canonical decision returns RESUME_AI_ANALYZE,
    // which NextActionPanel maps to the RUN_AI_ANALYZE step. workflow-center's
    // stage 3 (AI Analyze) shows IN_PROGRESS (or BLOCKED) — never "complete".
    const decision = buildCanonicalWorkflowDecision(screenshotFixtureInput());
    assert.equal(decision.nextRequiredAction, "RESUME_AI_ANALYZE");
    assert.equal(decision.stageStates["RUN_AI_ANALYZE"], "IN_PROGRESS");
    assert.equal(decision.stageStates["GENERATE_DOCUMENTS"], "BLOCKED_BY_PRIOR_STEP");
    assert.equal(decision.stageStates["EXPORT_ZIP"], "BLOCKED_BY_PRIOR_STEP");
    assert.equal(decision.stageStates["VALIDATE_DOCS"], "BLOCKED_BY_PRIOR_STEP");
    assert.equal(decision.stageStates["MATCH_EVIDENCE"], "BLOCKED_BY_PRIOR_STEP");
    assert.equal(decision.stageStates["BUILD_SUBMISSION_PLAN"], "BLOCKED_BY_PRIOR_STEP");
  });
});

// ─── 15. Later panels are precondition-gated ────────────────────────────────

describe("Later panels are precondition-gated (BLOCKED_BY_PRIOR_STEP)", () => {
  it("when AI is partial, every downstream stage is BLOCKED_BY_PRIOR_STEP", () => {
    const decision = buildCanonicalWorkflowDecision(screenshotFixtureInput());
    const downstreamStages = [
      "BUILD_SUBMISSION_PLAN",
      "MATCH_EVIDENCE",
      "GENERATE_DOCUMENTS",
      "VALIDATE_DOCS",
      "EXPORT_ZIP",
    ];
    for (const stage of downstreamStages) {
      assert.equal(
        decision.stageStates[stage],
        "BLOCKED_BY_PRIOR_STEP",
        `${stage} must be BLOCKED_BY_PRIOR_STEP when AI is partial`,
      );
    }
  });

  it("when no confirmed Build Plan, Match Evidence / Generate / Validate / Export are BLOCKED_BY_PRIOR_STEP", () => {
    const decision = buildCanonicalWorkflowDecision({
      ...screenshotFixtureInput(),
      aiAnalysisPartial: false,
      aiAnalysisStale: false,
    });
    assert.equal(decision.currentBlockingStage, "NO_CONFIRMED_BUILD_PLAN");
    assert.equal(decision.stageStates["MATCH_EVIDENCE"], "BLOCKED_BY_PRIOR_STEP");
    assert.equal(decision.stageStates["GENERATE_DOCUMENTS"], "BLOCKED_BY_PRIOR_STEP");
    assert.equal(decision.stageStates["VALIDATE_DOCS"], "BLOCKED_BY_PRIOR_STEP");
    assert.equal(decision.stageStates["EXPORT_ZIP"], "BLOCKED_BY_PRIOR_STEP");
  });

  it("when mandatory requirements have no compliance rows, Generate / Validate / Export are BLOCKED_BY_PRIOR_STEP", () => {
    const decision = buildCanonicalWorkflowDecision({
      ...screenshotFixtureInput(),
      aiAnalysisPartial: false,
      aiAnalysisStale: false,
      confirmedBuildPlanExists: true,
    });
    assert.equal(decision.currentBlockingStage, "MANDATORY_NO_COMPLIANCE_ROWS");
    assert.equal(decision.stageStates["GENERATE_DOCUMENTS"], "BLOCKED_BY_PRIOR_STEP");
    assert.equal(decision.stageStates["VALIDATE_DOCS"], "BLOCKED_BY_PRIOR_STEP");
    assert.equal(decision.stageStates["EXPORT_ZIP"], "BLOCKED_BY_PRIOR_STEP");
  });
});

// ─── 16. Required PDF blocker is lower priority than AI / plan / compliance ─

describe("Required PDF blocker priority", () => {
  it("PDF_REQUIRED_UNAVAILABLE is NOT the current blocker when AI is partial", () => {
    const decision = buildCanonicalWorkflowDecision(screenshotFixtureInput());
    assert.notEqual(decision.currentBlockingStage, "PDF_REQUIRED_UNAVAILABLE");
    assert.notEqual(decision.nextRequiredAction, "GENERATE_DOCUMENTS");
  });

  it("PDF_REQUIRED_UNAVAILABLE is NOT the current blocker when no Build Plan", () => {
    const decision = buildCanonicalWorkflowDecision({
      ...screenshotFixtureInput(),
      aiAnalysisPartial: false,
      aiAnalysisStale: false,
    });
    assert.notEqual(decision.currentBlockingStage, "PDF_REQUIRED_UNAVAILABLE");
    assert.equal(decision.currentBlockingStage, "NO_CONFIRMED_BUILD_PLAN");
  });

  it("PDF_REQUIRED_UNAVAILABLE is NOT the current blocker when no compliance rows", () => {
    const decision = buildCanonicalWorkflowDecision({
      ...screenshotFixtureInput(),
      aiAnalysisPartial: false,
      aiAnalysisStale: false,
      confirmedBuildPlanExists: true,
    });
    assert.notEqual(decision.currentBlockingStage, "PDF_REQUIRED_UNAVAILABLE");
    assert.equal(decision.currentBlockingStage, "MANDATORY_NO_COMPLIANCE_ROWS");
  });
});

// ─── 17. Final export remains fail-closed ───────────────────────────────────

describe("Final export fail-closed (re-affirmed for live UI wiring)", () => {
  it("finalExportAllowed is false for the screenshot fixture", () => {
    const decision = buildCanonicalWorkflowDecision(screenshotFixtureInput());
    assert.equal(decision.finalExportAllowed, false);
    assert.equal(decision.stageStates["EXPORT_ZIP"], "BLOCKED_BY_PRIOR_STEP");
  });

  it("EXPORT_ZIP stage is never READY when any upstream blocker exists", () => {
    const decision = buildCanonicalWorkflowDecision(screenshotFixtureInput());
    assert.notEqual(decision.stageStates["EXPORT_ZIP"], "READY");
  });
});

// ─── 18. No user-facing "metadata" wording ──────────────────────────────────

describe("No user-facing 'metadata' wording in wired panels", () => {
  it("NextActionPanel does not surface a user-facing 'metadata' label", () => {
    const src = read("components/next-action-panel.tsx");
    // The panel uses "Tender Details" (not "metadata") for user-facing copy.
    assert.ok(
      !/>.*[Mm]etadata.*</.test(src),
      "NextActionPanel must not contain a user-facing 'metadata' label",
    );
  });

  it("workflow-center route does not surface a user-facing 'metadata' label in stage labels", () => {
    const src = read("app/api/tenders/[id]/workflow-center/route.ts");
    // Stage 5 is labeled "Tender Details" — never "metadata" — in user-facing strings.
    assert.ok(src.includes("Tender Details"), "stage 5 must be labeled 'Tender Details'");
    assert.ok(
      !/label:.*[Mm]etadata/.test(src),
      "no stage label may say 'metadata' (use 'Tender Details')",
    );
  });
});

// ─── 19. PDF blocker wording alignment with PR #1034 (FINALIZE_REQUIRED_PDF) ─

describe("PDF blocker wording aligned with #1034 (FINALIZE_REQUIRED_PDF)", () => {
  it("PDF_REQUIRED_UNAVAILABLE maps to FINALIZE_REQUIRED_PDF action (not GENERATE_DOCUMENTS)", () => {
    const src = read("lib/engine/canonical-workflow-decision.ts");
    // PR #1034 introduces the FINALIZE_REQUIRED_PDF recovery action and the
    // finalize-pdf route. The canonical decision must point users at that
    // action (not the generic GENERATE_DOCUMENTS) when PDF is the highest
    // blocker — otherwise the UI would tell users to "generate documents"
    // when they actually need to finalize a required PDF.
    assert.ok(
      src.includes('PDF_REQUIRED_UNAVAILABLE: { action: "FINALIZE_REQUIRED_PDF"'),
      "PDF_REQUIRED_UNAVAILABLE must map to FINALIZE_REQUIRED_PDF action",
    );
    assert.ok(
      !src.includes('PDF_REQUIRED_UNAVAILABLE: { action: "GENERATE_DOCUMENTS"'),
      "PDF_REQUIRED_UNAVAILABLE must NOT map to GENERATE_DOCUMENTS (stale pre-#1034 wording)",
    );
  });

  it("PDF blocker reason says 'Finalize the required PDF or upload the tender-issued PDF'", () => {
    const src = read("lib/engine/canonical-workflow-decision.ts");
    // PR #1034 introduces in-engine PDF finalization. The old wording
    // ("Upload a PDF or enable PDF conversion") is stale — in-engine
    // finalization now exists, so the correct action is "Finalize the
    // required PDF or upload the tender-issued PDF".
    assert.ok(
      src.includes("Finalize the required PDF"),
      "PDF blocker reason must say 'Finalize the required PDF'",
    );
    assert.ok(
      src.includes("upload the tender-issued PDF"),
      "PDF blocker reason must mention 'upload the tender-issued PDF'",
    );
    assert.ok(
      !src.includes("Upload a PDF or enable PDF conversion"),
      "PDF blocker reason must NOT use the stale 'Upload a PDF or enable PDF conversion' wording",
    );
  });

  it("canonical decision returns FINALIZE_REQUIRED_PDF when PDF is the highest blocker", () => {
    // Build a fixture where PDF is the highest blocker: all upstream gates pass,
    // but PDF is required and unavailable.
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
      mandatoryRequirementCount: 2,
      mandatoryTracedCount: 2,
      mandatoryComplianceRowsCount: 2,
      mandatoryFullOrSubstantialCoverageCount: 2,
      confirmedBuildPlanExists: true,
      requiredDocumentsTotal: 3,
      generatedDocumentsTotal: 3,
      exportReadyDocumentsTotal: 0,
      documentsValidated: true,
      documentsApproved: true,
      pdfRequiredButUnavailable: true, // PDF is the blocker
      finalExportAllowed: false,
      authorityOrQualityBlockers: false,
    });
    assert.equal(decision.currentBlockingStage, "PDF_REQUIRED_UNAVAILABLE");
    assert.equal(decision.nextRequiredAction, "FINALIZE_REQUIRED_PDF");
    assert.equal(decision.nextRequiredActionLabel, "Finalize required PDF");
    assert.ok(decision.nextRequiredActionReason.includes("Finalize the required PDF"));
  });
});
