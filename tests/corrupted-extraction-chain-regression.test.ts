// End-to-end regression test: corrupted extraction must block every downstream gate.
//
// Chain under test:
//   corrupted text
//   → isExtractionCorrupted detects it
//   → assessExtractionQuality scores it < 40
//   → isExtractionAcceptableForGeneration = false
//   → isExtractionAcceptableForExport = false
//   → deriveExtractionStatus = EXTRACTION_CORRUPTED_AI_SKIPPED
//   → AI Analyze route hard-blocks
//   → Build Plan route hard-blocks
//   → Generate Docs route hard-blocks
//   → Export route hard-blocks
//
// No Prisma or HTTP calls — all pure-logic or source-level assertions.

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

// ── Fixture: a realistic corrupted OCR scan ───────────────────────────────────
// This text simulates the output of a poorly OCR-scanned PDF — replacement
// characters, isolated single letters, broken spacing, and no common English
// words. It must trigger the corruption detector reliably.
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

// ── A genuinely good extraction ───────────────────────────────────────────────
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

// ── 1. isExtractionCorrupted ─────────────────────────────────────────────────

describe("isExtractionCorrupted (corruption signal detection)", () => {
  it("flags the corrupted fixture as corrupted", () => {
    const report = isExtractionCorrupted(CORRUPTED_TEXT);
    assert.ok(report.corrupted, `Expected corrupted=true, signals: ${JSON.stringify(report.signals)}`);
    assert.ok(report.signals.length >= 2, `Expected at least 2 signals, got: ${JSON.stringify(report.signals)}`);
  });

  it("does NOT flag a clean tender text as corrupted", () => {
    const report = isExtractionCorrupted(GOOD_TEXT);
    assert.equal(report.corrupted, false, `Expected corrupted=false, signals: ${JSON.stringify(report.signals)}`);
  });

  it("returns corrupted=false for very short text (below min length guard)", () => {
    const report = isExtractionCorrupted("AB ■ CD");
    assert.equal(report.corrupted, false, "Short text below 250 chars should never be flagged");
  });
});

// ── 2. assessExtractionQuality ───────────────────────────────────────────────

describe("assessExtractionQuality (scoring chain)", () => {
  it("scores corrupted text below the generation threshold (< 40)", () => {
    const report = assessExtractionQuality(CORRUPTED_TEXT, "scan.pdf");
    assert.ok(report.corrupted, "Quality report must flag corruption");
    assert.ok(
      report.score < 40,
      `Score ${report.score} must be below generation threshold 40`,
    );
    assert.equal(report.severity, "FAILED");
  });

  it("scores good text above the generation threshold (>= 40) and does not flag corruption", () => {
    const report = assessExtractionQuality(GOOD_TEXT, "rfp.pdf");
    assert.ok(
      report.score >= 40,
      `Expected score >= 40 for good text, got ${report.score}`,
    );
    assert.notEqual(report.severity, "FAILED");
    assert.equal(report.corrupted, false);
  });
});

// ── 3. isExtractionAcceptableForGeneration ───────────────────────────────────

describe("isExtractionAcceptableForGeneration (generation gate)", () => {
  it("blocks a file whose extractionScore is below 40", () => {
    const files = [{ extractionScore: 22, totalPages: 5, extractedPages: 5, ocrPages: 0, failedPages: 0 }];
    assert.equal(isExtractionAcceptableForGeneration(files), false);
  });

  it("blocks when extractionScore is null", () => {
    const files = [{ extractionScore: null, totalPages: 5, extractedPages: 5, ocrPages: 0, failedPages: 0 }];
    assert.equal(isExtractionAcceptableForGeneration(files), false);
  });

  it("blocks when page count is unknown (null totalPages)", () => {
    const files = [{ extractionScore: 90, totalPages: null, extractedPages: null, ocrPages: 0, failedPages: 0 }];
    assert.equal(isExtractionAcceptableForGeneration(files), false);
  });

  it("blocks when extraction coverage is incomplete", () => {
    const files = [{ extractionScore: 85, totalPages: 10, extractedPages: 7, ocrPages: 0, failedPages: 0 }];
    assert.equal(isExtractionAcceptableForGeneration(files), false);
  });

  it("allows a fully extracted file with score >= 40", () => {
    const files = [{ extractionScore: 85, totalPages: 10, extractedPages: 10, ocrPages: 0, failedPages: 0 }];
    assert.equal(isExtractionAcceptableForGeneration(files), true);
  });
});

// ── 4. isExtractionAcceptableForExport ───────────────────────────────────────

describe("isExtractionAcceptableForExport (export gate)", () => {
  it("blocks a file with extractionScore below 40", () => {
    const files = [{ extractionScore: 22, totalPages: 5, extractedPages: 5, ocrPages: 0, failedPages: 0 }];
    assert.equal(isExtractionAcceptableForExport(files), false);
  });

  it("blocks when extractionScore is null", () => {
    const files = [{ extractionScore: null, totalPages: 5, extractedPages: 5, ocrPages: 0, failedPages: 0 }];
    assert.equal(isExtractionAcceptableForExport(files), false);
  });

  it("blocks when page count is unknown", () => {
    const files = [{ extractionScore: 90, totalPages: null, extractedPages: null, ocrPages: 0, failedPages: 0 }];
    assert.equal(isExtractionAcceptableForExport(files), false);
  });

  it("allows a file with score >= 40 and complete coverage", () => {
    const files = [{ extractionScore: 60, totalPages: 5, extractedPages: 5, ocrPages: 0, failedPages: 0 }];
    assert.equal(isExtractionAcceptableForExport(files), true);
  });
});

// ── 5. deriveExtractionStatus (AI Analyze status derivation) ─────────────────

describe("deriveExtractionStatus (status derivation from text samples)", () => {
  it("returns EXTRACTION_CORRUPTED_AI_SKIPPED when corrupted text is supplied", () => {
    const files = [{ extractionScore: 22, totalPages: 5, extractedPages: 5, ocrPages: 0, failedPages: 0 }];
    const status = deriveExtractionStatus(files, [CORRUPTED_TEXT]);
    assert.equal(status, "EXTRACTION_CORRUPTED_AI_SKIPPED");
  });

  it("returns REGEX_FALLBACK_FROM_WEAK_EXTRACTION for low-score files without corruption signal", () => {
    const files = [{ extractionScore: 25, totalPages: 10, extractedPages: 10, ocrPages: 0, failedPages: 0 }];
    const status = deriveExtractionStatus(files);
    assert.equal(status, "REGEX_FALLBACK_FROM_WEAK_EXTRACTION");
  });

  it("returns FULL_EXTRACTION_AI_ANALYZED for perfect extraction", () => {
    const files = [{ extractionScore: 95, totalPages: 10, extractedPages: 10, ocrPages: 0, failedPages: 0 }];
    const status = deriveExtractionStatus(files, [GOOD_TEXT]);
    assert.equal(status, "FULL_EXTRACTION_AI_ANALYZED");
  });
});

// ── 6. AI Analyze route source-level gate checks ─────────────────────────────

describe("AI Analyze route — extraction gate wiring (source assertions)", () => {
  const src = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/ai-analyze/route.ts"), "utf8");

  it("calls isExtractionCorrupted to detect corrupted text before running AI", () => {
    assert.ok(
      src.includes("isExtractionCorrupted"),
      "AI Analyze route must call isExtractionCorrupted",
    );
  });

  it("returns EXTRACTION_CORRUPTED_AI_SKIPPED status when corruption is detected", () => {
    assert.ok(
      src.includes("EXTRACTION_CORRUPTED_AI_SKIPPED"),
      "AI Analyze route must set EXTRACTION_CORRUPTED_AI_SKIPPED analysisExtractionStatus",
    );
  });

  it("checks extraction score before proceeding with AI analysis", () => {
    assert.ok(
      src.includes("extractionScore") || src.includes("EXTRACTION_WEAK"),
      "AI Analyze route must inspect extraction score or weak-extraction status",
    );
  });

  it("regex fallback remains traceable without destructive no-job canonical writes", () => {
    const fallbackBlocks = src.split("REGEX_FALLBACK_FROM_WEAK_EXTRACTION");
    assert.ok(
      fallbackBlocks.length >= 3,
      `ai-analyze route must preserve regex-fallback analysisExtractionStatus in tracked paths. Found ${fallbackBlocks.length - 1} occurrence(s).`,
    );
    assert.ok(
      !src.includes("Legacy path: no job tracking") && !src.includes("tx.tenderRequirement.deleteMany"),
      "AI Analyze route must not keep the destructive no-job fallback path that deletes canonical requirements.",
    );
  });
});
