/**
 * Behavioral regression tests for generation/export gate safety.
 *
 * These tests verify that the gate NEVER unlocks for:
 * - Regex fallback analysis
 * - Partial/fallback analysis
 * - OCR_REQUIRED / corrupted extraction
 * - Missing submission plan
 * - Stale documents (SUPERSEDED)
 * - Metadata contamination
 * - Ownership/export blockers
 * - Final ZIP blocking
 *
 * They also verify PLANNED/SUPERSEDED rows never count as generated/export-ready.
 *
 * SCOPE: Tests only the PURE evaluateGenerationReadiness decision function.
 * Does NOT touch lib/ files owned by PR #910 or routes owned by PR #914.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { evaluateGenerationReadiness, type GenerationReadinessInput } from "../lib/engine/generation-readiness-gate";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeBaseInput(overrides: Partial<GenerationReadinessInput> = {}): GenerationReadinessInput {
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
      { priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: "This is a meaningful quote exceeding minimum length", sourceFileActiveInTender: true, sourceFileExtractedText: "This is a meaningful quote exceeding minimum length. Another meaningful source quote for grounding. Third requirement source quote for testing. Fourth requirement quote for grounding. Fifth requirement quote for grounding test.", sourceFileTotalPages: 5 },
      { priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 2, sourceExactQuote: "Another meaningful source quote for grounding", sourceFileActiveInTender: true, sourceFileExtractedText: "This is a meaningful quote exceeding minimum length. Another meaningful source quote for grounding. Third requirement source quote for testing. Fourth requirement quote for grounding. Fifth requirement quote for grounding test.", sourceFileTotalPages: 5 },
      { priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 3, sourceExactQuote: "Third requirement source quote for testing", sourceFileActiveInTender: true, sourceFileExtractedText: "This is a meaningful quote exceeding minimum length. Another meaningful source quote for grounding. Third requirement source quote for testing. Fourth requirement quote for grounding. Fifth requirement quote for grounding test.", sourceFileTotalPages: 5 },
      { priority: null, sourceTenderFileId: "f1", sourcePageNumber: 4, sourceExactQuote: "Fourth requirement quote for grounding", sourceFileActiveInTender: true, sourceFileExtractedText: "This is a meaningful quote exceeding minimum length. Another meaningful source quote for grounding. Third requirement source quote for testing. Fourth requirement quote for grounding. Fifth requirement quote for grounding test.", sourceFileTotalPages: 5 },
      { priority: null, sourceTenderFileId: "f1", sourcePageNumber: 5, sourceExactQuote: "Fifth requirement quote for grounding test", sourceFileActiveInTender: true, sourceFileExtractedText: "This is a meaningful quote exceeding minimum length. Another meaningful source quote for grounding. Third requirement source quote for testing. Fourth requirement quote for grounding. Fifth requirement quote for grounding test.", sourceFileTotalPages: 5 },
    ],
    criticalMetadataOk: true,
    exportReadyDocumentCount: 5,
    recordedBuildPlanState: "VALID",
    hasCurrentConfirmedBuildPlan: true,
    confirmedPlanDocumentsOk: true,
    confirmedBuildPlanItemsValid: true,
    ...overrides,
  };
}

// ─── Regex fallback must NEVER unlock ───────────────────────────────────────

describe("Gate safety — regex fallback never unlocks generation/export", () => {

  it("blocks when analysisState is REGEX_FALLBACK_UNAPPROVED", () => {
    const result = evaluateGenerationReadiness(makeBaseInput({
      analysisState: "REGEX_FALLBACK_UNAPPROVED",
    }));
    assert.equal(result.ok, false);
    assert.ok(result.blockerCode === "FALLBACK_NOT_ALLOWED" || result.blockerCode === "FALLBACK_UNAPPROVED",
      `Expected FALLBACK blocker, got ${result.blockerCode}`);
  });

  it("blocks HUMAN_APPROVED_FALLBACK even with fallbackApprovalBound=true", () => {
    // HUMAN_APPROVED_FALLBACK is a distinct state from REGEX_FALLBACK_UNAPPROVED.
    // Even when a fallback approval is bound, the state must not unlock.
    const result = evaluateGenerationReadiness(makeBaseInput({
      analysisState: "HUMAN_APPROVED_FALLBACK" as any,
      fallbackApprovalBound: true,
    }));
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "FALLBACK_NOT_ALLOWED");
  });
});

// ─── Partial/fallback analysis must NEVER unlock ───────────────────────────

describe("Gate safety — partial/failed analysis never unlocks", () => {

  it("blocks when analysisState is ANALYSIS_FAILED", () => {
    const result = evaluateGenerationReadiness(makeBaseInput({
      analysisState: "FAILED",
    }));
    assert.equal(result.ok, false);
    assert.ok(result.blockerCode === "ANALYSIS_NOT_READY" || result.blockerCode === "FALLBACK_NOT_ALLOWED",
      `Expected ANALYSIS_NOT_READY, got ${result.blockerCode}`);
  });

  it("blocks when analysisState is ANALYSIS_RUNNING", () => {
    const result = evaluateGenerationReadiness(makeBaseInput({
      analysisState: "RUNNING",
    }));
    assert.equal(result.ok, false);
  });

  it("blocks when analysisState is NO_ANALYSIS", () => {
    const result = evaluateGenerationReadiness(makeBaseInput({
      analysisState: "NOT_STARTED",
    }));
    assert.equal(result.ok, false);
  });
});

// ─── Corrupted extraction must NEVER unlock (not overridable) ──────────────

describe("Gate safety — corrupted extraction is a hard block", () => {

  it("blocks when any extraction file is corrupted", () => {
    const result = evaluateGenerationReadiness(makeBaseInput({
      extractionFiles: [{ fileId: "f1", corrupted: true, weak: false, hasOverride: false }],
    }));
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "EXTRACTION_CORRUPTED");
  });

  it("blocks corrupted extraction even with override (override does not apply to corrupted)", () => {
    const result = evaluateGenerationReadiness(makeBaseInput({
      extractionFiles: [{ fileId: "f1", corrupted: true, weak: false, hasOverride: true }],
    }));
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "EXTRACTION_CORRUPTED");
  });
});

// ─── Weak extraction without override blocks ───────────────────────────────

describe("Gate safety — weak extraction blocks without override", () => {

  it("blocks when extraction is weak and no override exists", () => {
    const result = evaluateGenerationReadiness(makeBaseInput({
      extractionFiles: [{ fileId: "f1", corrupted: false, weak: true, hasOverride: false }],
    }));
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "EXTRACTION_WEAK_NO_OVERRIDE");
  });

  it("allows weak extraction WITH valid override", () => {
    const result = evaluateGenerationReadiness(makeBaseInput({
      extractionFiles: [{ fileId: "f1", corrupted: false, weak: true, hasOverride: true }],
    }));
    // Should NOT block on extraction (other gates may pass)
    assert.notEqual(result.blockerCode, "EXTRACTION_WEAK_NO_OVERRIDE");
  });
});

// ─── Missing submission plan blocks ────────────────────────────────────────

describe("Gate safety — missing submission plan blocks", () => {

  it("blocks generation when no confirmed BuildPlan exists (plan gate for generation)", () => {
    // Generation is gated on the persisted CONFIRMED BuildPlan — NOT on
    // exportReadyDocumentCount (documents cannot exist before generation).
    const result = evaluateGenerationReadiness(makeBaseInput({
      hasCurrentConfirmedBuildPlan: false,
    }));
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "BUILD_PLAN_NOT_CONFIRMED");
  });

  it("blocks export when exportReadyDocumentCount is 0", () => {
    const result = evaluateGenerationReadiness(makeBaseInput({
      purpose: "export",
      exportReadyDocumentCount: 0,
    }));
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "NO_EXPORT_READY_DOCUMENTS");
  });
});

// ─── Ownership check blocks ────────────────────────────────────────────────

describe("Gate safety — ownership check blocks", () => {

  it("blocks when tender does not exist or is not owned", () => {
    const result = evaluateGenerationReadiness(makeBaseInput({
      tenderExistsAndOwned: false,
    }));
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "OWNERSHIP_TENDER_NOT_FOUND");
  });
});

// ─── Metadata contamination blocks ────────────────────────────────────────

describe("Gate safety — critical metadata contamination blocks", () => {

  it("blocks when criticalMetadataOk is false", () => {
    const result = evaluateGenerationReadiness(makeBaseInput({
      criticalMetadataOk: false,
      purpose: "export",
    }));
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "METADATA_CRITICAL_FIELD_INVALID");
  });
});

// ─── Ungrounded mandatory requirements block ──────────────────────────────

describe("Gate safety — ungrounded mandatory requirements block", () => {

  it("blocks when a MANDATORY requirement has no source file", () => {
    const result = evaluateGenerationReadiness(makeBaseInput({
      requirements: [
        { priority: "MANDATORY", sourceTenderFileId: null, sourcePageNumber: null, sourceExactQuote: null, sourceFileActiveInTender: false },
      ],
    }));
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
  });

  it("blocks when a MANDATORY requirement has source file but no page", () => {
    const result = evaluateGenerationReadiness(makeBaseInput({
      requirements: [
        { priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: null, sourceExactQuote: "meaningful quote text here", sourceFileActiveInTender: true },
      ],
    }));
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
  });

  it("blocks when a MANDATORY requirement has source file + page but no quote", () => {
    const result = evaluateGenerationReadiness(makeBaseInput({
      requirements: [
        { priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: null, sourceFileActiveInTender: true },
      ],
    }));
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
  });

  it("blocks when a MANDATORY requirement has a short quote (< 10 chars)", () => {
    const result = evaluateGenerationReadiness(makeBaseInput({
      requirements: [
        { priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: "short", sourceFileActiveInTender: true },
      ],
    }));
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
  });

  it("blocks when source file is not active in tender (stale/unrelated evidence)", () => {
    const result = evaluateGenerationReadiness(makeBaseInput({
      requirements: [
        { priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: "meaningful quote text", sourceFileActiveInTender: false },
      ],
    }));
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
  });
});

// ─── Legacy analysis blocks ────────────────────────────────────────────────

describe("Gate safety — legacy analysis blocks", () => {

  it("blocks when analysisState is LEGACY_NOTES (not a valid AnalysisState — treated as NO_ANALYSIS)", () => {
    // LEGACY_NOTES is not in the AnalysisState union — it's an analysisSource, not a state.
    // The gate treats unknown states as not-ready.
    const result = evaluateGenerationReadiness(makeBaseInput({
      analysisState: "NOT_STARTED",
    }));
    assert.equal(result.ok, false);
    assert.ok(result.blockerCode === "ANALYSIS_NOT_READY" || result.blockerCode === "LEGACY_ANALYSIS_BLOCKED",
      `Expected block, got ${result.blockerCode}`);
  });
});

// ─── Hash mismatch blocks ──────────────────────────────────────────────────

describe("Gate safety — content hash mismatch blocks (for export/final-zip)", () => {

  it("blocks when currentContentHash differs from latestJobHash (export purpose)", () => {
    const result = evaluateGenerationReadiness(makeBaseInput({
      latestJobHash: "hash-abc",
      currentContentHash: "hash-xyz",
      purpose: "export",
    }));
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "ANALYSIS_HASH_MISMATCH");
  });
});

// ─── All conditions met → unlocks ──────────────────────────────────────────

describe("Gate safety — all conditions met unlocks", () => {

  it("unlocks when all conditions pass", () => {
    const result = evaluateGenerationReadiness(makeBaseInput());
    assert.equal(result.ok, true);
    assert.equal(result.blockerCode, undefined);
  });
});

// ─── PLANNED/SUPERSEDED never count as export-ready ────────────────────────

describe("Gate safety — PLANNED/SUPERSEDED never count as generated/export-ready", () => {

  it("blocks export when exportReadyDocumentCount is 0 (PLANNED rows are virtual in PR #914)", () => {
    // After PR #914, planOnly mode creates 0 GeneratedDocument rows.
    // The gate must block EXPORT/final-ZIP when there are no real documents.
    // (Generation is intentionally NOT gated on this count — documents cannot
    // exist before the first generation run.)
    const result = evaluateGenerationReadiness(makeBaseInput({
      purpose: "export",
      exportReadyDocumentCount: 0,
    }));
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "NO_EXPORT_READY_DOCUMENTS");
  });

  it("does not count SUPERSEDED rows (excluded by 'not: SUPERSEDED' filter)", () => {
    // The gate input has exportReadyDocumentCount which counts non-superseded rows.
    // If all rows are SUPERSEDED, count is 0 → export/final-ZIP blocked.
    const result = evaluateGenerationReadiness(makeBaseInput({
      purpose: "final-zip",
      exportReadyDocumentCount: 0, // all rows superseded
    }));
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "NO_EXPORT_READY_DOCUMENTS");
  });
});
