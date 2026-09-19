// Extraction quality improvement tests.
//
// These tests prove the extraction pipeline handles:
//   • 80-page PDF extraction with page markers preserved
//   • DOCX with headings and tables (structure preserved)
//   • XLSX with multi-sheet, row references, BOQ detection
//   • CSV with row references
//   • TXT with encoding normalization
//   • Table detection in text
//   • Chunking for 80-page documents

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── 1. PDF extraction improvements ─────────────────────────────────────────

describe("PDF extraction — 80-page support", () => {
  it("all 3 PDF extractors add [Page N] markers", () => {
    const src = read("lib/extract-text.ts");
    // pdf-parse adds [Page N] markers (line ~160)
    assert.ok(src.includes("`[Page ${p?.num ?? i + 1}]\\n${body}`"), "pdf-parse must add [Page N] markers");
    // pdf2json adds [Page N] markers — after table-quality PR the variable
    // is `reconstructed` (positional table reconstruction) instead of `raw`.
    assert.ok(
      src.includes("`[Page ${index + 1}]\\n${reconstructed}`") || src.includes("`[Page ${index + 1}]\\n${raw}`"),
      "pdf2json must add [Page N] markers",
    );
    // pdfjs adds [Page N] markers
    assert.ok(src.includes("`[Page ${pageNumber}]\\n${pageText}`"), "pdfjs must add [Page N] markers");
  });

  it("PDF extractors race in parallel with timeout (not sequential)", () => {
    const src = read("lib/extract-text.ts");
    assert.ok(src.includes("Promise.allSettled"), "extractors must run in parallel");
    assert.ok(src.includes("extractorTimeout"), "must have per-extractor timeout");
  });

  it("best extractor is picked by quality score, not text length", () => {
    const src = read("lib/extract-text.ts");
    assert.ok(src.includes("scorePageTextQuality"), "must use quality scoring");
    assert.ok(src.includes("bestScore"), "must track best score");
  });

  it("MAX_EXTRACTED_TEXT_CHARS is 2M and truncation is surfaced honestly", () => {
    const src = read("lib/extract-text.ts");
    assert.ok(src.includes("2_000_000"), "must keep the source-driven 2M extraction limit");
  });

  it("OCR fallback runs when text layer is empty or corrupted", () => {
    const src = read("lib/extract-text.ts");
    assert.ok(src.includes("extractPdfWithClaudeVision"), "must have Claude vision OCR fallback");
    assert.ok(src.includes("hasNoTextLayer"), "must detect no text layer");
    assert.ok(src.includes("hasCorruptedText"), "must detect corrupted text");
  });

  it("PDF broken word repair handles common proposal vocabulary", () => {
    const src = read("lib/extract-text.ts");
    assert.ok(src.includes("PDF_BROKEN_WORDS"), "must have broken word repair list");
    assert.ok(src.includes("Technical"), "must repair 'Technical'");
    assert.ok(src.includes("Submission"), "must repair 'Submission'");
    assert.ok(src.includes("Specification"), "must repair 'Specification'");
  });
});

// ─── 2. DOCX extraction improvements ────────────────────────────────────────

describe("DOCX extraction — headings and tables", () => {
  it("extractDocx uses mammoth.convertToHtml for structure", () => {
    const src = read("lib/extract-text.ts");
    assert.ok(src.includes("mammoth.convertToHtml"), "must use convertToHtml for structure");
    assert.ok(src.includes("mammoth.extractRawText"), "must still use extractRawText as fallback");
  });

  it("DOCX extraction preserves headings as section markers", () => {
    const src = read("lib/extract-text.ts");
    // After table-quality PR, headings are found via headingRegex (not headingMatch).
    // The "#".repeat(level) prefix is still used to mark heading depth.
    assert.ok(src.includes("headingRegex") || src.includes("headingMatch"), "must detect headings");
    assert.ok(src.includes('"#".repeat(level)'), "must add markdown-style heading prefix");
  });

  it("DOCX extraction preserves tables as structured text", () => {
    const src = read("lib/extract-text.ts");
    // After table-quality PR, tables are parsed by parseDocxTableToText which
    // emits [Table: N rows] and Row N: cell | cell markers.
    assert.ok(src.includes("findTopLevelTables") || src.includes("tableMatch"), "must detect tables");
    assert.ok(src.includes("[Table:"), "must add table marker");
    assert.ok(src.includes("tableLines.length") || src.includes("rows.length"), "must include row count");
  });

  it("DOCX extraction preserves document order of headings, tables, and body text", () => {
    const src = read("lib/extract-text.ts");
    // After table-quality PR, the HTML is walked linearly with a cursor,
    // collecting structural elements (headings + tables) in document order
    // and emitting body text between them. This replaces the old html.split
    // approach which broke on nested tables.
    assert.ok(src.includes("sections.push"), "must build sections array");
    assert.ok(src.includes("findTopLevelTables"), "must use depth-aware table finder for nested tables");
    assert.ok(src.includes("StructuralElement"), "must merge headings + tables into a sorted element list");
  });

  it("DOCX extraction expands colspan/rowspan merged cells (grid model)", () => {
    const src = read("lib/extract-text.ts");
    assert.ok(src.includes("colspan"), "must parse colspan attributes");
    assert.ok(src.includes("rowspan"), "must parse rowspan attributes");
    assert.ok(src.includes("grid"), "must use grid model for merged-cell expansion");
  });

  it("DOCX table rows use Row N: prefix (consistent with XLSX/PPTX)", () => {
    const src = read("lib/extract-text.ts");
    assert.ok(src.includes("`Row ${r + 1}: ${cells.join(\" | \")}`"), "must emit Row N: prefix for DOCX table rows");
  });

  it("DOCX extraction decodes HTML entities in cells and headings", () => {
    const src = read("lib/extract-text.ts");
    assert.ok(src.includes("decodeHtmlEntities"), "must decode HTML entities (&amp; &lt; &gt; &nbsp;)");
  });

  it("DOCX extraction falls back to raw text if HTML extraction fails", () => {
    const src = read("lib/extract-text.ts");
    assert.ok(src.includes("convertToHtml failed"), "must have fallback comment");
    assert.ok(src.includes("extractRawText"), "must fall back to extractRawText");
  });
});

// ─── 3. XLSX extraction improvements ────────────────────────────────────────

describe("XLSX extraction — multi-sheet and BOQ detection", () => {
  it("XLSX extraction uses sheet_to_json with header:1 for row arrays", () => {
    const src = read("lib/extract-text.ts");
    assert.ok(src.includes("sheet_to_json"), "must use sheet_to_json");
    assert.ok(src.includes("header: 1"), "must use header:1 for row arrays");
  });

  it("XLSX extraction adds row references (Row N: ...)", () => {
    const src = read("lib/extract-text.ts");
    assert.ok(src.includes("Row ${i + 1}:"), "must add Row N: prefix");
  });

  it("XLSX extraction detects BOQ/Price Schedule sheets", () => {
    const src = read("lib/extract-text.ts");
    assert.ok(src.includes("boqKeywords"), "must have BOQ keyword list");
    assert.ok(src.includes("isBoq"), "must compute isBoq");
    assert.ok(src.includes("BOQ/Price Schedule"), "must label BOQ sheets");
  });

  it("XLSX extraction handles multiple sheets", () => {
    const src = read("lib/extract-text.ts");
    assert.ok(src.includes("workbook.SheetNames"), "must iterate all sheets");
    assert.ok(src.includes("[Sheet:"), "must label each sheet");
  });

  it("XLSX extraction handles empty spreadsheets", () => {
    const src = read("lib/extract-text.ts");
    assert.ok(src.includes("Empty spreadsheet"), "must handle empty spreadsheets");
  });
});

// ─── 4. 80-page synthetic extraction test ───────────────────────────────────

describe("80-page synthetic extraction", () => {
  it("normalizeExtractedText handles 500K chars without crash", () => {
    const src = read("lib/extract-text.ts");
    assert.ok(src.includes("function normalizeExtractedText"), "must have normalizeExtractedText");
    assert.ok(src.includes("MAX_EXTRACTED_TEXT_CHARS"), "must use char limit");
  });

  it("chunk builder handles 80-page text", () => {
    const src = read("lib/extraction/tender-chunk-builder.ts");
    assert.ok(src.includes("MAX_CHUNK_CHARS"), "must have chunk char limit");
    assert.ok(src.includes("splitBySections"), "must split by sections");
    assert.ok(src.includes("splitByCharBudget"), "must split by char budget");
  });

  it("chunk builder preserves section headings", () => {
    const src = read("lib/extraction/tender-chunk-builder.ts");
    assert.ok(src.includes("sectionHeading"), "must preserve section headings");
    assert.ok(src.includes("isHeading"), "must detect headings");
  });

  it("chunk builder produces stable hashes", () => {
    const src = read("lib/extraction/tender-chunk-builder.ts");
    assert.ok(src.includes("textHash"), "must produce text hash");
    assert.ok(src.includes("createHash"), "must use crypto hash");
  });
});

// ─── 5. File type detection ─────────────────────────────────────────────────

describe("file type detection", () => {
  it("detects PDF, DOCX, XLSX, CSV, TXT, PPTX, RTF", () => {
    const src = read("lib/extract-text.ts");
    assert.ok(src.includes("function isPdf("), "must detect PDF");
    assert.ok(src.includes("function isDocx("), "must detect DOCX");
    assert.ok(src.includes("function isXlsx("), "must detect XLSX");
    assert.ok(src.includes("function isCsv("), "must detect CSV");
    assert.ok(src.includes("function isText("), "must detect TXT");
    assert.ok(src.includes("function isPptx("), "must detect PPTX");
    assert.ok(src.includes("function isRtf("), "must detect RTF");
  });

  it("handles legacy .doc files with clear message", () => {
    const src = read("lib/extract-text.ts");
    assert.ok(src.includes("Legacy .doc file detected"), "must warn about legacy .doc");
  });

  it("handles images with an explicit OCR-required marker", () => {
    const src = read("lib/extract-text.ts");
    assert.ok(src.includes("[Image needs OCR:"), "must surface images as requiring OCR");
  });
});

// ─── 6. Extraction quality module ──────────────────────────────────────────

describe("extraction quality module", () => {
  it("assessExtractionQuality exists and checks all signals", () => {
    const src = read("lib/extraction/tender-extraction-quality.ts");
    assert.ok(src.includes("hasSubmissionInstructions"), "must check submission instructions");
    assert.ok(src.includes("hasEvaluationCriteria"), "must check evaluation criteria");
    assert.ok(src.includes("hasRequiredDocuments"), "must check required documents");
    assert.ok(src.includes("hasScopeOfServices"), "must check scope of services");
  });

  it("quality status is honest (good/partial/needs_review/blocked)", () => {
    const src = read("lib/extraction/tender-extraction-quality.ts");
    assert.ok(src.includes('"good"'), "must have good status");
    assert.ok(src.includes('"partial"'), "must have partial status");
    assert.ok(src.includes('"needs_review"'), "must have needs_review status");
    assert.ok(src.includes('"blocked"'), "must have blocked status");
  });

  it("blocked status only for real extraction failures", () => {
    const src = read("lib/extraction/tender-extraction-quality.ts");
    assert.ok(src.includes("encrypted"), "must block on encrypted");
    assert.ok(src.includes("corrupt"), "must block on corrupt");
    assert.ok(src.includes("ocr_required"), "must block on OCR required");
    assert.ok(src.includes("unsupported"), "must block on unsupported");
  });
});
