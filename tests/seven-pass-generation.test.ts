import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateSevenPassGenerationGate, sevenPassBlocksFinalApproval } from "../lib/engine/quality/seven-pass-generation";

const strongInput = {
  analysisSource: "AI",
  evidenceCoverageRatio: 0.9,
  reviewedEvidenceCount: 4,
  requiredEvidenceCount: 4,
  unsupportedClaimCount: 0,
  placeholderCount: 0,
  aiTraceCount: 0,
  pricingLeakageCount: 0,
  officialOriginalRiskCount: 0,
  technicalFinancialSeparationOk: true,
  tenderScopeOnly: true,
  outlineMatchesTender: true,
  selectedEvidenceTrustLevels: ["REVIEWED", "REVIEWED"],
  selfReviewScore: 86,
  deterministicFallbackUsed: false,
};

describe("seven-pass generation gate", () => {
  it("allows senior-quality final approval only when every pass is clean", () => {
    const result = evaluateSevenPassGenerationGate(strongInput);
    assert.equal(result.finalApprovalAllowed, true);
    assert.equal(result.recommendedValidationStatus, "PASSED");
    assert.equal(result.recommendedReviewStatus, "READY_FOR_EXPORT");
    assert.equal(result.passes.length, 7);
    assert.deepEqual(result.blockers, []);
  });

  it("blocks final approval when evidence coverage is zero", () => {
    const result = evaluateSevenPassGenerationGate({ ...strongInput, evidenceCoverageRatio: 0, reviewedEvidenceCount: 0 });
    assert.equal(result.finalApprovalAllowed, false);
    assert.match(result.blockers.join("\n"), /Evidence coverage is zero/);
    assert.match(result.blockers.join("\n"), /no reviewed evidence/i);
  });

  it("blocks unapproved regex fallback output", () => {
    const result = evaluateSevenPassGenerationGate({ ...strongInput, analysisSource: "REGEX_FALLBACK" });
    assert.equal(result.finalApprovalAllowed, false);
    assert.equal(result.recommendedValidationStatus, "DRAFT");
    assert.match(result.blockers.join("\n"), /regex fallback/i);
  });

  it("blocks deterministic fallback output from final approval", () => {
    const result = evaluateSevenPassGenerationGate({ ...strongInput, deterministicFallbackUsed: true });
    assert.equal(result.finalApprovalAllowed, false);
    assert.equal(result.recommendedValidationStatus, "DRAFT");
    assert.match(result.blockers.join("\n"), /Fallback-generated content must remain draft-only/i);
  });

  it("blocks placeholders and AI traces", () => {
    const result = evaluateSevenPassGenerationGate({ ...strongInput, placeholderCount: 2, aiTraceCount: 1 });
    assert.equal(result.finalApprovalAllowed, false);
    assert.match(result.blockers.join("\n"), /placeholder/i);
    assert.match(result.blockers.join("\n"), /AI\/meta trace/i);
  });

  it("blocks unsupported claims", () => {
    const result = evaluateSevenPassGenerationGate({ ...strongInput, unsupportedClaimCount: 3 });
    assert.equal(result.finalApprovalAllowed, false);
    assert.match(result.blockers.join("\n"), /unsupported claim/i);
  });

  it("requires reviewed evidence and penalizes draft-only evidence", () => {
    const result = evaluateSevenPassGenerationGate({
      ...strongInput,
      reviewedEvidenceCount: 0,
      selectedEvidenceTrustLevels: ["AI_DRAFT", "REGEX_DRAFT"],
    });
    assert.equal(result.finalApprovalAllowed, false);
    assert.match(result.blockers.join("\n"), /no REVIEWED records/i);
    assert.match(result.blockers.join("\n"), /Draft evidence/i);
  });

  it("blocks technical and financial envelope mixing", () => {
    const result = evaluateSevenPassGenerationGate({ ...strongInput, technicalFinancialSeparationOk: false });
    assert.equal(result.finalApprovalAllowed, false);
    assert.match(result.blockers.join("\n"), /Technical\/financial envelope separation failed/);
  });

  it("blocks official-original risks", () => {
    const result = evaluateSevenPassGenerationGate({ ...strongInput, officialOriginalRiskCount: 1 });
    assert.equal(result.finalApprovalAllowed, false);
    assert.match(result.blockers.join("\n"), /official-original risk/i);
  });

  it("exposes a compact boolean helper", () => {
    assert.equal(sevenPassBlocksFinalApproval(strongInput), false);
    assert.equal(sevenPassBlocksFinalApproval({ ...strongInput, placeholderCount: 1 }), true);
  });
});
