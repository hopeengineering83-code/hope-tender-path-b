import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  evaluateGenerationReadiness,
  type GenerationReadinessInput,
  type GenerationPurpose,
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

const ALL_PURPOSES: GenerationPurpose[] = [
  "generate",
  "regenerate-section",
  "ai-proposal",
  "ai-proposal-persist",
  "background-proposal-generation",
  "regenerate-cvs",
  "generate-missing-plan-files",
  "export",
  "final-zip",
];

describe("stale AI analysis is never generation-authoritative", () => {
  it("blocks all purposes when the promoted job has no analysisInputHash", () => {
    for (const purpose of ALL_PURPOSES) {
      const result = evaluateGenerationReadiness(passingInput({ 
        purpose,
        latestJobHash: null,
        exportReadyDocumentCount: purpose === "export" || purpose === "final-zip" ? 1 : 0,
      }));
      assert.equal(result.ok, false, `Expected ${purpose} to be blocked`);
      assert.equal(result.blockerCode, "ANALYSIS_HASH_MISMATCH", `Expected ${purpose} to fail with ANALYSIS_HASH_MISMATCH`);
    }
  });

  it("blocks all purposes when tender content changed after AI Analyze", () => {
    for (const purpose of ALL_PURPOSES) {
      const result = evaluateGenerationReadiness(passingInput({
        purpose,
        latestJobHash: "old-hash",
        currentContentHash: "new-hash",
        exportReadyDocumentCount: purpose === "export" || purpose === "final-zip" ? 1 : 0,
      }));
      assert.equal(result.ok, false, `Expected ${purpose} to be blocked`);
      assert.equal(result.blockerCode, "ANALYSIS_HASH_MISMATCH", `Expected ${purpose} to fail with ANALYSIS_HASH_MISMATCH`);
    }
  });

  it("allows all purposes when analysis hash matches current content", () => {
    for (const purpose of ALL_PURPOSES) {
      const result = evaluateGenerationReadiness(passingInput({
        purpose,
        latestJobHash: "current-hash",
        currentContentHash: "current-hash",
        exportReadyDocumentCount: purpose === "export" || purpose === "final-zip" ? 1 : 0,
      }));
      assert.equal(result.ok, true, `Expected ${purpose} to pass when hash matches`);
    }
  });
});
