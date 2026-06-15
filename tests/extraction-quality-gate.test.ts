import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  deriveExtractionStatus,
  isExtractionAcceptableForGeneration,
  isExtractionAcceptableForExport,
  summarizeExtractionCoverage,
} from "../lib/engine/quality/extraction-quality-gate";

describe("deriveExtractionStatus", () => {
  it("returns FULL_EXTRACTION_AI_ANALYZED for high-score files with no OCR or failures", () => {
    const status = deriveExtractionStatus([{ extractionScore: 90, totalPages: 10, extractedPages: 10, ocrPages: 0, failedPages: 0 }]);
    assert.equal(status, "FULL_EXTRACTION_AI_ANALYZED");
  });

  it("returns PARTIAL_EXTRACTION_AI_ANALYZED when OCR was used", () => {
    const status = deriveExtractionStatus([{ extractionScore: 80, totalPages: 10, extractedPages: 8, ocrPages: 2, failedPages: 0 }]);
    assert.equal(status, "PARTIAL_EXTRACTION_AI_ANALYZED");
  });

  it("returns EXTRACTION_WEAK_REVIEW_REQUIRED for mid-range score", () => {
    const status = deriveExtractionStatus([{ extractionScore: 55, totalPages: 10, extractedPages: 7, ocrPages: 0, failedPages: 3 }]);
    assert.equal(status, "EXTRACTION_WEAK_REVIEW_REQUIRED");
  });

  it("returns REGEX_FALLBACK_FROM_WEAK_EXTRACTION for very poor score", () => {
    const status = deriveExtractionStatus([{ extractionScore: 15, totalPages: 10, extractedPages: 2, ocrPages: 0, failedPages: 8 }]);
    assert.equal(status, "REGEX_FALLBACK_FROM_WEAK_EXTRACTION");
  });

  it("returns EXTRACTION_WEAK_REVIEW_REQUIRED when score or page count is unknown", () => {
    const status = deriveExtractionStatus([{ extractionScore: null, totalPages: null, extractedPages: null, ocrPages: null, failedPages: null }]);
    assert.equal(status, "EXTRACTION_WEAK_REVIEW_REQUIRED");
  });

  it("returns EXTRACTION_WEAK_REVIEW_REQUIRED for empty files array", () => {
    const status = deriveExtractionStatus([]);
    assert.equal(status, "EXTRACTION_WEAK_REVIEW_REQUIRED");
  });
});

describe("isExtractionAcceptableForGeneration", () => {
  it("accepts FULL_EXTRACTION and complete PARTIAL_EXTRACTION", () => {
    assert.equal(isExtractionAcceptableForGeneration([{ extractionScore: 90, totalPages: 5, extractedPages: 5, ocrPages: 0, failedPages: 0 }]), true);
    assert.equal(isExtractionAcceptableForGeneration([{ extractionScore: 50, totalPages: 5, extractedPages: 5, ocrPages: 1, failedPages: 0 }]), true);
  });

  it("blocks REGEX_FALLBACK (score < threshold)", () => {
    assert.equal(isExtractionAcceptableForGeneration([{ extractionScore: 15, totalPages: 5, extractedPages: 1, ocrPages: 0, failedPages: 4 }]), false);
  });

  it("blocks unknown page counts and incomplete extracted page coverage", () => {
    assert.equal(isExtractionAcceptableForGeneration([{ extractionScore: 90, totalPages: null, extractedPages: null, ocrPages: 0, failedPages: 0 }]), false);
    assert.equal(isExtractionAcceptableForGeneration([{ extractionScore: 90, totalPages: 5, extractedPages: 4, ocrPages: 0, failedPages: 0 }]), false);
  });
});

describe("isExtractionAcceptableForExport", () => {
  it("rejects empty files array", () => {
    assert.equal(isExtractionAcceptableForExport([]), false);
  });

  it("rejects files with very low score", () => {
    assert.equal(isExtractionAcceptableForExport([{ extractionScore: 10, totalPages: 5, extractedPages: 1, ocrPages: 0, failedPages: 4 }]), false);
  });

  it("rejects files with null score or unknown page count", () => {
    assert.equal(isExtractionAcceptableForExport([{ extractionScore: null, totalPages: null, extractedPages: null, ocrPages: null, failedPages: null }]), false);
  });

  it("accepts files with acceptable score and complete coverage", () => {
    assert.equal(isExtractionAcceptableForExport([{ extractionScore: 60, totalPages: 5, extractedPages: 5, ocrPages: 0, failedPages: 0 }]), true);
  });
});


describe("summarizeExtractionCoverage", () => {
  it("reports total/perfect/OCR/weak/failed counts and page lists", () => {
    const report = summarizeExtractionCoverage([
      { fileName: "rfp.pdf", extractionScore: 90, totalPages: 10, extractedPages: 10, ocrPages: 2, failedPages: 1 },
    ]);
    assert.equal(report.totalPagesKnown, true);
    assert.equal(report.totalPages, 10);
    assert.equal(report.ocrPages, 2);
    assert.equal(report.failedPages, 1);
    assert.ok(report.failedPageList.length > 0);
    assert.ok(report.recommendedActions.includes("Re-extract PDF"));
  });

  it("marks unknown total pages as a blocking coverage problem", () => {
    const report = summarizeExtractionCoverage([
      { fileName: "legacy.pdf", extractionScore: 90, totalPages: null, extractedPages: null, ocrPages: 0, failedPages: 0 },
    ]);
    assert.equal(report.totalPagesKnown, false);
    assert.ok(report.blockingReasons.some((reason) => /page count is unknown/i.test(reason)));
  });
});
