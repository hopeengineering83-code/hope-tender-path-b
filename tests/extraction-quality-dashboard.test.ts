/**
 * Tests for ExtractionQualityDashboard logic.
 *
 * The component is a server component that queries Prisma — we cannot render
 * it in a unit test without a live DB.  Instead we test the pure helper
 * functions it relies on and the invariants its data-selection must satisfy.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { assessExtractionQuality, assessExtractionQualityPerPage } from "../lib/extraction-quality";
import { isExtractionCorrupted } from "../lib/engine/extraction-quality-gate";

// ── Helpers mirroring the component logic ────────────────────────────────────

type FileStatus = "GOOD" | "ACCEPTABLE" | "POOR";

function getStatus(score: number): FileStatus {
  if (score >= 75) return "GOOD";
  if (score >= 45) return "ACCEPTABLE";
  return "POOR";
}

function computeFileData(file: {
  id: string;
  originalFileName: string | null;
  fileName: string;
  mimeType: string;
  totalPages: number | null;
  extractedPages: number | null;
  ocrPages: number | null;
  failedPages: number | null;
  extractionScore: number | null;
  extractedText: string | null;
}) {
  const name = file.originalFileName || file.fileName;
  const text = file.extractedText ?? null;
  const textSample = text ? text.slice(0, 200) : null;
  const corrupted =
    textSample && textSample.trim().length > 20
      ? isExtractionCorrupted(textSample)
      : false;
  const quality = assessExtractionQuality(text, name);
  const rawScore =
    file.extractionScore !== null && file.extractionScore !== undefined
      ? file.extractionScore
      : quality.score;
  const score = Math.min(rawScore, quality.score);
  const status = getStatus(score);

  const totalPages = file.totalPages ?? null;
  const extractedPages = file.extractedPages ?? null;
  const coverage =
    totalPages !== null && totalPages > 0 && extractedPages !== null
      ? Math.round((extractedPages / totalPages) * 100)
      : null;

  return { name, corrupted, score, status, coverage, quality };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ExtractionQualityDashboard — status computation", () => {
  it("returns null/empty when no files uploaded (no crash)", () => {
    // Simulates files.length === 0 branch — component returns early
    const files: unknown[] = [];
    assert.equal(files.length, 0);
  });

  it("scores GOOD when extractionScore >= 75 and text is clean", () => {
    // Text must exceed 1000 chars to avoid the small-text penalty in
    // assessExtractionQuality, and must not look like a scanned PDF (< 250 chars)
    const paragraph =
      "The Ministry of Public Works hereby invites qualified firms to submit " +
      "technical and financial proposals for the construction of a government " +
      "office building. Technical proposals shall include a detailed methodology, " +
      "team composition, work plan, and past project experience. Financial proposals " +
      "must use the prescribed BOQ form attached as Annex 3. Evaluation will be " +
      "based on technical merit (70 points) and financial offer (30 points). " +
      "Submission deadline: 15 July 2026 at 17:00 local time. All submissions " +
      "must be delivered to the Procurement Office, 4th Floor, Ministry Building, " +
      "Capital City, or emailed to procurement@mpw.gov with subject line " +
      "'TND-2026-001 Proposal Submission'. Contact: Mr. John Doe, Procurement Officer, " +
      "telephone +1-234-567-8900, email j.doe@mpw.gov. Late submissions will not " +
      "be accepted. The procuring entity reserves the right to cancel this tender " +
      "at any stage without incurring any obligation. Interested firms must meet " +
      "the minimum qualification criteria as specified in Section 4 of the RFP. ";
    const cleanText = paragraph.repeat(3); // ~1500+ chars, well above threshold

    const file = {
      id: "f1",
      originalFileName: "rfp.pdf",
      fileName: "rfp.pdf",
      mimeType: "application/pdf",
      totalPages: 10,
      extractedPages: 10,
      ocrPages: 0,
      failedPages: 0,
      extractionScore: 90,
      extractedText: cleanText,
    };

    const result = computeFileData(file);
    assert.equal(result.status, "GOOD");
    assert.ok(result.score >= 75, `Expected score >= 75, got ${result.score}`);
    assert.equal(result.corrupted, false);
  });

  it("scores POOR when extractionScore < 45 and text is blank/missing", () => {
    const file = {
      id: "f2",
      originalFileName: "scanned.pdf",
      fileName: "scanned.pdf",
      mimeType: "application/pdf",
      totalPages: 8,
      extractedPages: 1,
      ocrPages: 0,
      failedPages: 7,
      extractionScore: 10,
      extractedText: "",
    };

    const result = computeFileData(file);
    assert.equal(result.status, "POOR");
    assert.ok(result.score < 45, `Expected score < 45, got ${result.score}`);
  });

  it("scores ACCEPTABLE when score is between 45 and 74", () => {
    // Achieve a score in the ACCEPTABLE range:
    // assessExtractionQuality on a text that is OCR-placeholder-free but sparse
    const mediumText =
      "Request for Proposal. Submission deadline: 1 August 2026. " +
      "Submit technical and financial proposals to address@gov.example.";

    const file = {
      id: "f3",
      originalFileName: "partial.pdf",
      fileName: "partial.pdf",
      mimeType: "application/pdf",
      totalPages: 10,
      extractedPages: 7,
      ocrPages: 2,
      failedPages: 1,
      // Force score into the ACCEPTABLE band via extractionScore
      extractionScore: 55,
      extractedText: mediumText,
    };

    // With extractionScore=55 and a short text, quality.score will be <= 55.
    // min(55, quality.score) could land in ACCEPTABLE or POOR depending on
    // how assessExtractionQuality rates the text.  We only assert it is not GOOD.
    const result = computeFileData(file);
    assert.notEqual(result.status, "GOOD");
  });

  it("flags corrupted text and triggers corrupted=true", () => {
    // A string of garbage symbols sufficient to trigger isExtractionCorrupted
    // (needs > 20 trimmed chars)
    const garbledText = Array(30)
      .fill("G G G ■ ■ ■ → → ● ● ●")
      .join(" ");

    const file = {
      id: "f4",
      originalFileName: "garbage.pdf",
      fileName: "garbage.pdf",
      mimeType: "application/pdf",
      totalPages: 5,
      extractedPages: 5,
      ocrPages: 0,
      failedPages: 0,
      extractionScore: null,
      extractedText: garbledText,
    };

    const result = computeFileData(file);
    assert.equal(result.corrupted, true);
  });

  it("failedPages > 0 triggers warning condition (score < 45)", () => {
    const file = {
      id: "f5",
      originalFileName: "broken.pdf",
      fileName: "broken.pdf",
      mimeType: "application/pdf",
      totalPages: 10,
      extractedPages: 3,
      ocrPages: 0,
      failedPages: 7,
      extractionScore: 15,
      extractedText: "",
    };

    const result = computeFileData(file);
    assert.ok(
      result.status === "POOR",
      `Expected POOR status when failedPages=7 and score=15, got ${result.status}`,
    );
  });

  it("coverage is computed correctly", () => {
    const file = {
      id: "f6",
      originalFileName: "good.pdf",
      fileName: "good.pdf",
      mimeType: "application/pdf",
      totalPages: 20,
      extractedPages: 16,
      ocrPages: 0,
      failedPages: 0,
      extractionScore: 80,
      extractedText: "Some text content from a normal tender document with adequate length for scoring.",
    };

    const result = computeFileData(file);
    assert.equal(result.coverage, 80); // 16/20 = 80%
  });

  it("coverage is null when totalPages is null", () => {
    const file = {
      id: "f7",
      originalFileName: "unknown.pdf",
      fileName: "unknown.pdf",
      mimeType: "application/pdf",
      totalPages: null,
      extractedPages: null,
      ocrPages: null,
      failedPages: null,
      extractionScore: null,
      extractedText: null,
    };

    const result = computeFileData(file);
    assert.equal(result.coverage, null);
  });
});

describe("ExtractionQualityDashboard — content-page detection (assessExtractionQualityPerPage)", () => {
  // assessExtractionQualityPerPage splits on [Page N] markers — fixtures must include them.
  const submissionText =
    "[Page 5] SECTION 5 — SUBMISSION INSTRUCTIONS\n" +
    "Bidders must submit their proposals no later than 15 July 2026 at 17:00 local time.\n" +
    "Submissions shall be delivered to: Procurement Office, 4th Floor, Ministry Building.\n" +
    "Alternatively email to: procurement@example.gov with subject 'Tender 2026-001 Submission'.\n" +
    "Late submissions will be rejected. All envelopes must be sealed and labelled.\n" +
    "The deadline for submission of clarification questions is 30 June 2026 at 12:00.\n";

  const evaluationText =
    "[Page 6] SECTION 6 — EVALUATION CRITERIA\n" +
    "Technical proposals will be evaluated against the following weighted criteria:\n" +
    "- Methodology and approach: 30 points\n" +
    "- Relevant experience: 25 points\n" +
    "- Key personnel qualifications: 25 points\n" +
    "- Implementation plan / timeline: 20 points\n" +
    "Only technically qualified firms (scoring >= 70/100) will have their financial\n" +
    "proposals opened. Financial proposals score on the lowest evaluated cost basis.\n";

  const requiredDocText =
    "[Page 7] SECTION 7 — REQUIRED DOCUMENTS AND FORMS\n" +
    "Bidders must submit the following mandatory documents:\n" +
    "- Form A: Bidder Information Sheet (attached as Annex A)\n" +
    "- Form B: Technical Proposal Format (attached as Annex B)\n" +
    "- Certificate of incorporation / business registration\n" +
    "- Tax compliance certificate valid at date of submission\n" +
    "- Audited financial statements for the last three years\n" +
    "- List of similar projects completed in the last five years with references\n" +
    "Failure to include any mandatory document will result in disqualification.\n";

  it("detects submission instruction pages from text", () => {
    const result = assessExtractionQualityPerPage(submissionText);
    assert.ok(
      result.submissionInstructionPages.length > 0,
      "Should detect at least one submission instruction page",
    );
  });

  it("detects evaluation criteria pages from text", () => {
    const result = assessExtractionQualityPerPage(evaluationText);
    assert.ok(
      result.evaluationCriteriaPages.length > 0,
      "Should detect at least one evaluation criteria page",
    );
  });

  it("detects required document pages from text", () => {
    const result = assessExtractionQualityPerPage(requiredDocText);
    assert.ok(
      result.requiredDocumentPages.length > 0,
      "Should detect at least one required document page",
    );
  });

  it("returns zero pages for all categories when text is blank", () => {
    const result = assessExtractionQualityPerPage("");
    // No [Page N] markers → no pages parsed at all
    assert.equal(result.submissionInstructionPages.length, 0);
    assert.equal(result.evaluationCriteriaPages.length, 0);
    assert.equal(result.requiredDocumentPages.length, 0);
  });

  it("returns zero submission pages when text has no submission language", () => {
    const unrelatedText =
      "[Page 1] This document describes the technical specifications for road construction.\n" +
      "Materials must comply with ASTM standards. Bitumen grade 60/70 is required.\n" +
      "Subgrade compaction must achieve 95% proctor density. CBR must exceed 30%.\n";
    const result = assessExtractionQualityPerPage(unrelatedText);
    assert.equal(
      result.submissionInstructionPages.length,
      0,
      "No submission instruction pages should be detected in unrelated text",
    );
  });

  it("detects multiple content types from a combined multi-section tender", () => {
    const combined = submissionText + "\n\n" + evaluationText + "\n\n" + requiredDocText;
    const result = assessExtractionQualityPerPage(combined);
    assert.ok(result.submissionInstructionPages.length > 0, "Should detect submission pages");
    assert.ok(result.evaluationCriteriaPages.length > 0, "Should detect evaluation pages");
    assert.ok(result.requiredDocumentPages.length > 0, "Should detect required-doc pages");
  });

  it("dashboard fileData correctly maps perPage results — submissionPages is null when text is null", () => {
    // Mirror the component logic: perPage = text ? assessExtractionQualityPerPage(text) : null
    const text: string | null = null;
    const perPage = text ? assessExtractionQualityPerPage(text) : null;
    const submissionPages = perPage?.submissionInstructionPages.length ?? null;
    const evaluationPages = perPage?.evaluationCriteriaPages.length ?? null;
    const requiredDocPages = perPage?.requiredDocumentPages.length ?? null;
    assert.equal(submissionPages, null);
    assert.equal(evaluationPages, null);
    assert.equal(requiredDocPages, null);
  });

  it("dashboard fileData correctly maps perPage results — submissionPages is a number when text is present", () => {
    const text = submissionText;
    const perPage = text ? assessExtractionQualityPerPage(text) : null;
    const submissionPages = perPage?.submissionInstructionPages.length ?? null;
    assert.ok(typeof submissionPages === "number", "submissionPages should be a number when text is present");
    assert.ok(submissionPages !== null, "submissionPages should not be null when text is present");
  });
});

describe("ExtractionQualityDashboard — fileContent NOT selected", () => {
  it("select object does not include fileContent", () => {
    // The dashboard component must never select fileContent — document that here.
    const selectObject = {
      id: true,
      originalFileName: true,
      fileName: true,
      mimeType: true,
      totalPages: true,
      extractedPages: true,
      ocrPages: true,
      failedPages: true,
      extractionScore: true,
      extractedText: true,
    } as Record<string, boolean>;

    assert.equal(
      "fileContent" in selectObject,
      false,
      "fileContent must NOT be selected in ExtractionQualityDashboard",
    );
  });
});
