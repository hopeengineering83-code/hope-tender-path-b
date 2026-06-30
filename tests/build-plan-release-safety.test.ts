import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateGenerationReadiness } from "../lib/engine/generation-readiness-gate";
import { CANONICAL_AI_PROVIDER_ORDER } from "../lib/ai-provider-registry";

describe("Section C release safety", () => {
  const base = {
    purpose: "generate" as const,
    tenderExistsAndOwned: true,
    activeFileCount: 1,
    extractionFiles: [{ fileId: "f1", corrupted: false, weak: false, hasOverride: false }],
    analysisState: "AI_SUCCEEDED" as const,
    canonicalJobId: "job1",
    latestJobHash: "hash",
    currentContentHash: "hash",
    fallbackApprovalBound: false,
    currentHashChunks: [],
    requirementCount: 1,
    requirements: [{ priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: "meaningful source quote", sourceFileActiveInTender: true }],
    criticalMetadataOk: true,
    hasValidVirtualSubmissionPlan: true,
    exportReadyDocumentCount: 1,
  };

  it("blocks release actions when the Build Plan is not current and confirmed", () => {
    const result = evaluateGenerationReadiness({ ...base, hasCurrentConfirmedBuildPlan: false });
    assert.equal(result.ok, false);
    assert.equal(result.blockerCode, "BUILD_PLAN_NOT_CONFIRMED");
  });

  it("permits generation only after all gates including confirmed Build Plan pass", () => {
    const result = evaluateGenerationReadiness({ ...base, hasCurrentConfirmedBuildPlan: true });
    assert.equal(result.ok, true);
  });

  it("keeps Anthropic last in actual automatic runtime fallback", () => {
    assert.deepEqual(CANONICAL_AI_PROVIDER_ORDER, ["gemini", "openrouter", "openai", "groq", "deepseek", "anthropic"]);
  });
});
