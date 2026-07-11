import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  evaluateGenerationReadiness,
  type GenerationReadinessInput,
} from "../lib/engine/generation-readiness-gate";

function passingInput(overrides: Partial<GenerationReadinessInput> = {}): GenerationReadinessInput {
  return {
    purpose: "generate",
    tenderExistsAndOwned: true,
    activeFileCount: 1,
    extractionFiles: [{ fileId: "file-1", corrupted: false, weak: false, hasOverride: false }],
    analysisState: "AI_SUCCEEDED",
    canonicalJobId: "job-1",
    latestJobHash: "current-hash",
    currentContentHash: "current-hash",
    fallbackApprovalBound: false,
    currentHashChunks: [],
    requirementCount: 1,
    requirements: [{
      priority: "MANDATORY",
      sourceTenderFileId: "file-1",
      sourcePageNumber: 1,
      sourceExactQuote: "The bidder shall provide the required evidence.",
      sourceFileActiveInTender: true,
      sourceFileExtractedText: "The bidder shall provide the required evidence.",
      sourceFileTotalPages: 1,
    }],
    criticalMetadataOk: true,
    recordedBuildPlanState: "VALID",
    exportReadyDocumentCount: 0,
    hasCurrentConfirmedBuildPlan: true,
    confirmedBuildPlanItemsValid: true,
    confirmedBuildPlanItemBlockers: [],
    confirmedPlanDocumentsOk: true,
    confirmedPlanDocumentBlockers: [],
    ...overrides,
  };
}

describe("stale AI analysis is never generation-authoritative", () => {
  it("blocks generation when the promoted job has no analysisInputHash", () => {
    const result = evaluateGenerationReadiness(passingInput({ latestJobHash: null }));
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "ANALYSIS_HASH_MISMATCH");
  });

  it("blocks generation when tender content changed after AI Analyze", () => {
    const result = evaluateGenerationReadiness(passingInput({
      latestJobHash: "old-hash",
      currentContentHash: "new-hash",
    }));
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "ANALYSIS_HASH_MISMATCH");
  });

  it("continues blocking final ZIP for the same stale state", () => {
    const result = evaluateGenerationReadiness(passingInput({
      purpose: "final-zip",
      latestJobHash: "old-hash",
      currentContentHash: "new-hash",
    }));
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "ANALYSIS_HASH_MISMATCH");
  });
});
