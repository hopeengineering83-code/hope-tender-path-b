// Regression tests for the multi-factor analysis quality scoring.
//
// Production screenshots showed Analysis Quality = 100/100 while
// Matching Quality was 0/100 and client metadata was corrupted. These
// tests pin the scorer to penalise BOTH metadata invalidity and zero
// matching, so a tender with clear extraction problems can never claim
// "Tender analysis appears usable".

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { assessTenderAnalysisQuality, type AnalysisRequirementLike } from "../lib/analysis-quality";

function goodRequirements(count: number): AnalysisRequirementLike[] {
  return Array.from({ length: count }, (_, i) => ({
    title: `Requirement ${i + 1}`,
    description: `Description for requirement ${i + 1} with evaluation scoring criteria and weight points.`,
    requirementType: i === 0 ? "EXPERT" : "TECHNICAL",
    priority: i < 3 ? "MANDATORY" : "STANDARD",
    sectionReference: `Section ${String.fromCharCode(65 + (i % 4))}.${i + 1}`,
  }));
}

describe("analysis-quality — base behaviour (legacy callers, no metadata params)", () => {
  it("still scores high when only requirements are present", () => {
    const report = assessTenderAnalysisQuality({
      requirements: goodRequirements(10),
      evaluationMethodology: "Technical 70%, Financial 30% — scoring matrix attached.",
      submissionNotes: "Email submission required by deadline. Use exact file names.",
    });
    assert.ok(report.score >= 75, `Expected score >= 75 for healthy tender, got ${report.score}`);
    assert.equal(report.severity, "GOOD");
  });
});

describe("analysis-quality — Gap 4: metadata penalties", () => {
  it("penalises when clientName is the corrupted TOC fragment", () => {
    const report = assessTenderAnalysisQuality({
      requirements: goodRequirements(10),
      evaluationMethodology: "Technical 70%, Financial 30% — scoring matrix attached.",
      submissionNotes: "Email submission required by deadline. Use exact file names.",
      clientName: "references (where available) Photos or drawings of completed projects",
    });
    assert.ok(report.metadataIssues.length >= 1, `Expected metadataIssues populated, got: ${JSON.stringify(report.metadataIssues)}`);
    assert.ok(report.score < 100, `Expected score < 100 with corrupted client name, got ${report.score}`);
  });

  it("penalises when reference is the literal 'only'", () => {
    const report = assessTenderAnalysisQuality({
      requirements: goodRequirements(10),
      evaluationMethodology: "Technical 70%, Financial 30%",
      submissionNotes: "Submit by email.",
      referenceNumber: "only",
    });
    assert.ok(report.metadataIssues.some((m) => /reference/i.test(m)), `Expected reference metadata issue, got: ${JSON.stringify(report.metadataIssues)}`);
    assert.ok(report.score < 100);
  });

  it("penalises invalid country", () => {
    const report = assessTenderAnalysisQuality({
      requirements: goodRequirements(10),
      evaluationMethodology: "Technical 70%, Financial 30%",
      submissionNotes: "Submit by email.",
      country: "A ddis Ababa",
    });
    assert.ok(report.metadataIssues.some((m) => /country/i.test(m)));
  });

  it("does NOT penalise when metadata fields are simply absent (legacy mode)", () => {
    const report = assessTenderAnalysisQuality({
      requirements: goodRequirements(10),
      evaluationMethodology: "Technical 70%, Financial 30%",
      submissionNotes: "Submit by email.",
    });
    assert.equal(report.metadataIssues.length, 0);
  });
});

describe("analysis-quality — Gap 4: matching readiness sub-score", () => {
  it("score drops when matching is 0/100", () => {
    const withoutMatching = assessTenderAnalysisQuality({
      requirements: goodRequirements(10),
      evaluationMethodology: "Technical 70%, Financial 30%",
      submissionNotes: "Submit by email.",
    });
    const withZeroMatching = assessTenderAnalysisQuality({
      requirements: goodRequirements(10),
      evaluationMethodology: "Technical 70%, Financial 30%",
      submissionNotes: "Submit by email.",
      matchingScore: 0,
    });
    assert.ok(withZeroMatching.score < withoutMatching.score, `Expected matching=0 to reduce score (${withZeroMatching.score} vs ${withoutMatching.score})`);
    assert.equal(withZeroMatching.subScores.matchingReadiness, 0);
    assert.ok(withZeroMatching.warnings.some((w) => /matching\s+score\s+is\s+0/i.test(w)));
  });

  it("the screenshot scenario (perfect extraction + corrupted metadata + 0 matching) does NOT score 100", () => {
    // This is the canonical regression: pre-fix the report claimed 100/100
    // "Tender analysis appears usable" while matching was 0 and client
    // metadata was a TOC fragment.
    const report = assessTenderAnalysisQuality({
      requirements: goodRequirements(10),
      evaluationMethodology: "Technical 70%, Financial 30%",
      submissionNotes: "Submit by email. Use exact file names.",
      clientName: "references (where available) Photos or drawings",
      referenceNumber: "only",
      country: "A ddis Ababa",
      clientContactName: "s Contact Person",
      matchingScore: 0,
    });
    assert.ok(report.score < 75, `Expected score < 75 with broken metadata and 0 matching, got ${report.score}`);
    assert.notEqual(report.severity, "GOOD");
    assert.ok(report.metadataIssues.length >= 3, `Expected 3+ metadata issues, got: ${JSON.stringify(report.metadataIssues)}`);
  });
});

describe("analysis-quality — sub-scores are populated", () => {
  it("returns all six sub-scores in the report", () => {
    const report = assessTenderAnalysisQuality({
      requirements: goodRequirements(5),
      evaluationMethodology: "Technical 70%, Financial 30%",
      extractedTextLength: 12000,
      matchingScore: 75,
    });
    assert.ok(typeof report.subScores.extractionQuality === "number");
    assert.ok(typeof report.subScores.requirementExtraction === "number");
    assert.ok(typeof report.subScores.metadataQuality === "number");
    assert.ok(typeof report.subScores.submissionPlanQuality === "number");
    assert.ok(typeof report.subScores.matchingReadiness === "number");
    assert.ok(typeof report.subScores.sourceGrounding === "number");
  });
});
