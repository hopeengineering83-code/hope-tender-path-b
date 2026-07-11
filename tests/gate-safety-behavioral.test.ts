/**
 * Direct behavioral tests for generation/export gate safety.
 *
 * These tests call evaluateGenerationReadiness directly with controlled inputs
 * to verify the gate blocks for every unsafe condition. No source-text inspection,
 * no tautological assertions — every test exercises the real decision function.
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
      { priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: "This is a meaningful quote exceeding minimum length", sourceFileActiveInTender: true, sourceFileExtractedText: "This tender document contains the following: This is a meaningful quote exceeding minimum length. Additional context for the tender file extraction." },
      { priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 2, sourceExactQuote: "Another meaningful source quote for grounding", sourceFileActiveInTender: true, sourceFileExtractedText: "This tender document contains the following: Another meaningful source quote for grounding. Additional context for the tender file extraction." },
      { priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 3, sourceExactQuote: "Third requirement source quote for testing", sourceFileActiveInTender: true, sourceFileExtractedText: "This tender document contains the following: Third requirement source quote for testing. Additional context for the tender file extraction." },
      { priority: null, sourceTenderFileId: "f1", sourcePageNumber: 4, sourceExactQuote: "Fourth requirement quote for grounding", sourceFileActiveInTender: true, sourceFileExtractedText: "This tender document contains the following: Fourth requirement quote for grounding. Additional context for the tender file extraction." },
      { priority: null, sourceTenderFileId: "f1", sourcePageNumber: 5, sourceExactQuote: "Fifth requirement quote for grounding test", sourceFileActiveInTender: true, sourceFileExtractedText: "This tender document contains the following: Fifth requirement quote for grounding test. Additional context for the tender file extraction." },
    ],
    criticalMetadataOk: true, exportReadyDocumentCount: 3,
    // BuildPlan enforcement is fail-closed: default to true so the "passing"
    // base case passes; tests that exercise the BuildPlan blocker override.
    hasCurrentConfirmedBuildPlan: true,
    confirmedBuildPlanItemsValid: true,
    confirmedPlanDocumentsOk: true,
    recordedBuildPlanState: "VALID" as const,
    ...overrides,
  };
}

describe("Gate blocks regex fallback analysis", () => {
  it("blocks REGEX_FALLBACK_UNAPPROVED", () => {
    const r = evaluateGenerationReadiness(makePassingInput({ analysisState: "REGEX_FALLBACK_UNAPPROVED" }));
    assert.equal(r.ok, false);
    assert.ok(r.blockerCode === "FALLBACK_UNAPPROVED" || r.blockerCode === "FALLBACK_NOT_ALLOWED");
  });
  it("blocks HUMAN_APPROVED_FALLBACK even with fallbackApprovalBound=true", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      analysisState: "HUMAN_APPROVED_FALLBACK" as any,
      fallbackApprovalBound: true,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "FALLBACK_NOT_ALLOWED");
  });
});

describe("Gate blocks partial/failed analysis", () => {
  it("blocks FAILED", () => {
    const r = evaluateGenerationReadiness(makePassingInput({ analysisState: "FAILED" }));
    assert.equal(r.ok, false);
  });
  it("blocks RUNNING", () => {
    const r = evaluateGenerationReadiness(makePassingInput({ analysisState: "RUNNING" }));
    assert.equal(r.ok, false);
  });
  it("blocks NOT_STARTED", () => {
    const r = evaluateGenerationReadiness(makePassingInput({ analysisState: "NOT_STARTED" }));
    assert.equal(r.ok, false);
  });
  it("blocks QUEUED", () => {
    const r = evaluateGenerationReadiness(makePassingInput({ analysisState: "QUEUED" }));
    assert.equal(r.ok, false);
  });
});

describe("Gate blocks corrupted/weak extraction", () => {
  it("blocks corrupted extraction (hard block, not overridable)", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      extractionFiles: [{ fileId: "f1", corrupted: true, weak: false, hasOverride: false }],
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "EXTRACTION_CORRUPTED");
  });
  it("blocks corrupted extraction even with override", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      extractionFiles: [{ fileId: "f1", corrupted: true, weak: false, hasOverride: true }],
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "EXTRACTION_CORRUPTED");
  });
  it("blocks weak extraction without override", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      extractionFiles: [{ fileId: "f1", corrupted: false, weak: true, hasOverride: false }],
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "EXTRACTION_WEAK_NO_OVERRIDE");
  });
  it("allows weak extraction WITH override", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      extractionFiles: [{ fileId: "f1", corrupted: false, weak: true, hasOverride: true }],
    }));
    assert.notEqual(r.blockerCode, "EXTRACTION_WEAK_NO_OVERRIDE");
  });
});

describe("Gate blocks missing/stale BuildPlan", () => {
  it("blocks when BuildPlan is missing", () => {
    const r = evaluateGenerationReadiness(makePassingInput({ hasCurrentConfirmedBuildPlan: false, recordedBuildPlanState: "MISSING" as const, exportReadyDocumentCount: 0 }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "BUILD_PLAN_MISSING");
  });
});

describe("Gate blocks ownership violations", () => {
  it("blocks when tender not owned", () => {
    const r = evaluateGenerationReadiness(makePassingInput({ tenderExistsAndOwned: false }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "OWNERSHIP_TENDER_NOT_FOUND");
  });
});

describe("Gate enforces tender-facts safety (draft advisory, final fail-closed)", () => {
  // PR #1004 weakened final-output safety by making metadata fully advisory.
  // This restoration re-enables the gate for FINAL purposes (export, final-zip)
  // only — draft generation remains unblocked. The blocker code is renamed
  // from METADATA_CRITICAL_FIELD_INVALID to TENDER_FACTS_INVALID.
  it("does NOT block draft when criticalMetadataOk is false (advisory for draft)", () => {
    const r = evaluateGenerationReadiness(makePassingInput({ criticalMetadataOk: false, purpose: "generate" }));
    assert.equal(r.ok, true, "draft generation must NOT be blocked by missing optional tender details");
    assert.notEqual(r.blockerCode, "TENDER_FACTS_INVALID");
  });

  it("BLOCKS export with TENDER_FACTS_INVALID when criticalMetadataOk is false", () => {
    const r = evaluateGenerationReadiness(makePassingInput({ criticalMetadataOk: false, purpose: "export" }));
    assert.equal(r.ok, false, "export MUST be blocked when criticalMetadataOk=false (fail-closed)");
    assert.equal(r.blockerCode, "TENDER_FACTS_INVALID");
  });

  it("BLOCKS final-zip with TENDER_FACTS_INVALID when criticalMetadataOk is false", () => {
    const r = evaluateGenerationReadiness(makePassingInput({ criticalMetadataOk: false, purpose: "final-zip" }));
    assert.equal(r.ok, false, "final-zip MUST be blocked when criticalMetadataOk=false (fail-closed)");
    assert.equal(r.blockerCode, "TENDER_FACTS_INVALID");
  });
});

describe("Gate blocks ungrounded mandatory requirements", () => {
  it("blocks when MANDATORY req has no source file", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      requirements: [{ priority: "MANDATORY", sourceTenderFileId: null, sourcePageNumber: null, sourceExactQuote: null, sourceFileActiveInTender: false }],
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
  });
  it("blocks when MANDATORY req has no page", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      requirements: [{ priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: null, sourceExactQuote: "meaningful quote text here", sourceFileActiveInTender: true, sourceFileExtractedText: "This tender document contains the following: meaningful quote text here. Additional context for the tender file extraction." }],
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
  });
  it("blocks when MANDATORY req has no quote", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      requirements: [{ priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: null, sourceFileActiveInTender: true, sourceFileExtractedText: "This tender requires a meaningful source quote for the technical proposal. Another meaningful source quote for grounding. Third requirement source quote for testing." }],
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
  });
  it("blocks when MANDATORY req has short quote", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      requirements: [{ priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: "short", sourceFileActiveInTender: true, sourceFileExtractedText: "This tender document contains the following: short. Additional context for the tender file extraction." }],
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
  });
  it("blocks when source file is not active (stale)", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      requirements: [{ priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: "meaningful quote text", sourceFileActiveInTender: false }],
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
  });
});

describe("Gate blocks stale analysis hash (for export/final-zip)", () => {
  it("blocks when currentContentHash differs from latestJobHash (export purpose)", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      latestJobHash: "hash-abc",
      currentContentHash: "hash-xyz",
      purpose: "export",
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "ANALYSIS_HASH_MISMATCH");
  });

  it("ALSO blocks draft generation when content hash differs (stale analysis is unsafe for all purposes)", () => {
    // PR #1053: stale analysis now blocks ALL purposes, not just export/final-zip.
    // Running the engine on stale analysis produces incorrect requirements,
    // matching, and compliance — the user must re-run AI Analyze first.
    const r = evaluateGenerationReadiness(makePassingInput({
      latestJobHash: "hash-abc",
      currentContentHash: "hash-xyz",
      purpose: "generate",
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "ANALYSIS_HASH_MISMATCH");
  });
});

describe("Gate allows when all conditions pass", () => {
  it("unlocks for fully-passing input", () => {
    const r = evaluateGenerationReadiness(makePassingInput());
    assert.equal(r.ok, true);
    assert.equal(r.blockerCode, undefined);
  });
});

describe("Gate blocks for export purpose too", () => {
  it("blocks export when no export-ready documents", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      purpose: "export", exportReadyDocumentCount: 0,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "NO_EXPORT_READY_DOCUMENTS");
  });
  it("blocks export when corrupted extraction", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      purpose: "export",
      extractionFiles: [{ fileId: "f1", corrupted: true, weak: false, hasOverride: false }],
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "EXTRACTION_CORRUPTED");
  });
});

describe("Gate blocks for final-zip purpose", () => {
  it("blocks final-zip when no export-ready documents", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      purpose: "final-zip", exportReadyDocumentCount: 0,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "NO_EXPORT_READY_DOCUMENTS");
  });
});
