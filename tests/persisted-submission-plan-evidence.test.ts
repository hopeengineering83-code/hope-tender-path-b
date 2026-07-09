/**
 * Behavioral tests for persisted submission plan + requirement evidence.
 *
 * Tests the gate-level logic proving:
 * 1. A virtual preview or DRAFT plan cannot authorize generation
 * 2. Only a current CONFIRMED persisted plan can authorize generation
 * 3. Every mandatory requirement needs approved requirement-level evidence
 * 4. PLANNED/SUPERSEDED/virtual never count as export-ready
 * 5. Existing #917 safety tests still pass
 * 6. URL bypasses removed
 * 7. Cross-user denied
 * 8. One successful controlled flow + multiple blocked flows
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { evaluateGenerationReadiness, type GenerationReadinessInput } from "../lib/engine/generation-readiness-gate";

function makePassingInput(overrides: Partial<GenerationReadinessInput> = {}): GenerationReadinessInput {
  return {
    purpose: "generate",
    tenderExistsAndOwned: true,
    activeFileCount: 1,
    extractionFiles: [{ fileId: "f1", corrupted: false, weak: false, hasOverride: false }],
    analysisState: "AI_SUCCEEDED",
    canonicalJobId: "job-1",
    latestJobHash: "hash-abc",
    currentContentHash: "hash-abc",
    fallbackApprovalBound: false,
    currentHashChunks: [{ status: "SUCCEEDED", totalChunks: 1 }],
    requirementCount: 5,
    requirements: [
      { priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: "This is a meaningful quote exceeding minimum length", sourceFileActiveInTender: true, sourceFileExtractedText: "This is a meaningful quote exceeding minimum length.", sourceFileTotalPages: 5 },
    ],
    criticalMetadataOk: true,
    hasCurrentConfirmedBuildPlan: true,
    confirmedPlanDocumentsOk: true,
      confirmedBuildPlanItemsValid: true,
    recordedBuildPlanState: "VALID",
    exportReadyDocumentCount: 3,
    ...overrides,
  };
}

describe("Persisted submission plan — DRAFT cannot authorize generation", () => {
  it("blocks generation when hasCurrentConfirmedBuildPlan is false (DRAFT plan only)", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      hasCurrentConfirmedBuildPlan: false,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "BUILD_PLAN_NOT_CONFIRMED");
  });

  it("blocks generation when hasCurrentConfirmedBuildPlan is false even with evidence", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      hasCurrentConfirmedBuildPlan: false,
      confirmedPlanDocumentsOk: true,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "BUILD_PLAN_NOT_CONFIRMED");
  });
});

describe("Persisted submission plan — only CONFIRMED plan authorizes generation", () => {
  it("allows generation when hasCurrentConfirmedBuildPlan is true + evidence approved", () => {
    const r = evaluateGenerationReadiness(makePassingInput());
    assert.equal(r.ok, true);
  });

  it("blocks export when plan is confirmed but confirmed-plan documents are missing", () => {
    // Confirmed-plan document reconciliation is an EXPORT/final-ZIP condition:
    // it verifies generated documents against the confirmed plan, so it cannot
    // gate generation itself (documents do not exist before generation).
    const r = evaluateGenerationReadiness(makePassingInput({
      purpose: "export",
      hasCurrentConfirmedBuildPlan: true,
      confirmedPlanDocumentsOk: false,
      exportReadyDocumentCount: 0,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "CONFIRMED_PLAN_DOCUMENTS_INCOMPLETE");
  });

  it("blocks generation when evidence approved but plan not confirmed", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      hasCurrentConfirmedBuildPlan: false,
      confirmedPlanDocumentsOk: true,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "BUILD_PLAN_NOT_CONFIRMED");
  });
});

describe("Requirement evidence — mandatory requirements need approved evidence", () => {
  it("blocks export when confirmedPlanDocumentsOk is false", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      purpose: "export",
      confirmedPlanDocumentsOk: false,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "CONFIRMED_PLAN_DOCUMENTS_INCOMPLETE");
  });

  it("blocks export when evidence missing", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      purpose: "export",
      confirmedPlanDocumentsOk: false,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "CONFIRMED_PLAN_DOCUMENTS_INCOMPLETE");
  });

  it("blocks final-zip when evidence missing", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      purpose: "final-zip",
      confirmedPlanDocumentsOk: false,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "CONFIRMED_PLAN_DOCUMENTS_INCOMPLETE");
  });
});

describe("Export/final-ZIP — PLANNED/SUPERSEDED/virtual never count", () => {
  it("blocks export when exportReadyDocumentCount is 0 (only PLANNED/virtual)", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      purpose: "export",
      exportReadyDocumentCount: 0,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "NO_EXPORT_READY_DOCUMENTS");
  });

  it("blocks final-zip when exportReadyDocumentCount is 0", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      purpose: "final-zip",
      exportReadyDocumentCount: 0,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "NO_EXPORT_READY_DOCUMENTS");
  });

  it("allows export when exportReadyDocumentCount > 0 (real generated files)", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      purpose: "export",
      exportReadyDocumentCount: 3,
    }));
    assert.equal(r.ok, true);
  });
});

describe("URL bypasses removed — no acceptPartialExtraction/acceptNoMandatoryReqs", () => {
  it("generate route source does not check acceptPartialExtraction for bypass", () => {
    const { readFileSync } = require("node:fs");
    const src = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
    // The bypass pattern should NOT appear as an authorization condition
    assert.ok(
      !src.includes('acceptPartialExtraction") !== "true"'),
      "acceptPartialExtraction bypass must be removed",
    );
    assert.ok(
      !src.includes('acceptNoMandatoryReqs") !== "true"'),
      "acceptNoMandatoryReqs bypass must be removed",
    );
  });
});

describe("Cross-user denied", () => {
  it("blocks when tenderExistsAndOwned is false", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      tenderExistsAndOwned: false,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "OWNERSHIP_TENDER_NOT_FOUND");
  });
});

describe("Controlled flow — one success + multiple blocked", () => {
  it("SUCCESS: all conditions pass → allows generation", () => {
    const r = evaluateGenerationReadiness(makePassingInput());
    assert.equal(r.ok, true);
  });

  it("BLOCKED: corrupted extraction", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      extractionFiles: [{ fileId: "f1", corrupted: true, weak: false, hasOverride: false }],
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "EXTRACTION_CORRUPTED");
  });

  it("BLOCKED: regex fallback", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      analysisState: "REGEX_FALLBACK_UNAPPROVED",
    }));
    assert.equal(r.ok, false);
  });

  it("BLOCKED: ungrounded mandatory requirement", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      requirements: [{ priority: "MANDATORY", sourceTenderFileId: null, sourcePageNumber: null, sourceExactQuote: null, sourceFileActiveInTender: false }],
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
  });

  it("NOT BLOCKED: tender facts (advisory for draft generation)", () => {
    // Tender-facts model: draft generation is NOT blocked by missing optional
    // tender details. Only export/final-zip fail-closes on criticalMetadataOk=false.
    const r = evaluateGenerationReadiness(makePassingInput({
      criticalMetadataOk: false,
      purpose: "generate",
    }));
    assert.equal(r.ok, true, "draft generation must NOT be blocked by missing optional tender details");
    assert.notEqual(r.blockerCode, "TENDER_FACTS_INVALID");
  });

  it("BLOCKED: unsafe tender facts on final export (TENDER_FACTS_INVALID)", () => {
    // PR #1004 weakened this by making metadata fully advisory. The
    // restoration re-enables fail-closed behavior for export/final-zip.
    // Blocker code renamed from METADATA_CRITICAL_FIELD_INVALID to
    // TENDER_FACTS_INVALID per the unified tender-facts model.
    const r = evaluateGenerationReadiness(makePassingInput({
      criticalMetadataOk: false,
      purpose: "export",
    }));
    assert.equal(r.ok, false, "export MUST be blocked when criticalMetadataOk=false (fail-closed)");
    assert.equal(r.blockerCode, "TENDER_FACTS_INVALID");
  });

  it("BLOCKED: stale hash (for export/final-zip)", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      latestJobHash: "hash-abc",
      currentContentHash: "hash-xyz",
      purpose: "export",
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "ANALYSIS_HASH_MISMATCH");
  });
});

describe("Existing #917 safety tests still pass", () => {
  it("HUMAN_APPROVED_FALLBACK blocks", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      analysisState: "HUMAN_APPROVED_FALLBACK" as any,
      fallbackApprovalBound: true,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "FALLBACK_NOT_ALLOWED");
  });

  it("weak extraction without override blocks", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      extractionFiles: [{ fileId: "f1", corrupted: false, weak: true, hasOverride: false }],
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "EXTRACTION_WEAK_NO_OVERRIDE");
  });

  it("missing plan blocks generation", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      hasCurrentConfirmedBuildPlan: false,
      confirmedPlanDocumentsOk: false,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "BUILD_PLAN_NOT_CONFIRMED");
  });
});
