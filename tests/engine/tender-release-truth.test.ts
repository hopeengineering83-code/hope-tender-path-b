import { describe, it } from "node:test";
import assert from "node:assert";
import { evaluateGenerationReadiness, type GenerationReadinessInput } from "../../lib/engine/generation-readiness-gate";

describe("Tender Release Truth Behavioral Gates", () => {

  const baseInput: GenerationReadinessInput = {
    purpose: "generate",
    tenderExistsAndOwned: true,
    activeFileCount: 1,
    extractionFiles: [{ fileId: "f1", corrupted: false, weak: false, hasOverride: false }],
    analysisState: "AI_SUCCEEDED",
    canonicalJobId: "job1",
    latestJobHash: "hash1",
    currentContentHash: "hash1",
    fallbackApprovalBound: false,
    currentHashChunks: [{ status: "SUCCEEDED", totalChunks: 1 }],
    requirementCount: 1,
    requirements: [{ priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: "Verified evidence quote longer than 10 chars", sourceFileActiveInTender: true }],
    submissionPlanDocumentCount: 1,
    metadataBlocked: false,
    metadataBlockerReason: null,
    isLegacyAnalyzed: false,
    reviewedSelectedExperts: 1,
    totalSelectedExperts: 1,
    reviewedSelectedProjects: 1,
    totalSelectedProjects: 1,
  };

  it("allows release with AI_SUCCEEDED and fully grounded facts", () => {
    const res = evaluateGenerationReadiness(baseInput);
    assert.strictEqual(res.ok, true, "Should be eligible for release");
  });

  it("blocks release if analysis is a regex fallback (even if approved)", () => {
    const input: GenerationReadinessInput = { ...baseInput, analysisState: "HUMAN_APPROVED_FALLBACK" as any };
    const res = evaluateGenerationReadiness(input);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.blockerCode, "FALLBACK_UNAPPROVED");
  });

  it("blocks release if metadata is blocked by canonical resolver", () => {
    const input: GenerationReadinessInput = { ...baseInput, metadataBlocked: true, metadataBlockerReason: "Deadline missing grounding" };
    const res = evaluateGenerationReadiness(input);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.blockerCode, "METADATA_CRITICAL_BLOCKED");
  });

  it("blocks release if mandatory requirements are ungrounded", () => {
    const input: GenerationReadinessInput = {
      ...baseInput,
      requirements: [{ priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: "Too short", sourceFileActiveInTender: true }]
    };
    const res = evaluateGenerationReadiness(input);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
  });

  it("blocks release if selected experts are not reviewed", () => {
    const input: GenerationReadinessInput = { ...baseInput, reviewedSelectedExperts: 0, totalSelectedExperts: 1 };
    const res = evaluateGenerationReadiness(input);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.blockerCode, "VAULT_EVIDENCE_INCOMPLETE");
  });

  it("blocks release if submission plan is missing", () => {
    const input: GenerationReadinessInput = { ...baseInput, submissionPlanDocumentCount: 0 };
    const res = evaluateGenerationReadiness(input);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.blockerCode, "SUBMISSION_PLAN_MISSING");
  });
});
