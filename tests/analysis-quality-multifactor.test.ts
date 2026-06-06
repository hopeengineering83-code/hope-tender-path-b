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

describe("analysis-quality — regex fallback score cap", () => {
  it("caps score at 45 when analysisSource is REGEX_FALLBACK_AI_ERROR", () => {
    const report = assessTenderAnalysisQuality({
      requirements: goodRequirements(12),
      evaluationMethodology: "Technical 70%, Financial 30% — full scoring matrix.",
      submissionNotes: "Submit by email with exact filenames.",
      clientName: "World Bank Ethiopia",
      referenceNumber: "ETH-WB-2024-001",
      country: "Ethiopia",
      matchingScore: 80,
      analysisSource: "REGEX_FALLBACK_AI_ERROR",
    });
    assert.ok(report.isRegexFallback, "isRegexFallback should be true");
    assert.ok(report.score <= 45, `Expected score <= 45 for regex fallback, got ${report.score}`);
    assert.ok(report.warnings.some((w) => /regex.*(fallback|cap)|cap.*regex/i.test(w)), `Expected regex fallback warning, got: ${JSON.stringify(report.warnings)}`);
  });

  it("caps score at 45 when analysisSource is DETERMINISTIC_FALLBACK", () => {
    const report = assessTenderAnalysisQuality({
      requirements: goodRequirements(12),
      evaluationMethodology: "Technical 70%, Financial 30%",
      submissionNotes: "Submit by email.",
      analysisSource: "DETERMINISTIC_FALLBACK",
    });
    assert.ok(report.isRegexFallback, "isRegexFallback should be true for DETERMINISTIC_FALLBACK");
    assert.ok(report.score <= 45, `Expected score <= 45, got ${report.score}`);
  });

  it("does NOT cap score when analysisSource is AI", () => {
    const report = assessTenderAnalysisQuality({
      requirements: goodRequirements(12),
      evaluationMethodology: "Technical 70%, Financial 30%",
      submissionNotes: "Submit by email.",
      analysisSource: "AI",
    });
    assert.equal(report.isRegexFallback, false, "isRegexFallback should be false for AI source");
    assert.ok(report.score > 45, `Expected score > 45 for AI-analyzed tender, got ${report.score}`);
  });

  it("does NOT cap score when analysisSource is omitted (legacy callers)", () => {
    const report = assessTenderAnalysisQuality({
      requirements: goodRequirements(12),
      evaluationMethodology: "Technical 70%, Financial 30%",
      submissionNotes: "Submit by email.",
    });
    assert.equal(report.isRegexFallback, false, "isRegexFallback should be false when analysisSource omitted");
    assert.ok(report.score > 45, `Expected uncapped score for legacy callers without analysisSource, got ${report.score}`);
  });

  it("severity is UNSAFE under regex fallback even with otherwise healthy analysis", () => {
    const report = assessTenderAnalysisQuality({
      requirements: goodRequirements(15),
      evaluationMethodology: "Technical 70%, Financial 30% — full matrix.",
      submissionNotes: "Submit via email by deadline. Exact filenames required.",
      clientName: "World Bank",
      referenceNumber: "WB-2024-001",
      country: "Ethiopia",
      matchingScore: 90,
      analysisSource: "REGEX_FALLBACK_AI_ERROR",
    });
    assert.ok(report.score <= 45);
    assert.equal(report.severity, "UNSAFE", `Expected UNSAFE severity under regex fallback, got ${report.severity}`);
  });
});

describe("analysis-quality — production hard unsafe gates", () => {
  it("marks multi-page analysis unsafe when critical tender facts are missing", () => {
    const report = assessTenderAnalysisQuality({
      requirements: goodRequirements(2),
      evaluationMethodology: "",
      submissionNotes: "",
      clientName: null,
      totalPageCount: 12,
      extractedTextLength: 20000,
    });
    assert.equal(report.severity, "UNSAFE");
    assert.ok(report.warnings.some((w) => /fewer than 3 requirements/i.test(w)));
    assert.ok(report.warnings.some((w) => /deadline is missing/i.test(w)));
    assert.ok(report.warnings.some((w) => /submission method/i.test(w)));
  });

  it("marks unapproved regex fallback as unsafe even when the requirement list looks strong", () => {
    const report = assessTenderAnalysisQuality({
      requirements: goodRequirements(10),
      evaluationMethodology: "Technical 70%, Financial 30%",
      submissionNotes: "Submit by email before deadline.",
      clientName: "Ministry of Water and Energy",
      deadline: new Date("2026-07-01T00:00:00Z"),
      submissionMethod: "Email submission",
      totalPageCount: 10,
      extractedTextLength: 20000,
      analysisSource: "REGEX_FALLBACK_AI_ERROR",
    });
    assert.equal(report.severity, "UNSAFE");
    assert.ok(report.score <= 45);
  });

  it("marks weak/corrupted extraction status unsafe", () => {
    const report = assessTenderAnalysisQuality({
      requirements: goodRequirements(10),
      evaluationMethodology: "Technical 70%, Financial 30%",
      submissionNotes: "Submit by email before deadline.",
      clientName: "Ministry of Roads",
      deadline: new Date("2026-07-01T00:00:00Z"),
      submissionMethod: "Portal submission",
      totalPageCount: 8,
      extractedTextLength: 20000,
      analysisExtractionStatus: "OCR_REQUIRED",
    });
    assert.equal(report.severity, "UNSAFE");
  });
});

// Follow-up regression: callers often pass the persisted note detail
// ("regex fallback (REGEX_FALLBACK_AI_DISABLED)") rather than the
// normalized enum. The scorer must still block it unless the approval helper
// resolved HUMAN_APPROVED_REGEX_FALLBACK.
describe("analysis-quality — source normalization", () => {
  it("treats raw regex-fallback notes as unsafe", () => {
    const report = assessTenderAnalysisQuality({
      requirements: goodRequirements(12),
      evaluationMethodology: "Technical 70%, Financial 30%",
      submissionNotes: "Submit by email before deadline.",
      clientName: "Ministry of Urban Development",
      deadline: new Date("2026-07-01T00:00:00Z"),
      submissionMethod: "Email submission",
      totalPageCount: 9,
      analysisSource: "regex fallback (REGEX_FALLBACK_AI_DISABLED). AI disabled by operator.",
    });
    assert.equal(report.isRegexFallback, true);
    assert.equal(report.severity, "UNSAFE");
    assert.ok(report.score <= 45);
  });

  it("does not cap a human-approved regex fallback solely because the source contains regex fallback", () => {
    const report = assessTenderAnalysisQuality({
      requirements: goodRequirements(12),
      evaluationMethodology: "Technical 70%, Financial 30%",
      submissionNotes: "Submit by email before deadline.",
      clientName: "Ministry of Urban Development",
      deadline: new Date("2026-07-01T00:00:00Z"),
      submissionMethod: "Email submission",
      totalPageCount: 4,
      analysisSource: "HUMAN_APPROVED_REGEX_FALLBACK",
    });
    assert.equal(report.isRegexFallback, false);
    assert.notEqual(report.severity, "UNSAFE");
    assert.ok(report.score > 45);
  });
});

describe("analysis-quality — reviewed evidence selection", () => {
  const baseParams = {
    requirements: goodRequirements(10),
    evaluationMethodology: "Technical 70%, Financial 30%",
    submissionNotes: "Submit sealed envelope by deadline.",
    clientName: "Ministry of Health",
    deadline: new Date("2026-09-01T00:00:00Z"),
    submissionMethod: "Sealed envelope",
    totalPageCount: 8,
    extractedTextLength: 18000,
  };

  it("does not penalise when no matching score is present (vault not yet run)", () => {
    const report = assessTenderAnalysisQuality({
      ...baseParams,
      matchingScore: undefined,
      selectedReviewedExperts: 0,
      selectedReviewedProjects: 0,
    });
    assert.ok(
      !report.warnings.some((w) => /reviewed/i.test(w)),
      "Should not warn about reviewed evidence when matchingScore is absent",
    );
  });

  it("penalises when matching score is > 0 but all selected evidence is unreviewed", () => {
    const report = assessTenderAnalysisQuality({
      ...baseParams,
      matchingScore: 60,
      selectedReviewedExperts: 0,
      selectedReviewedProjects: 0,
    });
    assert.ok(
      report.warnings.some((w) => /unreviewed/i.test(w) || /reviewed/i.test(w)),
      `Expected an unreviewed-evidence warning, got: ${report.warnings.join("; ")}`,
    );
    assert.ok(report.score < 100, `Expected score penalty for unreviewed evidence, got ${report.score}`);
  });

  it("does not penalise when at least one reviewed expert is selected", () => {
    const withReviewed = assessTenderAnalysisQuality({ ...baseParams, matchingScore: 60, selectedReviewedExperts: 2, selectedReviewedProjects: 0 });
    const withoutReviewed = assessTenderAnalysisQuality({ ...baseParams, matchingScore: 60, selectedReviewedExperts: 0, selectedReviewedProjects: 0 });
    assert.ok(
      withReviewed.score > withoutReviewed.score,
      `Reviewed-evidence score (${withReviewed.score}) should exceed all-unreviewed score (${withoutReviewed.score})`,
    );
    assert.ok(!withReviewed.warnings.some((w) => /unreviewed/i.test(w)), "Should not warn when reviewed expert is selected");
  });

  it("does not penalise when at least one reviewed project is selected", () => {
    const report = assessTenderAnalysisQuality({ ...baseParams, matchingScore: 65, selectedReviewedExperts: 0, selectedReviewedProjects: 1 });
    assert.ok(!report.warnings.some((w) => /unreviewed/i.test(w)), "Should not warn when reviewed project is selected");
  });
});

describe("analysis-quality — source-grounding credits sourcePageNumber and sourceExactQuote", () => {
  it("requirements with sourcePageNumber count as grounded even without sectionReference", () => {
    const pagedReqs: AnalysisRequirementLike[] = Array.from({ length: 8 }, (_, i) => ({
      title: `Req ${i + 1}`,
      description: "A requirement description for the tender.",
      priority: "MANDATORY",
      sourcePageNumber: i + 1,
    }));
    const report = assessTenderAnalysisQuality({ requirements: pagedReqs, extractedTextLength: 8000 });
    assert.ok(report.subScores.sourceGrounding > 0, "sourceGrounding must be > 0 when requirements have sourcePageNumber");
  });

  it("requirements with sourceExactQuote count as grounded even without sectionReference", () => {
    const quotedReqs: AnalysisRequirementLike[] = Array.from({ length: 6 }, (_, i) => ({
      title: `Req ${i + 1}`,
      description: "Requirement text.",
      priority: "SCORED",
      sourceExactQuote: `"Verbatim quote from section ${i + 1} of the tender document."`,
    }));
    const report = assessTenderAnalysisQuality({ requirements: quotedReqs, extractedTextLength: 6000 });
    assert.ok(report.subScores.sourceGrounding > 0, "sourceGrounding must be > 0 when requirements have sourceExactQuote");
  });

  it("requirements without any source traceability score lower than those with quotes", () => {
    const traced: AnalysisRequirementLike[] = Array.from({ length: 8 }, (_, i) => ({
      title: `Req ${i + 1}`, description: "text.", priority: "MANDATORY",
      sourceExactQuote: `"Quote ${i + 1} from the document."`,
    }));
    const untraced: AnalysisRequirementLike[] = Array.from({ length: 8 }, (_, i) => ({
      title: `Req ${i + 1}`, description: "text.", priority: "MANDATORY",
    }));
    const tracedReport = assessTenderAnalysisQuality({ requirements: traced, extractedTextLength: 8000 });
    const untracedReport = assessTenderAnalysisQuality({ requirements: untraced, extractedTextLength: 8000 });
    assert.ok(
      tracedReport.subScores.sourceGrounding >= untracedReport.subScores.sourceGrounding,
      `Traced requirements (${tracedReport.subScores.sourceGrounding}) should not score lower than untraced (${untracedReport.subScores.sourceGrounding})`,
    );
  });
});
