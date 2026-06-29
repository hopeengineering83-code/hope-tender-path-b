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
      { priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: "This is a meaningful quote exceeding minimum length", sourceFileActiveInTender: true },
      { priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 2, sourceExactQuote: "Another meaningful source quote for grounding", sourceFileActiveInTender: true },
      { priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 3, sourceExactQuote: "Third requirement source quote for testing", sourceFileActiveInTender: true },
      { priority: null, sourceTenderFileId: "f1", sourcePageNumber: 4, sourceExactQuote: "Fourth requirement quote for grounding", sourceFileActiveInTender: true },
      { priority: null, sourceTenderFileId: "f1", sourcePageNumber: 5, sourceExactQuote: "Fifth requirement quote for grounding test", sourceFileActiveInTender: true },
    ],
    criticalMetadataOk: true,
    hasValidVirtualSubmissionPlan: true, exportReadyDocumentCount: 3,
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

describe("Gate blocks missing/stale submission plan", () => {
  it("blocks when submissionPlanDocumentCount is 0 (virtual plan only)", () => {
    const r = evaluateGenerationReadiness(makePassingInput({ hasValidVirtualSubmissionPlan: false, exportReadyDocumentCount: 0 }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "SUBMISSION_PLAN_MISSING");
  });
});

describe("Gate blocks ownership violations", () => {
  it("blocks when tender not owned", () => {
    const r = evaluateGenerationReadiness(makePassingInput({ tenderExistsAndOwned: false }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "OWNERSHIP_TENDER_NOT_FOUND");
  });
});

describe("Gate blocks metadata contamination", () => {
  it("blocks when criticalMetadataOk is false", () => {
    const r = evaluateGenerationReadiness(makePassingInput({ criticalMetadataOk: false }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "METADATA_CRITICAL_FIELD_INVALID");
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
      requirements: [{ priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: null, sourceExactQuote: "meaningful quote text here", sourceFileActiveInTender: true }],
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
  });
  it("blocks when MANDATORY req has no quote", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      requirements: [{ priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: null, sourceFileActiveInTender: true }],
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
  });
  it("blocks when MANDATORY req has short quote", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      requirements: [{ priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: "short", sourceFileActiveInTender: true }],
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

describe("Gate blocks stale analysis hash", () => {
  it("blocks when currentContentHash differs from latestJobHash", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      latestJobHash: "hash-abc",
      currentContentHash: "hash-xyz",
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
  it("blocks export when submissionPlanDocumentCount is 0", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      purpose: "export",
      hasValidVirtualSubmissionPlan: false, exportReadyDocumentCount: 0,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "SUBMISSION_PLAN_MISSING");
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
  it("blocks final-zip when submissionPlanDocumentCount is 0", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      purpose: "final-zip",
      hasValidVirtualSubmissionPlan: false, exportReadyDocumentCount: 0,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "SUBMISSION_PLAN_MISSING");
  });
});
