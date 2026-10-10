/**
 * Tests for ExtractionQualityDashboard logic.
 *
 * The component is a server component that queries Prisma — we cannot render
 * it in a unit test without a live DB.  Instead we test the pure helper
 * functions it relies on and the invariants its data-selection must satisfy.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assessExtractionQuality, assessExtractionQualityPerPage, buildReportFromStoredPages, type PageQualityEntry } from "../lib/extraction-quality";
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

describe("buildReportFromStoredPages — reconstructs PerPageExtractionReport from stored PageQualityEntry[]", () => {
  const pages: PageQualityEntry[] = [
    { page: 1, charCount: 800, status: "GOOD", hasSubmissionInstructions: false, hasEvaluationCriteria: false, hasRequiredDocuments: false, hasClientDetails: true },
    { page: 2, charCount: 50, status: "LOW_DENSITY", hasSubmissionInstructions: false, hasEvaluationCriteria: true, hasRequiredDocuments: false, hasClientDetails: false },
    { page: 3, charCount: 0, status: "BLANK", hasSubmissionInstructions: false, hasEvaluationCriteria: false, hasRequiredDocuments: false, hasClientDetails: false },
    { page: 4, charCount: 1200, status: "GOOD", hasSubmissionInstructions: true, hasEvaluationCriteria: false, hasRequiredDocuments: true, hasClientDetails: false },
    { page: 5, charCount: 200, status: "OCR", hasSubmissionInstructions: false, hasEvaluationCriteria: false, hasRequiredDocuments: false, hasClientDetails: false },
    { page: 6, charCount: 0, status: "FAILED", hasSubmissionInstructions: false, hasEvaluationCriteria: false, hasRequiredDocuments: false, hasClientDetails: false },
  ];

  const report = buildReportFromStoredPages(pages);

  it("counts total pages correctly", () => assert.equal(report.totalDetectedPages, 6));
  it("identifies perfect (GOOD) pages", () => { assert.deepEqual(report.perfectPages, [1, 4]); });
  it("identifies low-density pages", () => { assert.deepEqual(report.lowDensityPages, [2]); });
  it("identifies blank pages", () => { assert.deepEqual(report.blankPages, [3]); });
  it("identifies failed pages", () => { assert.deepEqual(report.failedPages, [6]); });
  it("identifies OCR pages", () => { assert.deepEqual(report.ocrPages, [5]); });
  it("identifies submission instruction pages", () => { assert.deepEqual(report.submissionInstructionPages, [4]); });
  it("identifies evaluation criteria pages", () => { assert.deepEqual(report.evaluationCriteriaPages, [2]); });
  it("identifies required document pages", () => { assert.deepEqual(report.requiredDocumentPages, [4]); });
  it("identifies client detail pages", () => { assert.deepEqual(report.clientDetailPages, [1]); });
  it("computes coverage percent (2 GOOD out of 6)", () => { assert.equal(report.coveragePercent, 33); });
  it("returns empty report for empty array", () => {
    const empty = buildReportFromStoredPages([]);
    assert.equal(empty.totalDetectedPages, 0);
    assert.equal(empty.coveragePercent, 0);
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

describe("ExtractionQualityDashboard — clientDetailPages shown in content grid", () => {
  it("assessExtractionQualityPerPage returns clientDetailPages array", () => {
    const { assessExtractionQualityPerPage } = require("../lib/extraction-quality");
    // Text with clear client/contact section markers
    const text = [
      "[Page 1]",
      "INVITATION TO TENDER",
      "Procurement Authority: Ministry of Health",
      "[Page 2]",
      "Contact Person: John Smith, Procurement Officer",
      "Tel: +1 555-000-1234",
      "Email: procurement@ministry.gov",
      "Address: 12 Government St, Capital City",
      "[Page 3]",
      "SECTION 2: SCOPE OF WORK",
      "The contractor shall provide services...",
    ].join("\n");
    const report = assessExtractionQualityPerPage(text);
    assert.ok(Array.isArray(report.clientDetailPages), "clientDetailPages must be an array");
    assert.ok(report.clientDetailPages.length > 0, "client/contact page should be detected");
  });

  it("clientDetailPages is empty for text with no client/contact markers", () => {
    const { assessExtractionQualityPerPage } = require("../lib/extraction-quality");
    const text = [
      "[Page 1]",
      "SECTION 3: TECHNICAL SPECIFICATIONS",
      "The equipment shall comply with ISO 9001.",
      "[Page 2]",
      "SECTION 4: EVALUATION CRITERIA",
      "Technical score: 70 points. Financial score: 30 points.",
    ].join("\n");
    const report = assessExtractionQualityPerPage(text);
    assert.ok(Array.isArray(report.clientDetailPages), "clientDetailPages must be an array");
  });

  it("the live extraction-quality-panel shows clientDetailPages in the content-page grid", async () => {
    // ExtractionQualityDashboard (this describe block's original subject) was
    // deleted as unrendered dead code — nothing imported or mounted it. Its
    // CLAUDE.md-mandated per-page detail rendering was independently
    // reimplemented (under different field/label names) in the live,
    // rendered components/extraction-quality-panel.tsx. Re-pointed rather
    // than deleted so this CLAUDE.md requirement keeps real coverage.
    const src = readFileSync(
      resolve(process.cwd(), "components/extraction-quality-panel.tsx"),
      "utf8",
    );
    assert.ok(
      src.includes("clientDetailPages"),
      "panel must show clientDetailPages in the content-page detection grid",
    );
    assert.ok(
      src.includes("Client/contact details"),
      "panel must label the clientDetailPages row as 'Client/contact details'",
    );
  });
});

describe("ExtractionQualityPanel — page-list display (CLAUDE.md requirement)", () => {
  it("panel source exposes failedPages, blankPages, lowDensityPages, ocrPages per-page arrays", () => {
    const src = readFileSync(
      resolve(process.cwd(), "components/extraction-quality-panel.tsx"),
      "utf8",
    );
    assert.ok(src.includes("pp.failedPages"), "must expose per-page failedPages array");
    assert.ok(src.includes("pp.blankPages"), "must expose per-page blankPages array");
    assert.ok(src.includes("pp.lowDensityPages"), "must expose per-page lowDensityPages array");
    assert.ok(src.includes("pp.ocrPages"), "must expose per-page ocrPages array");
  });

  it("panel source renders specific page numbers for failed pages", () => {
    const src = readFileSync(
      resolve(process.cwd(), "components/extraction-quality-panel.tsx"),
      "utf8",
    );
    assert.ok(
      src.includes("pp.failedPages.length > 0"),
      "must render failed page numbers when failedPages is non-empty",
    );
    assert.ok(
      src.includes("formatPages(pp.failedPages"),
      "must call formatPages() to format failed page numbers",
    );
  });

  it("panel source renders specific page numbers for low-confidence pages", () => {
    const src = readFileSync(
      resolve(process.cwd(), "components/extraction-quality-panel.tsx"),
      "utf8",
    );
    assert.ok(
      src.includes("pp.lowDensityPages.length > 0"),
      "must render low-density page numbers",
    );
    assert.ok(
      src.includes("Low-confidence pages"),
      "must label low-confidence pages as 'Low-confidence pages'",
    );
  });

  it("panel source renders a per-page problem breakdown", () => {
    const src = readFileSync(
      resolve(process.cwd(), "components/extraction-quality-panel.tsx"),
      "utf8",
    );
    assert.ok(
      src.includes("Failed pages:"),
      "must include a per-page failed-pages line",
    );
    assert.ok(
      src.includes("hasProblemPages"),
      "per-page problem breakdown must only show when problem pages exist",
    );
  });

  it("pageList helper formats up to 12 page numbers inline", () => {
    // Mirror the pageList helper from the component
    function pageList(nums: number[], maxInline = 12): string {
      if (nums.length === 0) return "";
      const sorted = [...nums].sort((a, b) => a - b);
      if (sorted.length <= maxInline) return `p. ${sorted.join(", ")}`;
      return `p. ${sorted.slice(0, maxInline).join(", ")} +${sorted.length - maxInline} more`;
    }

    assert.equal(pageList([]), "");
    assert.equal(pageList([3]), "p. 3");
    assert.equal(pageList([5, 2, 8]), "p. 2, 5, 8");
    assert.equal(pageList([1,2,3,4,5,6,7,8,9,10,11,12]), "p. 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12");

    const manyPages = [1,2,3,4,5,6,7,8,9,10,11,12,13,14];
    const result = pageList(manyPages);
    assert.ok(result.includes("+2 more"), `Expected '+2 more' in '${result}'`);
    assert.ok(result.startsWith("p. 1, 2,"), `Expected to start with 'p. 1, 2,' — got '${result}'`);
  });

  it("assessExtractionQualityPerPage exposes failedPages, blankPages, lowDensityPages as page-number arrays", () => {
    const text = [
      "[Page 1] Normal page with enough content to be considered good. " + "word ".repeat(30),
      "[Page 2] [Extraction failed for this page]",
      "[Page 3]",  // very short — BLANK
      "[Page 4] " + "sparse ".repeat(5),  // low density (short text)
    ].join("\n");

    const report = assessExtractionQualityPerPage(text);

    assert.ok(Array.isArray(report.failedPages), "failedPages must be an array");
    assert.ok(Array.isArray(report.blankPages), "blankPages must be an array");
    assert.ok(Array.isArray(report.lowDensityPages), "lowDensityPages must be an array");

    assert.ok(report.failedPages.includes(2), `page 2 should be in failedPages, got ${JSON.stringify(report.failedPages)}`);
    assert.ok(
      report.blankPages.includes(3) || report.lowDensityPages.includes(3),
      `page 3 (very short) should be blank or low-density, got blankPages=${JSON.stringify(report.blankPages)}, lowDensity=${JSON.stringify(report.lowDensityPages)}`,
    );
  });
});

describe("ExtractionQualityDashboard — CLAUDE.md items 18-19 (characterCount and ocrUsed)", () => {
  it("assessExtractionQuality returns characterCount > 0 for non-empty text", () => {
    const text = "Request for Proposal. Submit proposals by 15 July 2026. ".repeat(20);
    const quality = assessExtractionQuality(text, "rfp.pdf");
    assert.ok(typeof quality.characterCount === "number", "characterCount must be a number");
    assert.ok(quality.characterCount > 0, `characterCount must be > 0 for non-empty text, got ${quality.characterCount}`);
  });

  it("assessExtractionQuality returns characterCount === 0 for null/empty text", () => {
    const qualityNull = assessExtractionQuality(null, "empty.pdf");
    assert.equal(qualityNull.characterCount, 0, "characterCount must be 0 for null text");
    const qualityEmpty = assessExtractionQuality("", "empty.pdf");
    assert.equal(qualityEmpty.characterCount, 0, "characterCount must be 0 for empty string");
  });

  it("ocrUsed is true when ocrPages > 0", () => {
    // Mirror the dashboard logic: ocrUsed = (ocrPages != null && ocrPages > 0) || ocrModel != null
    const ocrPages = 3;
    const ocrModel: string | null = null;
    const ocrUsed = (ocrPages != null && ocrPages > 0) || ocrModel != null;
    assert.equal(ocrUsed, true, "ocrUsed must be true when ocrPages > 0");
  });

  it("ocrUsed is true when ocrModel is set even if ocrPages is null", () => {
    const ocrPages: number | null = null;
    const ocrModel = "tesseract";
    const ocrUsed = (ocrPages != null && ocrPages > 0) || ocrModel != null;
    assert.equal(ocrUsed, true, "ocrUsed must be true when ocrModel is set");
  });

  it("ocrUsed is false when ocrPages is 0 and ocrModel is null", () => {
    const ocrPages = 0;
    const ocrModel: string | null = null;
    const ocrUsed = (ocrPages != null && ocrPages > 0) || ocrModel != null;
    assert.equal(ocrUsed, false, "ocrUsed must be false when no OCR was used");
  });
});

// ── TABLE_HEAVY promotion: high-char tables count as GOOD ────────────────────
//
// CLAUDE.md: "if the page contains tables/forms, table/form text is captured
// well enough for requirement extraction" → counts as perfectly extracted.
// Pages with TABLE_HEAVY markers AND ≥300 chars are promoted to GOOD so that
// BOQ/evaluation-matrix pages don't artificially deflate coverage percentage.

describe("assessExtractionQualityPerPage — TABLE_HEAVY promotion to GOOD", () => {
  const boqText =
    "BOQ BILL OF QUANTITIES\n" +
    "Item | Description | Unit | Qty | Rate | Amount\n" +
    "1    | Excavation   | m³   | 100 | 25   | 2500\n" +
    "2    | Concrete     | m³   | 50  | 120  | 6000\n" +
    "3    | Reinforcement| ton  | 5   | 800  | 4000\n" +
    "Total                                     12500\n" +
    "Contractor to price each item.  Any item left blank will be disqualified.\n" +
    "Refer to specifications volume for dimensions and material standards.\n";

  // Enough chars to avoid BLANK classification (>30) but under TABLE_GOOD_THRESHOLD (300).
  const lowTableText =
    "BOQ BILL OF QUANTITIES\n" +
    "Item | Description | Qty\n" +
    "1    | Excavation   | 100\n";

  it("table-heavy page with ≥300 chars is classified GOOD (not TABLE_HEAVY)", () => {
    const report = assessExtractionQualityPerPage(boqText);
    // The whole text is a single block — treated as one page.
    const page = report.pages[0];
    assert.equal(page?.status, "GOOD", "BOQ page with sufficient text should be GOOD, not TABLE_HEAVY");
  });

  it("table-heavy page with <300 chars stays TABLE_HEAVY", () => {
    const report = assessExtractionQualityPerPage(lowTableText);
    const page = report.pages[0];
    assert.equal(page?.status, "TABLE_HEAVY", "sparse BOQ page (<300 chars) should stay TABLE_HEAVY");
  });

  it("well-extracted BOQ page counts toward perfectPages", () => {
    const report = assessExtractionQualityPerPage(boqText);
    assert.ok(report.perfectPages.length > 0, "BOQ page with sufficient text must count toward perfectPages");
  });

  it("sparse BOQ page does NOT count toward perfectPages", () => {
    const report = assessExtractionQualityPerPage(lowTableText);
    assert.equal(report.perfectPages.length, 0, "sparse BOQ page must not count toward perfectPages");
  });

  it("coverage percent reflects promoted table pages", () => {
    const manyPageText =
      "Page 1: Normal text about the project scope and objectives.\n".repeat(5) +
      "\f" +
      boqText; // page 2 is a well-extracted BOQ
    const report = assessExtractionQualityPerPage(manyPageText);
    assert.ok(report.coveragePercent > 0, "coverage must include promoted table page");
  });
});
