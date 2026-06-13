// End-to-end regression: corrupted extraction must block every downstream gate.
// Pure logic and source-level checks only; no database or HTTP calls.

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

const CORRUPTED_TEXT = `
■■■ T e n d e r D o c u m e n t ■■■
R F P ■ N o . ■ 2 0 2 6 ■ / ■ 0 0 1
□ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □ □
A p p l i c a t i o n ■ f o r ■ S e r v i c e s
■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
S u b m i t ■ b y ■ 3 0 ■ J u n e ■ 2 0 2 6
□ → ← □ → ← □ → ← □ → ← □ → ← □ →
E v a l u a t i o n ■ C r i t e r i a ■ □ □ □
T e c h n i c a l ■ ■ ■ ■ ■ F i n a n c i a l
■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■
P r o c u r i n g ■ E n t i t y ■ N a m e ■ □ □ □
→ → → → → → → → → → → → → → → → → →
D e a d l i n e ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■
■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
`.repeat(3);

const GOOD_TEXT = `
[Page 1]
Request for Proposal — Road Rehabilitation Project
Procuring Entity: Ministry of Public Works
Reference: RFP/2026/001
Country: Ethiopia, Addis Ababa

[Page 2]
Submission Instructions:
Submit sealed envelope to 4th Floor, Ministry Building by 30 June 2026.
Email submission: submit@mopw.gov.et
Required email subject: RFP/2026/001 – Technical Proposal

[Page 3]
Evaluation Criteria:
Technical Score: 70 points (methodology, team, experience)
Financial Score: 30 points (price competitiveness)

[Page 4]
Required Documents:
1. Technical Proposal (Technical_Proposal.pdf)
2. Financial Proposal (Financial_Proposal.pdf)
3. Company Profile and Certificates (Annex A)
4. CVs of Key Experts (Annex B)

[Page 5]
Client Contact Details:
Contact: Mr. Dawit Bekele
Title: Procurement Officer
Email: d.bekele@mopw.gov.et
Phone: +251 911 234 567
Address: PO Box 1234, Addis Ababa
`.trim();

function fileMetrics(score: number | null, totalPages = 5, extractedPages = totalPages) {
  return [{ extractionScore: score, totalPages, extractedPages, ocrPages: 0, failedPages: 0 }];
}

describe("corruption detection and quality scoring", () => {
  it("flags realistic corrupted OCR but not clean or very short text", () => {
    const corrupted = isExtractionCorrupted(CORRUPTED_TEXT);
    assert.equal(corrupted.corrupted, true);
    assert.ok(corrupted.signals.length >= 2);
    assert.equal(isExtractionCorrupted(GOOD_TEXT).corrupted, false);
    assert.equal(isExtractionCorrupted("AB ■ CD").corrupted, false);
  });

  it("scores corrupted text below the generation threshold", () => {
    const bad = assessExtractionQuality(CORRUPTED_TEXT, "scan.pdf");
    const good = assessExtractionQuality(GOOD_TEXT, "rfp.pdf");
    assert.equal(bad.corrupted, true);
    assert.ok(bad.score < 40);
    assert.equal(bad.severity, "FAILED");
    assert.equal(good.corrupted, false);
    assert.ok(good.score >= 40);
  });
});

describe("generation and export extraction gates", () => {
  it("blocks low, unknown, or incomplete extraction", () => {
    assert.equal(isExtractionAcceptableForGeneration(fileMetrics(22)), false);
    assert.equal(isExtractionAcceptableForGeneration(fileMetrics(null)), false);
    assert.equal(isExtractionAcceptableForGeneration(fileMetrics(90, 10, 7)), false);
    assert.equal(isExtractionAcceptableForExport(fileMetrics(22)), false);
    assert.equal(isExtractionAcceptableForExport(fileMetrics(null)), false);
    assert.equal(isExtractionAcceptableForExport(fileMetrics(90, 10, 7)), false);
  });

  it("allows complete extraction above threshold", () => {
    assert.equal(isExtractionAcceptableForGeneration(fileMetrics(85, 10, 10)), true);
    assert.equal(isExtractionAcceptableForExport(fileMetrics(60, 5, 5)), true);
  });
});

describe("analysis extraction status", () => {
  it("distinguishes corrupted, weak, and complete extraction", () => {
    assert.equal(deriveExtractionStatus(fileMetrics(22), [CORRUPTED_TEXT]), "EXTRACTION_CORRUPTED_AI_SKIPPED");
    assert.equal(deriveExtractionStatus(fileMetrics(25, 10, 10)), "REGEX_FALLBACK_FROM_WEAK_EXTRACTION");
    assert.equal(deriveExtractionStatus(fileMetrics(95, 10, 10), [GOOD_TEXT]), "FULL_EXTRACTION_AI_ANALYZED");
  });
});

describe("AI Analyze route extraction and fallback wiring", () => {
  const src = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/ai-analyze/route.ts"), "utf8");

  it("blocks corrupted or weak extraction before AI", () => {
    assert.ok(src.includes("isExtractionCorrupted"));
    assert.ok(src.includes("EXTRACTION_CORRUPTED_AI_SKIPPED"));
    assert.ok(src.includes("extractionScore") || src.includes("EXTRACTION_WEAK"));
  });

  it("persists weak-extraction status in both safe staged fallback paths", () => {
    const occurrences = src.split("REGEX_FALLBACK_FROM_WEAK_EXTRACTION").length - 1;
    assert.ok(occurrences >= 2, `Expected at least 2 safe staged fallback status writes, found ${occurrences}`);
    assert.ok(src.includes('analysisExtractionStatus: "REGEX_FALLBACK_FROM_WEAK_EXTRACTION"'));
  });

  it("does not retain the destructive untracked canonical fallback", () => {
    assert.equal(src.includes("Legacy path: no job tracking"), false);
    assert.ok(src.includes("canonical requirements were preserved"));
  });
});

describe("downstream route extraction gates", () => {
  const buildPlan = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/submission-plan/build/route.ts"), "utf8");
  const generate = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/generate/route.ts"), "utf8");
  const exportRoute = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/export/route.ts"), "utf8");

  it("blocks plan building on poor or corrupted extraction", () => {
    assert.ok(buildPlan.includes("isExtractionAcceptableForGeneration"));
    assert.ok(buildPlan.includes("EXTRACTION_QUALITY_INSUFFICIENT"));
    assert.ok(buildPlan.includes("EXTRACTION_CORRUPTED_BUILD_PLAN_SKIPPED"));
    assert.ok(buildPlan.includes("status: 422") || buildPlan.includes("{ status: 422 }"));
  });

  it("blocks document generation on extraction, metadata, and vault failures", () => {
    assert.ok(generate.includes("isExtractionAcceptableForGeneration") || generate.includes("EXTRACTION_QUALITY_INSUFFICIENT") || generate.includes("extractionScore"));
    assert.ok(generate.includes("METADATA_CONTAMINATED"));
    assert.ok(generate.includes("EMPTY_VAULT"));
  });

  it("blocks export on every unsafe extraction status", () => {
    assert.ok(exportRoute.includes("isExtractionAcceptableForExport"));
    assert.ok(exportRoute.includes("EXTRACTION_QUALITY_INSUFFICIENT"));
    assert.ok(exportRoute.includes('"OCR_REQUIRED"'));
    assert.ok(exportRoute.includes('"EXTRACTION_WEAK_REVIEW_REQUIRED"'));
    assert.ok(exportRoute.includes('"PARTIAL_EXTRACTION_AI_ANALYZED"'));
  });
});

describe("full corrupted extraction chain", () => {
  it("corrupted input blocks generation and export", () => {
    const { score } = assessExtractionQuality(CORRUPTED_TEXT, "scan.pdf");
    const files = fileMetrics(score);
    assert.ok(score < 40);
    assert.equal(isExtractionAcceptableForGeneration(files), false);
    assert.equal(isExtractionAcceptableForExport(files), false);
    assert.equal(deriveExtractionStatus(files, [CORRUPTED_TEXT]), "EXTRACTION_CORRUPTED_AI_SKIPPED");
  });

  it("clean complete input passes both gates", () => {
    const { score } = assessExtractionQuality(GOOD_TEXT, "rfp.pdf");
    const files = fileMetrics(score);
    assert.ok(score >= 40);
    assert.equal(isExtractionAcceptableForGeneration(files), true);
    assert.equal(isExtractionAcceptableForExport(files), true);
  });
});
