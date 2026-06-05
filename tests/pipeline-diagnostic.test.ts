import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Test the deriveNextAction logic extracted as pure functions.
// These mirror the logic in:
//   - app/api/tenders/[id]/pipeline-diagnostic/route.ts
//   - components/next-action-panel.tsx

type WorkflowStep =
  | "UPLOAD_TENDER"
  | "FIX_EXTRACTION"
  | "RUN_AI_ANALYZE"
  | "CONFIRM_METADATA"
  | "CONFIRM_REQUIREMENTS"
  | "BUILD_PLAN"
  | "CONFIRM_EVIDENCE"
  | "GENERATE_DOCUMENTS"
  | "VALIDATE_DOCUMENTS"
  | "REVIEW_MANIFEST"
  | "EXPORT_ZIP"
  | "COMPLETE";

interface PipelineState {
  hasFiles: boolean;
  extractionOk: boolean;
  anyCorrupted: boolean;
  anyFailed: boolean;
  avgScore: number;
  aiAnalyzed: boolean;
  analysisBlocked: boolean;
  metadataOk: boolean;
  requirementsOk: boolean;
  hasPlan: boolean;
  hasGeneratedDocs: boolean;
  validationPassed: boolean;
  criticalGapCount: number;
  exportReady: boolean;
  tenderStatus: string;
}

function deriveNextStep(state: PipelineState): WorkflowStep {
  if (!state.hasFiles) return "UPLOAD_TENDER";
  if (!state.extractionOk) return "FIX_EXTRACTION";
  if (!state.aiAnalyzed || state.analysisBlocked) return "RUN_AI_ANALYZE";
  if (!state.metadataOk) return "CONFIRM_METADATA";
  if (!state.requirementsOk) return "CONFIRM_REQUIREMENTS";
  if (!state.hasPlan) return "BUILD_PLAN";
  if (!state.hasGeneratedDocs) return "GENERATE_DOCUMENTS";
  if (!state.validationPassed || state.criticalGapCount > 0) return "VALIDATE_DOCUMENTS";
  if (!state.exportReady) return "REVIEW_MANIFEST";
  if (state.tenderStatus !== "EXPORTED") return "EXPORT_ZIP";
  return "COMPLETE";
}

const FULL_PASS: PipelineState = {
  hasFiles: true,
  extractionOk: true,
  anyCorrupted: false,
  anyFailed: false,
  avgScore: 80,
  aiAnalyzed: true,
  analysisBlocked: false,
  metadataOk: true,
  requirementsOk: true,
  hasPlan: true,
  hasGeneratedDocs: true,
  validationPassed: true,
  criticalGapCount: 0,
  exportReady: true,
  tenderStatus: "ACTIVE",
};

describe("Pipeline diagnostic — deriveNextStep", () => {
  it("returns UPLOAD_TENDER when no files", () => {
    assert.equal(deriveNextStep({ ...FULL_PASS, hasFiles: false }), "UPLOAD_TENDER");
  });

  it("returns FIX_EXTRACTION when extraction fails", () => {
    assert.equal(deriveNextStep({ ...FULL_PASS, extractionOk: false, anyFailed: true }), "FIX_EXTRACTION");
  });

  it("returns FIX_EXTRACTION when extraction score too low", () => {
    assert.equal(deriveNextStep({ ...FULL_PASS, extractionOk: false, avgScore: 30 }), "FIX_EXTRACTION");
  });

  it("returns FIX_EXTRACTION when text corrupted", () => {
    assert.equal(deriveNextStep({ ...FULL_PASS, extractionOk: false, anyCorrupted: true }), "FIX_EXTRACTION");
  });

  it("returns RUN_AI_ANALYZE when extraction ok but AI not run", () => {
    assert.equal(deriveNextStep({ ...FULL_PASS, aiAnalyzed: false }), "RUN_AI_ANALYZE");
  });

  it("returns RUN_AI_ANALYZE when analysis was blocked by corruption", () => {
    assert.equal(deriveNextStep({ ...FULL_PASS, analysisBlocked: true }), "RUN_AI_ANALYZE");
  });

  it("returns CONFIRM_METADATA when AI done but metadata incomplete", () => {
    assert.equal(deriveNextStep({ ...FULL_PASS, metadataOk: false }), "CONFIRM_METADATA");
  });

  it("returns CONFIRM_REQUIREMENTS when metadata ok but requirements missing", () => {
    assert.equal(deriveNextStep({ ...FULL_PASS, requirementsOk: false }), "CONFIRM_REQUIREMENTS");
  });

  it("returns BUILD_PLAN when requirements ok but no plan", () => {
    assert.equal(deriveNextStep({ ...FULL_PASS, hasPlan: false }), "BUILD_PLAN");
  });

  it("returns GENERATE_DOCUMENTS when plan exists but no docs generated", () => {
    assert.equal(deriveNextStep({ ...FULL_PASS, hasGeneratedDocs: false }), "GENERATE_DOCUMENTS");
  });

  it("returns VALIDATE_DOCUMENTS when docs exist but not validated", () => {
    assert.equal(deriveNextStep({ ...FULL_PASS, validationPassed: false }), "VALIDATE_DOCUMENTS");
  });

  it("returns VALIDATE_DOCUMENTS when critical compliance gaps exist", () => {
    assert.equal(deriveNextStep({ ...FULL_PASS, criticalGapCount: 2 }), "VALIDATE_DOCUMENTS");
  });

  it("returns REVIEW_MANIFEST when validated but export not ready", () => {
    assert.equal(deriveNextStep({ ...FULL_PASS, exportReady: false }), "REVIEW_MANIFEST");
  });

  it("returns EXPORT_ZIP when export ready but not yet exported", () => {
    assert.equal(deriveNextStep({ ...FULL_PASS }), "EXPORT_ZIP");
  });

  it("returns COMPLETE when tender is exported", () => {
    assert.equal(deriveNextStep({ ...FULL_PASS, tenderStatus: "EXPORTED" }), "COMPLETE");
  });

  it("extraction gate takes priority over AI analyze gate", () => {
    assert.equal(
      deriveNextStep({ ...FULL_PASS, extractionOk: false, aiAnalyzed: false }),
      "FIX_EXTRACTION",
    );
  });

  it("metadata gate takes priority over requirements gate", () => {
    assert.equal(
      deriveNextStep({ ...FULL_PASS, metadataOk: false, requirementsOk: false }),
      "CONFIRM_METADATA",
    );
  });

  it("build plan gate takes priority over generate gate", () => {
    assert.equal(
      deriveNextStep({ ...FULL_PASS, hasPlan: false, hasGeneratedDocs: false }),
      "BUILD_PLAN",
    );
  });
});

describe("Pipeline diagnostic — step ordering invariants", () => {
  it("never reaches GENERATE_DOCUMENTS without a plan", () => {
    const step = deriveNextStep({ ...FULL_PASS, hasPlan: false, hasGeneratedDocs: true });
    assert.notEqual(step, "GENERATE_DOCUMENTS");
    assert.equal(step, "BUILD_PLAN");
  });

  it("never reaches EXPORT_ZIP without validation", () => {
    const step = deriveNextStep({ ...FULL_PASS, validationPassed: false, exportReady: true });
    assert.notEqual(step, "EXPORT_ZIP");
    assert.equal(step, "VALIDATE_DOCUMENTS");
  });

  it("never reaches EXPORT_ZIP without AI Analyze", () => {
    const step = deriveNextStep({ ...FULL_PASS, aiAnalyzed: false, exportReady: true });
    assert.equal(step, "RUN_AI_ANALYZE");
  });
});
