import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { isExtractionCorrupted, assessExtractionQuality } from "../lib/extraction-quality";
import {
  isExtractionAcceptableForGeneration,
  isExtractionAcceptableForExport,
  deriveExtractionStatus,
} from "../lib/engine/extraction-quality-gate";

const BAD_TEXT = Array.from({ length: 80 }, (_, index) => `R F P ${index} X Q Z 1 2 3 @@@ ###`).join("\n");
const GOOD_TEXT = "Request for Proposal. Submit technical and financial proposals by 30 June 2026. Evaluation criteria include methodology, team, experience, and price.";

function metrics(score: number | null, totalPages = 5, extractedPages = totalPages) {
  return [{ extractionScore: score, totalPages, extractedPages, ocrPages: 0, failedPages: 0 }];
}

describe("extraction safety gates", () => {
  it("detects bad extraction and allows clean extraction", () => {
    assert.equal(isExtractionCorrupted(BAD_TEXT).corrupted, true);
    assert.equal(isExtractionCorrupted(GOOD_TEXT).corrupted, false);
  });

  it("blocks bad extraction from generation and export", () => {
    const bad = assessExtractionQuality(BAD_TEXT, "scan.pdf");
    assert.equal(bad.corrupted, true);
    assert.ok(bad.score < 40);
    assert.equal(isExtractionAcceptableForGeneration(metrics(bad.score)), false);
    assert.equal(isExtractionAcceptableForExport(metrics(bad.score)), false);
  });

  it("derives expected extraction statuses", () => {
    assert.equal(deriveExtractionStatus(metrics(22), [BAD_TEXT]), "EXTRACTION_CORRUPTED_AI_SKIPPED");
    assert.equal(deriveExtractionStatus(metrics(25, 10, 10)), "REGEX_FALLBACK_FROM_WEAK_EXTRACTION");
    assert.equal(deriveExtractionStatus(metrics(95, 10, 10), [GOOD_TEXT]), "FULL_EXTRACTION_AI_ANALYZED");
  });
});

describe("route source safety checks", () => {
  const aiAnalyze = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/ai-analyze/route.ts"), "utf8");
  const buildPlan = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/submission-plan/build/route.ts"), "utf8");
  const generate = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/generate/route.ts"), "utf8");
  const exportRoute = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/export/route.ts"), "utf8");

  it("keeps AI Analyze extraction and fallback status wiring", () => {
    assert.ok(aiAnalyze.includes("isExtractionCorrupted"));
    assert.ok(aiAnalyze.includes("EXTRACTION_CORRUPTED_AI_SKIPPED"));
    assert.ok(aiAnalyze.includes("REGEX_FALLBACK_FROM_WEAK_EXTRACTION"));
    assert.ok(aiAnalyze.includes("analysisExtractionStatus"));
    assert.equal(aiAnalyze.includes("Legacy path: no job tracking"), false);
  });

  it("keeps downstream extraction gates wired", () => {
    assert.ok(buildPlan.includes("isExtractionAcceptableForGeneration"));
    assert.ok(buildPlan.includes("EXTRACTION_QUALITY_INSUFFICIENT"));
    assert.ok(generate.includes("isExtractionAcceptableForGeneration") || generate.includes("EXTRACTION_QUALITY_INSUFFICIENT") || generate.includes("extractionScore"));
    assert.ok(exportRoute.includes("isExtractionAcceptableForExport"));
    assert.ok(exportRoute.includes("EXTRACTION_QUALITY_INSUFFICIENT"));
    assert.ok(exportRoute.includes("OCR_REQUIRED"));
    assert.ok(exportRoute.includes("EXTRACTION_WEAK_REVIEW_REQUIRED"));
  });
});
