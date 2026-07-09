// Hard-cap rules in lib/engine/readiness-scoring.ts — these are the gates
// that exist precisely so the dashboard cannot show 100% readiness when:
//   - evidence coverage is 0
//   - 13 required documents are missing
//   - the analysis came from the regex fallback
//   - critical metadata is missing
//   - generated docs failed the quality gate
//   - the final export gate is blocked

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeReadinessScore } from "../lib/engine/readiness-scoring";

function fullyHealthyInput() {
  return {
    analysisSeverity: "GOOD" as const,
    analysisScore: 95,
    analysisSource: "AI" as const,
    metadataCompletenessRatio: 1,
    metadataInvalidCount: 0,
    sourceReferenceCoverage: 1,
    evidenceCoverage: 1,
    reviewedSelectionsPresent: true,
    matchingScore: 95,
    complianceMatrixCoverage: 1,
    requiredDocumentsTotal: 5,
    requiredDocumentsSatisfied: 5,
    outsidePlanDocuments: 0,
    qualityFailedDocuments: 0,
    readyForExportCount: 5,
    finalExportCandidatesCount: 5,
    finalExportGateOk: true,
  };
}

describe("readiness scoring — fully healthy tender", () => {
  it("can reach 100", () => {
    const r = computeReadinessScore(fullyHealthyInput());
    assert.ok(r.score >= 90, `expected ≥90, got ${r.score}`);
    assert.equal(r.severity, "READY");
    assert.equal(r.applicableCaps.length, 0);
  });
});

describe("readiness scoring — HARD CAP: evidence coverage = 0", () => {
  it("caps at 35 even with otherwise-perfect dimensions", () => {
    const r = computeReadinessScore({ ...fullyHealthyInput(), evidenceCoverage: 0 });
    assert.ok(r.score <= 35, `expected ≤35, got ${r.score}`);
    assert.equal(r.appliedCap?.dimension, "evidenceCoverage");
    assert.match(r.appliedCap?.reason ?? "", /Evidence coverage is 0%/i);
  });
});

describe("readiness scoring — HARD CAP: required documents incomplete", () => {
  it("caps at 50 when documents are missing", () => {
    const r = computeReadinessScore({
      ...fullyHealthyInput(),
      requiredDocumentsTotal: 19,
      requiredDocumentsSatisfied: 6, // mirrors the screenshot regression: 6 of 19 docs present
    });
    assert.ok(r.score <= 50, `expected ≤50, got ${r.score}`);
    assert.ok(["requiredDocumentCompleteness", "evidenceCoverage"].includes(r.appliedCap?.dimension ?? ""));
  });
});

describe("readiness scoring — HARD CAP: regex fallback analysis", () => {
  it("caps at 45 when analysis source is unapproved regex fallback", () => {
    const r = computeReadinessScore({ ...fullyHealthyInput(), analysisSource: "REGEX_FALLBACK_AI_ERROR" });
    assert.ok(r.score <= 45, `expected ≤45, got ${r.score}`);
    assert.equal(r.appliedCap?.dimension, "analysisSource");
  });
  it("PERMANENT BLOCK: caps HUMAN_APPROVED_REGEX_FALLBACK at 45 even when fully verified (audit-only)", () => {
    // Human approval is AUDIT-ONLY — it must NEVER authorize release. The
    // readiness score MUST reflect this by capping at 45 (same as unapproved
    // regex fallback) regardless of verification status. The previous test
    // asserted "no cap when fully verified" — that was the false-green we
    // removed.
    const r = computeReadinessScore({ ...fullyHealthyInput(), analysisSource: "HUMAN_APPROVED_REGEX_FALLBACK" });
    const cap = r.applicableCaps.find((c) => c.dimension === "analysisSource");
    assert.ok(cap, "expected an analysisSource cap for HUMAN_APPROVED_REGEX_FALLBACK");
    assert.equal(cap?.capScore, 45, "HUMAN_APPROVED_REGEX_FALLBACK MUST be capped at 45 (audit-only, same as unapproved)");
    assert.match(cap?.reason ?? "", /audit-only/i, "Cap reason MUST mention audit-only");
  });
  it("caps human-approved fallback at 45 when not fully verified", () => {
    const r = computeReadinessScore({
      ...fullyHealthyInput(),
      analysisSource: "HUMAN_APPROVED_REGEX_FALLBACK",
      sourceReferenceCoverage: 0.5, // source refs incomplete → not fully verified
    });
    assert.ok(r.score <= 45, `expected ≤45, got ${r.score}`);
    const cap = r.applicableCaps.find((c) => c.dimension === "analysisSource");
    assert.ok(cap, "expected an analysisSource cap");
    assert.equal(cap?.capScore, 45);
  });
  it("caps human-approved fallback at 45 when required documents are incomplete", () => {
    const r = computeReadinessScore({
      ...fullyHealthyInput(),
      analysisSource: "HUMAN_APPROVED_REGEX_FALLBACK",
      requiredDocumentsTotal: 5,
      requiredDocumentsSatisfied: 5,
      complianceMatrixCoverage: 0.4, // mandatory-requirement coverage incomplete
    });
    const cap = r.applicableCaps.find((c) => c.dimension === "analysisSource");
    assert.ok(cap, "expected an analysisSource cap");
    assert.equal(cap?.capScore, 45);
  });
});

describe("readiness scoring — HARD CAP: tender facts unsafe (caps restored for final-output safety)", () => {
  // PR #1004 weakened final-output safety by making metadata fully advisory.
  // This restoration re-enables the tender-facts caps in readiness-scoring.ts
  // so the dashboard cannot show 100% readiness when required tender facts
  // (client/procuring entity, deadline, submission instructions) are unsafe.
  // The dimension is named "tenderFacts" (renamed from "metadataCompleteness").
  // Draft generation is NOT blocked by these — they only affect the readiness
  // score, which gates final export.
  it("caps at 60 when tender metadata completeness < 60%", () => {
    const r = computeReadinessScore({ ...fullyHealthyInput(), metadataCompletenessRatio: 0.3125 /* 5/16 */ });
    assert.ok(r.score <= 60, `expected ≤60 (tenderFacts cap), got ${r.score}`);
    const cap = r.applicableCaps.find((c) => c.dimension === "tenderFacts");
    assert.ok(cap, "expected a tenderFacts cap for metadataCompletenessRatio < 0.6");
    assert.equal(cap?.capScore, 60);
  });
  it("caps at 60 when tender metadata has invalid placeholder fields", () => {
    const r = computeReadinessScore({ ...fullyHealthyInput(), metadataInvalidCount: 3 });
    assert.ok(r.score <= 60, `expected ≤60 (tenderFacts cap), got ${r.score}`);
    const cap = r.applicableCaps.find((c) => c.dimension === "tenderFacts");
    assert.ok(cap, "expected a tenderFacts cap for metadataInvalidCount > 0");
    assert.equal(cap?.capScore, 60);
  });
  it("caps at 50 when metadataContaminated is true", () => {
    const r = computeReadinessScore({ ...fullyHealthyInput(), metadataContaminated: true });
    assert.ok(r.score <= 50, `expected ≤50 (tenderFacts contaminated cap), got ${r.score}`);
    const cap = r.applicableCaps.find((c) => c.dimension === "tenderFacts");
    assert.ok(cap, "expected a tenderFacts cap for metadataContaminated=true");
    assert.equal(cap?.capScore, 50);
  });
});

describe("readiness scoring — HARD CAP: generated document quality failed", () => {
  it("caps at 60 when any document fails the quality gate", () => {
    const r = computeReadinessScore({ ...fullyHealthyInput(), qualityFailedDocuments: 2 });
    assert.ok(r.score <= 60, `expected ≤60, got ${r.score}`);
    assert.equal(r.appliedCap?.dimension, "generatedDocumentQuality");
  });
});

describe("readiness scoring — final export gate must never produce exactly 100 when blocked", () => {
  it("clamps to 99 (or lower) when finalExportGateOk = false", () => {
    const r = computeReadinessScore({ ...fullyHealthyInput(), finalExportGateOk: false });
    assert.ok(r.score < 100, `expected <100, got ${r.score}`);
  });
});

describe("readiness scoring — most restrictive cap wins", () => {
  it("evidence=0 + missing docs + regex fallback together cap to ≤35", () => {
    const r = computeReadinessScore({
      ...fullyHealthyInput(),
      evidenceCoverage: 0,
      requiredDocumentsTotal: 19,
      requiredDocumentsSatisfied: 6,
      analysisSource: "REGEX_FALLBACK_AI_ERROR",
    });
    assert.ok(r.score <= 35, `expected ≤35, got ${r.score}`);
    assert.ok(r.applicableCaps.length >= 3);
  });
});

describe("readiness scoring — severity classification", () => {
  it("BLOCKED when score < 50", () => {
    const r = computeReadinessScore({ ...fullyHealthyInput(), evidenceCoverage: 0 });
    assert.equal(r.severity, "BLOCKED");
  });
  it("PARTIAL when 50 ≤ score < 80", () => {
    const r = computeReadinessScore({
      ...fullyHealthyInput(),
      qualityFailedDocuments: 1,
      requiredDocumentsTotal: 5,
      requiredDocumentsSatisfied: 5,
    });
    assert.equal(r.severity, "PARTIAL");
  });
});
