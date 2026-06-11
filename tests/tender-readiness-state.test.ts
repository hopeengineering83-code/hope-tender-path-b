// Tests proving that the 6 dashboard contradictions cannot occur:
//
//   1. compliance ≠ 10/10 when requirements = 0/15 (requirementsTrusted=false)
//   2. documents ≠ green when submission plan not built
//   3. regex fallback caps overall readiness (health score)
//   4. missing tender title makes metadata fail everywhere (metadataTrusted=false)
//   5. stale generated documents do not count as current
//   6. updating AI analysis makes old docs and compliance stale
//
// Plus: OCR_REQUIRED and PARTIAL_EXTRACTION hard caps in readiness scoring.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeTenderReadinessState,
  deriveAnalysisHash,
  parseDocAnalysisHash,
  type TenderReadinessInput,
} from "../lib/tender-readiness-state";
import { computeReadinessScore } from "../lib/engine/readiness-scoring";

// ─── helpers ─────────────────────────────────────────────────────────────────

function tracedReq(priority = "MANDATORY") {
  return {
    priority,
    sourcePageNumber: 3,
    sourceExactQuote: "The bidder shall provide…",
    sectionReference: "Section 4.2",
    sourceConfidence: 0.9,
    exactFileName: "Technical Proposal.docx",
  };
}

function untracedReq(priority = "MANDATORY") {
  return {
    priority,
    sourcePageNumber: null,
    sourceExactQuote: null,
    sectionReference: null,
    sourceConfidence: null,
    exactFileName: null,
  };
}

function healthyInput(): TenderReadinessInput {
  return {
    analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
    analysisSource: "AI",
    analysisSeverity: "GOOD",
    title: "Supply and Installation of Medical Equipment",
    clientName: "Ministry of Health",
    procuringEntityName: "Ministry of Health",
    reference: "MOH/2025/001",
    metadataContaminated: false,
    requirements: [tracedReq("MANDATORY"), tracedReq("MANDATORY"), tracedReq("OPTIONAL")],
    exactFileNaming: '["Technical Proposal.docx","Financial Proposal.docx"]',
    exactFileOrder: '["Technical Proposal.docx","Financial Proposal.docx"]',
    generatedDocuments: [],
  };
}

function healthyScoreInput() {
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
    mandatoryRequirementsCount: 5,
    mandatoryTracedCount: 5,
  };
}

// ─── Contradiction 1: compliance ≠ 10/10 when requirements = 0 ───────────────

describe("Contradiction 1 — complianceCurrent=false when requirements=0", () => {
  it("complianceCurrent is false when no requirements extracted", () => {
    const s = computeTenderReadinessState({ ...healthyInput(), requirements: [] });
    assert.equal(s.complianceCurrent, false, "complianceCurrent must be false with 0 requirements");
    assert.equal(s.rawRequirementsCount, 0);
    assert.ok(s.blockers.length > 0, "should have at least one blocker");
  });

  it("requirementsTrusted is false when requirements=0", () => {
    const s = computeTenderReadinessState({ ...healthyInput(), requirements: [] });
    assert.equal(s.requirementsTrusted, false);
  });

  it("complianceCurrent is true when requirements are present and trusted", () => {
    const s = computeTenderReadinessState(healthyInput());
    assert.equal(s.complianceCurrent, true);
  });

  it("complianceCurrent is false when 15 requirements exist but analysis is regex fallback", () => {
    const reqs = Array.from({ length: 15 }, () => tracedReq("MANDATORY"));
    const s = computeTenderReadinessState({
      ...healthyInput(),
      requirements: reqs,
      analysisSource: "REGEX_FALLBACK_AI_ERROR",
    });
    assert.equal(s.complianceCurrent, false, "regex fallback means compliance cannot be trusted");
    assert.equal(s.requirementsTrusted, false);
    assert.ok(s.trustedRequirementsCount === 0);
  });
});

// ─── Contradiction 2: documents ≠ green when plan not built ──────────────────

describe("Contradiction 2 — documentsCurrent=false when submission plan not built", () => {
  it("documentsCurrent is false when exactFileNaming and exactFileOrder are empty and no req has exactFileName", () => {
    const s = computeTenderReadinessState({
      ...healthyInput(),
      exactFileNaming: "[]",
      exactFileOrder: "[]",
      requirements: [
        { priority: "MANDATORY", sourcePageNumber: 1, sourceExactQuote: "X", sectionReference: "S1", sourceConfidence: 0.9, exactFileName: null },
      ],
    });
    assert.equal(s.submissionPlanBuilt, false, "plan must not be considered built");
    assert.equal(s.documentsCurrent, false, "documentsCurrent must be false without a plan");
  });

  it("submissionPlanBuilt is true when exactFileNaming has entries", () => {
    const s = computeTenderReadinessState(healthyInput());
    assert.equal(s.submissionPlanBuilt, true);
  });

  it("documentsCurrent requires submissionPlanBuilt to be true", () => {
    const s = computeTenderReadinessState({
      ...healthyInput(),
      exactFileNaming: null,
      exactFileOrder: null,
      requirements: [
        { priority: "MANDATORY", sourcePageNumber: 2, sourceExactQuote: "Y", sectionReference: "S2", sourceConfidence: 0.8, exactFileName: null },
      ],
    });
    assert.equal(s.submissionPlanBuilt, false);
    assert.equal(s.documentsCurrent, false);
  });
});

// ─── Contradiction 3: regex fallback caps health score ───────────────────────

describe("Contradiction 3 — regex fallback caps readiness score", () => {
  it("caps at 45 for REGEX_FALLBACK_AI_ERROR regardless of other dimensions", () => {
    const r = computeReadinessScore({ ...healthyScoreInput(), analysisSource: "REGEX_FALLBACK_AI_ERROR" });
    assert.ok(r.score <= 45, `expected ≤45, got ${r.score}`);
    assert.ok(r.applicableCaps.some((c) => c.dimension === "analysisSource"), "cap dimension must be analysisSource");
  });

  it("analysisTrusted=false for REGEX_FALLBACK_AI_ERROR in readiness state", () => {
    const s = computeTenderReadinessState({
      ...healthyInput(),
      analysisSource: "REGEX_FALLBACK_AI_ERROR",
    });
    assert.equal(s.analysisTrusted, false);
    assert.equal(s.requirementsTrusted, false);
    assert.equal(s.complianceCurrent, false);
    assert.equal(s.exportAllowed, false);
  });

  it("REGEX_FALLBACK_FROM_WEAK_EXTRACTION caps at 40", () => {
    const r = computeReadinessScore({
      ...healthyScoreInput(),
      analysisExtractionStatus: "REGEX_FALLBACK_FROM_WEAK_EXTRACTION",
    });
    assert.ok(r.score <= 40, `expected ≤40, got ${r.score}`);
  });

  it("extractionTrusted=false for REGEX_FALLBACK_FROM_WEAK_EXTRACTION", () => {
    const s = computeTenderReadinessState({
      ...healthyInput(),
      analysisExtractionStatus: "REGEX_FALLBACK_FROM_WEAK_EXTRACTION",
    });
    assert.equal(s.extractionTrusted, false);
    assert.equal(s.analysisTrusted, false);
    assert.ok(s.blockers.some((b) => /regex.*fallback|weak extraction/i.test(b)));
  });
});

// ─── Contradiction 4: missing title fails metadata everywhere ────────────────

describe("Contradiction 4 — missing title makes metadataTrusted=false", () => {
  it("metadataTrusted=false when title is empty", () => {
    const s = computeTenderReadinessState({ ...healthyInput(), title: "" });
    assert.equal(s.metadataTrusted, false);
    assert.ok(s.blockers.some((b) => /title/i.test(b)), "blocker should mention title");
  });

  it("metadataTrusted=false when title is only whitespace", () => {
    const s = computeTenderReadinessState({ ...healthyInput(), title: "   " });
    assert.equal(s.metadataTrusted, false);
  });

  it("metadataTrusted=false when title is suspiciously short (< 3 chars)", () => {
    const s = computeTenderReadinessState({ ...healthyInput(), title: "T" });
    assert.equal(s.metadataTrusted, false);
  });

  it("complianceCurrent=false when metadataTrusted=false", () => {
    const s = computeTenderReadinessState({ ...healthyInput(), title: "" });
    assert.equal(s.complianceCurrent, false);
  });

  it("exportAllowed=false when metadataTrusted=false", () => {
    const s = computeTenderReadinessState({ ...healthyInput(), title: "" });
    assert.equal(s.exportAllowed, false);
  });

  it("metadataTrusted=false when client name is missing", () => {
    const s = computeTenderReadinessState({
      ...healthyInput(),
      clientName: "",
      procuringEntityName: "",
    });
    assert.equal(s.metadataTrusted, false);
    assert.ok(s.blockers.some((b) => /client|procuring/i.test(b)));
  });

  it("metadataTrusted=false when metadataContaminated=true", () => {
    const s = computeTenderReadinessState({ ...healthyInput(), metadataContaminated: true });
    assert.equal(s.metadataTrusted, false);
    assert.ok(s.blockers.some((b) => /contaminated/i.test(b)));
  });
});

// ─── Contradiction 5: stale docs don't count as current ──────────────────────

describe("Contradiction 5 — stale docs are not documentsCurrent", () => {
  it("docs with different analysisHash are not current", () => {
    const current = computeTenderReadinessState(healthyInput());
    const staleHash = "v1:deadbeef";

    const s = computeTenderReadinessState({
      ...healthyInput(),
      generatedDocuments: [
        {
          generationStatus: "GENERATED",
          contentSummary: JSON.stringify({ analysisHash: staleHash }),
        },
      ],
    });

    assert.equal(s.docsGeneratedFromCurrentAnalysis, false, "hash mismatch must mark docs as stale");
    assert.equal(s.documentsCurrent, false);
    assert.ok(current.currentAnalysisHash !== staleHash, "health-check: current hash differs from stale");
  });

  it("docs with matching analysisHash are current", () => {
    const base = computeTenderReadinessState(healthyInput());
    const correctHash = base.currentAnalysisHash;

    const s = computeTenderReadinessState({
      ...healthyInput(),
      generatedDocuments: [
        {
          generationStatus: "GENERATED",
          contentSummary: JSON.stringify({ analysisHash: correctHash }),
        },
      ],
    });

    assert.equal(s.docsGeneratedFromCurrentAnalysis, true);
    assert.equal(s.documentsCurrent, true);
  });

  it("docs with no contentSummary hash do not fail the staleness check", () => {
    const s = computeTenderReadinessState({
      ...healthyInput(),
      generatedDocuments: [{ generationStatus: "GENERATED", contentSummary: null }],
    });
    assert.equal(s.docsGeneratedFromCurrentAnalysis, true, "absent hash should not falsely flag stale");
  });

  it("SUPERSEDED docs are excluded from staleness check", () => {
    const s = computeTenderReadinessState({
      ...healthyInput(),
      generatedDocuments: [
        {
          generationStatus: "SUPERSEDED",
          contentSummary: JSON.stringify({ analysisHash: "v1:deadbeef" }),
        },
      ],
    });
    assert.equal(s.docsGeneratedFromCurrentAnalysis, true, "superseded docs should not affect staleness");
  });
});

// ─── Contradiction 6: re-running analysis makes old docs/compliance stale ────

describe("Contradiction 6 — updated analysis invalidates docs and compliance", () => {
  it("adding a new requirement changes the analysis hash", () => {
    const before = computeTenderReadinessState(healthyInput());
    const after = computeTenderReadinessState({
      ...healthyInput(),
      requirements: [...healthyInput().requirements!, tracedReq("MANDATORY")],
    });
    assert.notEqual(before.currentAnalysisHash, after.currentAnalysisHash, "hash must change when requirements change");
  });

  it("docs generated from old hash are stale after requirements change", () => {
    const before = computeTenderReadinessState(healthyInput());
    const oldHash = before.currentAnalysisHash;

    const afterState = computeTenderReadinessState({
      ...healthyInput(),
      requirements: [...healthyInput().requirements!, tracedReq("MANDATORY")],
      generatedDocuments: [
        {
          generationStatus: "GENERATED",
          contentSummary: JSON.stringify({ analysisHash: oldHash }),
        },
      ],
    });

    assert.equal(afterState.docsGeneratedFromCurrentAnalysis, false, "old hash must be detected as stale");
    assert.equal(afterState.documentsCurrent, false);
  });

  it("changing extraction status changes the analysis hash", () => {
    const full = computeTenderReadinessState(healthyInput());
    const partial = computeTenderReadinessState({
      ...healthyInput(),
      analysisExtractionStatus: "PARTIAL_EXTRACTION_AI_ANALYZED",
    });
    assert.notEqual(full.currentAnalysisHash, partial.currentAnalysisHash);
  });

  it("compliance becomes not-current when extraction becomes weak after docs generated", () => {
    const s = computeTenderReadinessState({
      ...healthyInput(),
      analysisExtractionStatus: "OCR_REQUIRED",
    });
    assert.equal(s.complianceCurrent, false, "compliance must be blocked when OCR is required");
    assert.equal(s.extractionTrusted, false);
  });
});

// ─── New readiness-scoring hard caps ─────────────────────────────────────────

describe("readiness-scoring — new hard caps", () => {
  it("OCR_REQUIRED caps readiness at 40", () => {
    const r = computeReadinessScore({
      ...healthyScoreInput(),
      analysisExtractionStatus: "OCR_REQUIRED",
    });
    assert.ok(r.score <= 40, `expected ≤40 for OCR_REQUIRED, got ${r.score}`);
    assert.ok(
      r.applicableCaps.some((c) => c.capScore <= 40 && /OCR/i.test(c.reason)),
      "cap reason must mention OCR",
    );
  });

  it("PARTIAL_EXTRACTION_AI_ANALYZED caps readiness at 50", () => {
    const r = computeReadinessScore({
      ...healthyScoreInput(),
      analysisExtractionStatus: "PARTIAL_EXTRACTION_AI_ANALYZED",
    });
    assert.ok(r.score <= 50, `expected ≤50 for PARTIAL_EXTRACTION, got ${r.score}`);
    assert.ok(
      r.applicableCaps.some((c) => c.capScore <= 50 && /partial/i.test(c.reason)),
      "cap reason must mention partial",
    );
  });

  it("mandatory requirements with 0 source traces caps readiness at 60", () => {
    const r = computeReadinessScore({
      ...healthyScoreInput(),
      mandatoryRequirementsCount: 15,
      mandatoryTracedCount: 0,
    });
    assert.ok(r.score <= 60, `expected ≤60 for untraceable mandatory reqs, got ${r.score}`);
    assert.ok(
      r.applicableCaps.some((c) => c.capScore <= 60 && c.dimension === "sourceReferenceCoverage"),
      "cap dimension must be sourceReferenceCoverage",
    );
  });

  it("fully-verified tender with traced mandatory reqs is NOT capped at 60", () => {
    const r = computeReadinessScore({
      ...healthyScoreInput(),
      mandatoryRequirementsCount: 5,
      mandatoryTracedCount: 5,
    });
    assert.ok(r.score > 60, `expected >60 for fully traced reqs, got ${r.score}`);
    assert.equal(
      r.applicableCaps.find((c) => c.dimension === "sourceReferenceCoverage"),
      undefined,
      "sourceReferenceCoverage cap must not fire when reqs are traced",
    );
  });

  it("EXTRACTION_CORRUPTED_AI_SKIPPED caps readiness at 30 (existing, not regressed)", () => {
    const r = computeReadinessScore({
      ...healthyScoreInput(),
      analysisExtractionStatus: "EXTRACTION_CORRUPTED_AI_SKIPPED",
    });
    assert.ok(r.score <= 30, `expected ≤30 for corrupted extraction, got ${r.score}`);
  });
});

// ─── deriveAnalysisHash and parseDocAnalysisHash helpers ─────────────────────

describe("deriveAnalysisHash", () => {
  it("same inputs produce the same hash", () => {
    const a = deriveAnalysisHash({ extractionStatus: "FULL", analysisSource: "AI", requirementCount: 10, mandatoryCount: 5, sourceTracedCount: 5 });
    const b = deriveAnalysisHash({ extractionStatus: "FULL", analysisSource: "AI", requirementCount: 10, mandatoryCount: 5, sourceTracedCount: 5 });
    assert.equal(a, b);
  });

  it("different requirementCount produces different hash", () => {
    const a = deriveAnalysisHash({ extractionStatus: "FULL", analysisSource: "AI", requirementCount: 10, mandatoryCount: 5, sourceTracedCount: 5 });
    const b = deriveAnalysisHash({ extractionStatus: "FULL", analysisSource: "AI", requirementCount: 11, mandatoryCount: 5, sourceTracedCount: 5 });
    assert.notEqual(a, b);
  });

  it("different extractionStatus produces different hash", () => {
    const a = deriveAnalysisHash({ extractionStatus: "FULL", analysisSource: "AI", requirementCount: 10, mandatoryCount: 5, sourceTracedCount: 5 });
    const b = deriveAnalysisHash({ extractionStatus: "PARTIAL", analysisSource: "AI", requirementCount: 10, mandatoryCount: 5, sourceTracedCount: 5 });
    assert.notEqual(a, b);
  });

  it("hash starts with v1:", () => {
    const h = deriveAnalysisHash({ extractionStatus: "X", analysisSource: "Y", requirementCount: 0, mandatoryCount: 0, sourceTracedCount: 0 });
    assert.ok(h.startsWith("v1:"), `expected v1: prefix, got ${h}`);
  });
});

describe("parseDocAnalysisHash", () => {
  it("returns analysisHash from valid JSON", () => {
    const h = parseDocAnalysisHash(JSON.stringify({ analysisHash: "v1:abc123" }));
    assert.equal(h, "v1:abc123");
  });

  it("returns null for null contentSummary", () => {
    assert.equal(parseDocAnalysisHash(null), null);
  });

  it("returns null for unparseable string", () => {
    assert.equal(parseDocAnalysisHash("not json"), null);
  });

  it("returns null when analysisHash key is missing", () => {
    assert.equal(parseDocAnalysisHash(JSON.stringify({ other: "value" })), null);
  });

  it("returns null when analysisHash is empty string", () => {
    assert.equal(parseDocAnalysisHash(JSON.stringify({ analysisHash: "" })), null);
  });
});
