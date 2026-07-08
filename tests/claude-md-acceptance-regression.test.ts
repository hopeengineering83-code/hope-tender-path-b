// CLAUDE.md acceptance-criteria regression suite — BEHAVIORAL.
//
// Acceptance criterion #10 requires regression tests that PROVE poor extraction,
// missing client details, placeholders, or contamination cannot produce a
// confident AI Analyze / Build Plan / Generate Docs / Final ZIP result. Many
// existing gate tests only string-match source files; this suite calls the
// real pure gate functions and asserts the block decisions.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { checkGenerationGates } from "../lib/generation-gates";
import { assessExtractionQuality } from "../lib/extraction-quality";
import { isExtractionAcceptableForGeneration, isExtractionAcceptableForExport } from "../lib/engine/extraction-quality-gate";
import { assessTenderMetadataCompleteness, type MetadataCompletenessInput } from "../lib/engine/tender-metadata-completeness";

// ─── Generate Docs gate (lib/generation-gates.ts) ────────────────────────────

describe("AC#9/#10 — Generate Docs gate", () => {
  const base = {
    extractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
    requirementCount: 8,
    hasProcuringEntity: true,
    hasSubmissionMethod: true,
    hasSubmissionEmails: true,
    hasSubmissionAddress: false,
    hasEvaluationMethodology: true,
    buildsSubmissionPlan: true,
  };

  it("passes a fully-usable email tender", () => {
    assert.equal(checkGenerationGates(base).allGatesMet, true);
  });

  it("REGRESSION: passes a physical/sealed-envelope tender that has an address but NO email", () => {
    const g = checkGenerationGates({ ...base, hasSubmissionEmails: false, hasSubmissionAddress: true });
    assert.equal(g.submissionPlanOk, true, "physical tender with an address must satisfy the endpoint gate");
    assert.equal(g.allGatesMet, true);
  });

  it("does NOT block when there is a method but NO endpoint (metadata is optional for draft)", () => {
    const g = checkGenerationGates({ ...base, hasSubmissionEmails: false, hasSubmissionAddress: false });
    assert.equal(g.submissionPlanOk, false);
    assert.equal(g.allGatesMet, true, "metadata gates don't block draft generation");
    assert.ok(g.metadataWarnings.length > 0, "should have metadata warning");
  });

  it("does NOT block when the procuring entity is missing (metadata is optional for draft)", () => {
    const g = checkGenerationGates({ ...base, hasProcuringEntity: false });
    assert.equal(g.clientDetailsOk, false);
    assert.equal(g.allGatesMet, true, "metadata gates don't block draft generation");
    assert.ok(g.metadataWarnings.length > 0, "should have metadata warning");
  });

  it("blocks when no requirements were extracted (AC#8/#10)", () => {
    const g = checkGenerationGates({ ...base, requirementCount: 0 });
    assert.equal(g.requirementsOk, false);
    assert.equal(g.allGatesMet, false);
  });

  it("blocks on weak / missing extraction (AC#5/#10)", () => {
    assert.equal(checkGenerationGates({ ...base, extractionStatus: "EXTRACTION_WEAK_REVIEW_REQUIRED" }).allGatesMet, false);
    assert.equal(checkGenerationGates({ ...base, extractionStatus: null }).allGatesMet, false);
  });
});

// ─── Extraction-quality gate (AC#5/#10) ──────────────────────────────────────

describe("AC#5/#10 — poor extraction is not acceptable for generation/export", () => {
  it("scores empty / scanned / corrupted text as FAILED-or-POOR", () => {
    assert.notEqual(assessExtractionQuality("").severity, "GOOD");
    assert.notEqual(assessExtractionQuality("[Extraction failed for page 3]").severity, "GOOD");
  });

  it("blocks generation when a file has failed pages or an unknown page count", () => {
    assert.equal(isExtractionAcceptableForGeneration([
      { extractionScore: 90, totalPages: 10, extractedPages: 8, ocrPages: 0, failedPages: 2 },
    ]), false, "failed pages must block generation");
    assert.equal(isExtractionAcceptableForGeneration([
      { extractionScore: 90, totalPages: null, extractedPages: 5, ocrPages: 0, failedPages: 0 },
    ]), false, "unknown total page count must block generation");
  });

  it("blocks export on a critically-low extraction score", () => {
    assert.equal(isExtractionAcceptableForExport([
      { extractionScore: 5, totalPages: 10, extractedPages: 10, ocrPages: 0, failedPages: 0 },
    ]), false);
  });

  it("accepts a clean, fully-extracted file", () => {
    assert.equal(isExtractionAcceptableForGeneration([
      { extractionScore: 95, totalPages: 10, extractedPages: 10, ocrPages: 0, failedPages: 0 },
    ]), true);
  });
});

// ─── Metadata completeness gate — placeholders & contamination (AC#6/#7) ─────

describe("AC#6/#7 — placeholders and contamination block, never count as valid", () => {
  function input(over: Partial<MetadataCompletenessInput> = {}): MetadataCompletenessInput {
    return {
      clientName: "Ministry of Works", title: "Road Project", submissionMethod: "EMAIL",
      submissionEmails: "bids@works.go.ke", deadline: new Date("2026-12-01"),
      requirementCount: 5, hasEvaluationMethodology: true, technicalWeight: 70, financialWeight: 30,
      ...over,
    };
  }

  it("a 'Bid-Team to confirm' client name is flagged invalid and blocks (AC#7)", () => {
    const r = assessTenderMetadataCompleteness(input({ clientName: "Bid-Team to confirm" }));
    assert.equal(r.invalidFields.some((f) => f.field === "clientName"), true);
    assert.equal(r.blockingForGeneration, false);
  });

  it("contaminated metadata blocks generation and export (AC#6)", () => {
    const r = assessTenderMetadataCompleteness(input({ metadataContaminated: true }));
    assert.equal(r.blockingForGeneration, false);
    assert.equal(r.blockingForExport, true);
  });

  it("a missing client name blocks generation (AC#6)", () => {
    const r = assessTenderMetadataCompleteness(input({ clientName: null, procuringEntityName: null }));
    assert.equal(r.missingCritical.some((f) => f.field === "clientName"), true);
    assert.equal(r.blockingForGeneration, false);
  });

  it("a fully-usable tender does not block", () => {
    assert.equal(assessTenderMetadataCompleteness(input()).blockingForGeneration, false);
  });
});
