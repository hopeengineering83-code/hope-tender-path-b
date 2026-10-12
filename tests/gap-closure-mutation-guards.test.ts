// Mutation guards for the gap-closure commit. Each test verifies a specific
// protection that was added to close the remaining gaps. If anyone reverts
// any of these protections, the corresponding test fails.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateSevenPassGenerationGate } from "../lib/engine/seven-pass-generation";
import { computeReadinessScore } from "../lib/engine/readiness-scoring";

// ─── Gap 2: analysis-job-service mapToDraft rejects foreign/guessed tokens ──

describe("Gap 2 — analysis-job-service source-file attribution", () => {
  const src = readFileSync("lib/ai-jobs/analysis-job-service.ts", "utf8");

  it("mapToDraft accepts a validTenderFileIds parameter", () => {
    // The function signature MUST accept a validTenderFileIds set so the
    // caller can validate sourceFileToken against the active TenderFile IDs.
    // Assert the PARAMETER is accepted, not the exact full signature text:
    // pinning the whole parameter list failed the moment a further argument was
    // added (fileTextById, used to derive grounding confidence), even though
    // validTenderFileIds was still accepted and still used the same way.
    assert.match(src, /function mapToDraft\([\s\S]{0,200}?validTenderFileIds\?: Set<string>/);
  });

  it("mapToDraft validates sourceFileToken against validTenderFileIds (no guessing)", () => {
    // The previous bug: sourceTenderFileId was set to sourceFileToken if it
    // was longer than 20 chars — without validating it was an active file.
    // The new code MUST check validSet.has(rawToken) before accepting it.
    assert.match(src, /validSet\.has\(rawToken\)/);
    // The length-based fallback MUST be gone.
    assert.ok(
      !/sourceFileToken\.length\s*>\s*20/.test(src),
      "mapToDraft MUST NOT use sourceFileToken.length > 20 as a validity check (that was the bug)",
    );
  });

  it("strict-grounding check validates against activeFileIdSet", () => {
    // The strict-grounding filter MUST load active files and validate
    // sourceTenderFileId/sourceFileToken against the active set.
    assert.match(src, /activeFileIdSet\s*=\s*new Set/);
    assert.match(src, /activeFileIdSet\.has\(fileId\)/);
    assert.match(src, /activeFileIdSet\.has\(fileToken\)/);
  });
});

// ─── Gap 4: bid-strategy route blocks HUMAN_APPROVED_REGEX_FALLBACK ──────────

describe("Gap 4 — bid-strategy route blocks HUMAN_APPROVED_REGEX_FALLBACK", () => {
  const src = readFileSync("app/api/tenders/[id]/bid-strategy/route.ts", "utf8");

  it("isUnapprovedFallbackOrUnknown returns true for HUMAN_APPROVED_REGEX_FALLBACK", () => {
    // The previous bug: isUnapprovedFallbackOrUnknown returned false for
    // HUMAN_APPROVED_REGEX_FALLBACK, allowing bid strategy on human-approved
    // fallback. The new code MUST treat it as unapproved (audit-only).
    assert.ok(
      !/HUMAN_APPROVED_REGEX_FALLBACK.*return false/.test(src),
      "isUnapprovedFallbackOrUnknown MUST NOT return false for HUMAN_APPROVED_REGEX_FALLBACK",
    );
    // The function must still include the REGEX_FALLBACK and DETERMINISTIC_FALLBACK checks.
    assert.match(src, /REGEX_FALLBACK/);
    assert.match(src, /DETERMINISTIC_FALLBACK/);
  });
});

// ─── Gap 5: seven-pass-generation blocks HUMAN_APPROVED_REGEX from final approval ──

describe("Gap 5 — seven-pass-generation blocks HUMAN_APPROVED_REGEX", () => {
  const src = readFileSync("lib/engine/seven-pass-generation.ts", "utf8");

  it("source code blocks HUMAN_APPROVED_REGEX in TENDER_COMPREHENSION pass", () => {
    assert.match(src, /analysisSource === "HUMAN_APPROVED_REGEX" \? \["Tender was analyzed by regex fallback and human-approved as audit-only/);
  });

  it("source code blocks HUMAN_APPROVED_REGEX in FINAL_REWRITE_APPROVAL pass", () => {
    assert.match(src, /analysisSource === "HUMAN_APPROVED_REGEX" \? \["Human-approved regex fallback is audit-only and cannot authorize final rewrite approval/);
  });

  it("evaluateSevenPassGenerationGate blocks final approval for HUMAN_APPROVED_REGEX", () => {
    const result = evaluateSevenPassGenerationGate({
      analysisSource: "HUMAN_APPROVED_REGEX",
      evidenceCoverageRatio: 1.0,
      reviewedEvidenceCount: 5,
      requiredEvidenceCount: 5,
      unsupportedClaimCount: 0,
      placeholderCount: 0,
      aiTraceCount: 0,
      pricingLeakageCount: 0,
      officialOriginalRiskCount: 0,
      selfReviewScore: 95,
      selectedEvidenceTrustLevels: ["REVIEWED"],
      outlineMatchesTender: true,
      tenderScopeOnly: true,
      technicalFinancialSeparationOk: true,
    });
    assert.equal(result.finalApprovalAllowed, false, "HUMAN_APPROVED_REGEX MUST NOT allow final approval");
    assert.match(result.blockers.join("\n"), /audit-only/i);
    assert.equal(result.recommendedValidationStatus, "DRAFT");
  });

  it("evaluateSevenPassGenerationGate allows final approval for genuine AI", () => {
    const result = evaluateSevenPassGenerationGate({
      analysisSource: "AI",
      evidenceCoverageRatio: 1.0,
      reviewedEvidenceCount: 5,
      requiredEvidenceCount: 5,
      unsupportedClaimCount: 0,
      placeholderCount: 0,
      aiTraceCount: 0,
      pricingLeakageCount: 0,
      officialOriginalRiskCount: 0,
      selfReviewScore: 95,
      selectedEvidenceTrustLevels: ["REVIEWED"],
      outlineMatchesTender: true,
      tenderScopeOnly: true,
      technicalFinancialSeparationOk: true,
    });
    assert.equal(result.finalApprovalAllowed, true, "Genuine AI MUST allow final approval when all other passes are clean");
  });
});

// ─── Gap 7: tender-lifecycle-orchestrator blocks HUMAN_APPROVED from release ──

describe("Gap 7 — tender-lifecycle-orchestrator blocks HUMAN_APPROVED from release", () => {
  const src = readFileSync("lib/engine/tender-lifecycle-orchestrator.ts", "utf8");

  it("analysisOk is ONLY true for genuine AI (not HUMAN_APPROVED_REGEX_FALLBACK)", () => {
    // The previous bug: analysisOk = AI || HUMAN_APPROVED_REGEX_FALLBACK.
    // The new code MUST be: analysisOk = AI only.
    assert.match(src, /const analysisOk = analysisSource === "AI";/);
  });

  it("finalExportReady requires genuine AI (not HUMAN_APPROVED_REGEX_FALLBACK)", () => {
    // The previous bug: finalExportReady allowed AI || HUMAN_APPROVED_REGEX_FALLBACK.
    // The new code MUST require AI only.
    const finalExportReadySection = src.match(/const finalExportReady =[\s\S]*?officialAttached;?/);
    assert.ok(finalExportReadySection, "finalExportReady must exist");
    assert.match(finalExportReadySection[0], /analysisSource === "AI"/);
    assert.ok(
      !/analysisSource === "AI" \|\| analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK"/.test(finalExportReadySection[0]),
      "finalExportReady MUST NOT allow HUMAN_APPROVED_REGEX_FALLBACK",
    );
  });

  it("has ANALYSIS_FALLBACK_APPROVED_AUDIT_ONLY lifecycle state for HUMAN_APPROVED", () => {
    assert.match(src, /"ANALYSIS_FALLBACK_APPROVED_AUDIT_ONLY"/);
    assert.match(src, /analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK"[\s\S]*?ANALYSIS_FALLBACK_APPROVED_AUDIT_ONLY/);
  });

  it("HUMAN_APPROVED_REGEX_FALLBACK blocker code is ANALYSIS_FALLBACK_AUDIT_ONLY", () => {
    assert.match(src, /code: "ANALYSIS_FALLBACK_AUDIT_ONLY"/);
  });
});

// ─── Gap 8: final-submission-readiness blocks HUMAN_APPROVED_REGEX_FALLBACK ──

describe("Gap 8 — final-submission-readiness blocks HUMAN_APPROVED_REGEX_FALLBACK", () => {
  const src = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");

  it("adds a tenderLevelBlocker for HUMAN_APPROVED_REGEX_FALLBACK", () => {
    // The previous bug: only REGEX_FALLBACK_AI_ERROR was blocked.
    // The new code MUST also block HUMAN_APPROVED_REGEX_FALLBACK.
    const section = src.match(/if \(analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK"\) \{[\s\S]*?\}/);
    assert.ok(section, "final-submission-readiness MUST have a HUMAN_APPROVED_REGEX_FALLBACK branch");
    assert.match(section[0], /tenderLevelBlockers\.push/);
    assert.match(section[0], /audit-only/i);
    assert.match(section[0], /ANALYSIS_FALLBACK_AUDIT_ONLY/);
  });
});

// ─── Readiness scoring: HUMAN_APPROVED capped at 45 (audit-only) ─────────────

describe("Readiness scoring — HUMAN_APPROVED_REGEX_FALLBACK capped at 45 (audit-only)", () => {
  it("caps at 45 even when fully verified", () => {
    const r = computeReadinessScore({
      analysisSource: "HUMAN_APPROVED_REGEX_FALLBACK",
      sourceReferenceCoverage: 1.0,
      complianceMatrixCoverage: 1.0,
      evidenceCoverage: 1.0,
      reviewedSelectionsPresent: true,
      mandatoryRequirementsCount: 5,
      mandatoryTracedCount: 5,
      metadataCompletenessRatio: 1.0,
      metadataInvalidCount: 0,
      metadataContaminated: false,
      requiredDocumentsTotal: 5,
      requiredDocumentsSatisfied: 5,
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
    });
    const cap = r.applicableCaps.find((c) => c.dimension === "analysisSource");
    assert.ok(cap, "expected an analysisSource cap");
    assert.equal(cap?.capScore, 45, "MUST be capped at 45 (audit-only, same as unapproved)");
    assert.match(cap?.reason ?? "", /audit-only/i);
  });
});
