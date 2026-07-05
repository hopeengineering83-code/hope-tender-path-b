import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeTenderReadinessState, deriveAnalysisHash } from "../lib/tender-readiness-state";
import { computeReadinessScore } from "../lib/engine/readiness-scoring";

const req = (priority = "MANDATORY", traced = true) => ({
  priority,
  sourcePageNumber: traced ? 3 : null,
  sourceExactQuote: traced ? "The bidder shall..." : null,
  sectionReference: traced ? "Section 4" : null,
  sourceConfidence: traced ? 0.9 : null,
  exactFileName: "Technical Proposal.docx",
});

const base = {
  analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
  analysisSource: "AI",
  analysisSeverity: "GOOD" as const,
  title: "Hospital Equipment Tender",
  clientName: "Ministry of Health",
  reference: "MOH-001",
  metadataContaminated: false,
  requirements: [req("MANDATORY"), req("CRITICAL"), req("OPTIONAL")],
  exactFileNaming: '["Technical Proposal.docx"]',
  exactFileOrder: '["Technical Proposal.docx"]',
};

describe("computeTenderReadinessState", () => {
  it("blocks compliance when requirements are missing", () => {
    const state = computeTenderReadinessState({ ...base, requirements: [] });
    assert.equal(state.requirementsTrusted, false);
    assert.equal(state.complianceCurrent, false);
    assert.equal(state.exportAllowed, false);
  });

  it("treats CRITICAL as mandatory-type requirement", () => {
    const state = computeTenderReadinessState({ ...base, requirements: [req("CRITICAL", false)] });
    assert.equal(state.mandatoryRequirementsCount, 1);
    assert.equal(state.mandatoryTracedCount, 0);
    assert.equal(state.requirementsTrusted, false);
  });

  it("treats regex fallback as draft-only, including human-approved fallback", () => {
    const state = computeTenderReadinessState({ ...base, analysisSource: "HUMAN_APPROVED_REGEX_FALLBACK" });
    assert.equal(state.analysisTrusted, false);
    assert.equal(state.requirementsTrusted, false);
    assert.equal(state.exportAllowed, false);
  });

  it("fails metadata when title, client, or reference is missing", () => {
    assert.equal(computeTenderReadinessState({ ...base, title: "" }).metadataTrusted, false);
    assert.equal(computeTenderReadinessState({ ...base, clientName: "", procuringEntityName: "" }).metadataTrusted, false);
    assert.equal(computeTenderReadinessState({ ...base, reference: "" }).metadataTrusted, false);
  });

  it("documents are not current without a generated document hash", () => {
    const state = computeTenderReadinessState({ ...base, generatedDocuments: [{ generationStatus: "GENERATED", contentSummary: null }] });
    assert.equal(state.docsGeneratedFromCurrentAnalysis, false);
    assert.equal(state.documentsCurrent, false);
  });

  it("documents are current only when hash matches current analysis", () => {
    const current = computeTenderReadinessState(base).currentAnalysisHash;
    const state = computeTenderReadinessState({ ...base, generatedDocuments: [{ generationStatus: "GENERATED", contentSummary: JSON.stringify({ analysisHash: current }) }] });
    assert.equal(state.docsGeneratedFromCurrentAnalysis, true);
    assert.equal(state.documentsCurrent, true);
  });

  it("analysis hash changes when requirements change", () => {
    const a = computeTenderReadinessState(base).currentAnalysisHash;
    const b = computeTenderReadinessState({ ...base, requirements: [...base.requirements, req("MANDATORY")] }).currentAnalysisHash;
    assert.notEqual(a, b);
    assert.match(deriveAnalysisHash({ extractionStatus: "A", analysisSource: "B", requirementCount: 1, mandatoryCount: 1, sourceTracedCount: 1 }), /^v1:/);
  });
});

describe("computeReadinessScore hard caps", () => {
  const scoreBase = {
    analysisScore: 95,
    analysisSeverity: "GOOD" as const,
    analysisSource: "AI" as const,
    metadataCompletenessRatio: 1,
    metadataInvalidCount: 0,
    sourceReferenceCoverage: 1,
    evidenceCoverage: 1,
    reviewedSelectionsPresent: true,
    matchingScore: 95,
    complianceMatrixCoverage: 1,
    requiredDocumentsTotal: 2,
    requiredDocumentsSatisfied: 2,
    outsidePlanDocuments: 0,
    qualityFailedDocuments: 0,
    readyForExportCount: 2,
    finalExportCandidatesCount: 2,
    mandatoryRequirementsCount: 2,
    mandatoryTracedCount: 2,
    finalExportGateOk: true,
  };

  it("caps OCR_REQUIRED at 40", () => {
    const result = computeReadinessScore({ ...scoreBase, analysisExtractionStatus: "OCR_REQUIRED" });
    assert.ok(result.score <= 40);
  });

  it("caps partial extraction at 50", () => {
    const result = computeReadinessScore({ ...scoreBase, analysisExtractionStatus: "PARTIAL_EXTRACTION_AI_ANALYZED" });
    assert.ok(result.score <= 50);
  });

  it("caps mandatory/critical requirements with zero trace at 60", () => {
    const result = computeReadinessScore({ ...scoreBase, mandatoryRequirementsCount: 2, mandatoryTracedCount: 0 });
    assert.ok(result.score <= 60);
  });
});
