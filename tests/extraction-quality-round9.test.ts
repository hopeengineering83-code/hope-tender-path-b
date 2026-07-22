/**
 * Regression tests for the extraction quality fixes (round 9 — deferred gaps).
 *
 * Tests the following fixes:
 * 1. totalPages defaults to 1 for DOCX/XLSX/PPTX (was null — blocked all non-PDF)
 * 2. Export route re-assesses extraction quality from extractedText (was stale)
 * 3. Dead code deleted (extraction-quality-calc.ts)
 * 4. The source-driven 2M extraction cap is documented and exact-cap truncation is fail-closed
 * 5. Reimport route surfaces failed files in response body
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("extraction quality round 9 — totalPages for non-PDF (Option C)", () => {
  const src = read("lib/tender-upload-first.ts");

  it("uses assessExtractionQualityPerPage to derive totalPages", () => {
    assert.ok(
      src.includes("assessExtractionQualityPerPage(extractedText)"),
      "must use assessExtractionQualityPerPage (mirrors secure-upload-handler)",
    );
    assert.ok(
      src.includes("perPageReport.totalDetectedPages"),
      "must read totalDetectedPages from the per-page report",
    );
  });

  it("defaults totalPages to 1 for non-PDF (was null — blocked DOCX/XLSX/PPTX)", () => {
    assert.ok(
      src.includes("perPageReport.totalDetectedPages > 0 ? perPageReport.totalDetectedPages : null"),
      "must default to totalDetectedPages (1 for DOCX via DOCUMENT_LEVEL fallback) when markers exist, null only for empty/failed",
    );
    // The old broken derivation must NOT be present
    assert.ok(
      !src.includes("pageMarkers > 0 ? pageMarkers : null"),
      "old 'pageMarkers > 0 ? pageMarkers : null' derivation must be removed",
    );
  });
});

describe("extraction quality round 9 — export route re-assessment", () => {
  const src = read("app/api/tenders/[id]/export/route.ts");

  it("imports assessExtractionQuality", () => {
    assert.ok(
      src.includes('import { assessExtractionQuality } from'),
      "must import assessExtractionQuality (was missing — used stale stored metrics)",
    );
  });

  it("selects extractedText + originalFileName + id in the files Prisma select", () => {
    assert.ok(src.includes("extractedText: true"), "must select extractedText (was missing)");
    assert.ok(src.includes("originalFileName: true"), "must select originalFileName (was missing)");
    assert.ok(src.includes("id: true"), "must select id (was missing)");
  });

  it("re-assesses extraction quality from extractedText before the gate", () => {
    assert.ok(
      src.includes("assessExtractionQuality(file.extractedText, file.originalFileName)"),
      "must re-assess quality from extractedText (mirrors generate route)",
    );
    assert.ok(
      src.includes("Math.min(file.extractionScore ?? quality.score, quality.score)"),
      "must use Math.min(stored, fresh) to collapse stale scores",
    );
    assert.ok(
      src.includes("isExtractionAcceptableForExport(effectiveExtractionFiles)"),
      "must pass effectiveExtractionFiles to the gate (was tender.files)",
    );
  });
});

describe("extraction quality round 9 — dead code deleted", () => {
  it("extraction-quality-calc.ts is deleted", () => {
    assert.ok(
      !existsSync("lib/extraction-quality-calc.ts"),
      "lib/extraction-quality-calc.ts must be deleted (dead code — zero references, divergent thresholds)",
    );
  });
});

describe("extraction quality round 9/14 — source-driven 2M cap is fail-closed", () => {
  const extractionSrc = read("lib/extract-text.ts");
  const uploadSrc = read("lib/upload-security.ts");

  it("keeps one 2M extraction limit and detects exact-cap truncation", () => {
    assert.ok(
      extractionSrc.includes("MAX_EXTRACTED_TEXT_CHARS = 2_000_000"),
      "extract-text must retain the source-driven 2M cap",
    );
    assert.ok(
      uploadSrc.includes("INNER_EXTRACTION_CHAR_LIMIT") && uploadSrc.includes("fires FIRST"),
      "upload-security must reuse and document the inner extraction cap",
    );
    assert.ok(
      uploadSrc.includes("text.length >= INNER_EXTRACTION_CHAR_LIMIT"),
      "limitExtractedText must detect text cut at the inner cap",
    );
    assert.ok(
      !uploadSrc.includes("extractionTruncated flag is therefore effectively always"),
      "the stale always-false limitation note must be gone",
    );
  });
});

describe("extraction quality round 9 — reimport surfaces failures", () => {
  const src = read("app/api/company/reimport/route.ts");

  it("collects failed files into a failedFiles array", () => {
    assert.ok(
      src.includes("failedFiles: Array<{ name: string; error: string }>"),
      "must declare a failedFiles array",
    );
    assert.ok(
      src.includes("failedFiles.push("),
      "must push failed files into the array (was only logged)",
    );
  });

  it("includes failedFiles + docsFailed in the response body", () => {
    assert.ok(
      src.includes("docsFailed: failedFiles.length"),
      "must include docsFailed count in the response",
    );
    assert.ok(
      src.includes("failedFiles,"),
      "must include the failedFiles array in the response body",
    );
  });
});

describe("extraction truncation flag — behavioral (round 14)", () => {
  it("flags text cut at the inner cap as truncated (was silently partial)", async () => {
    const { limitExtractedText } = await import("../lib/upload-security");
    const { MAX_EXTRACTED_TEXT_CHARS: INNER } = await import("../lib/extract-text");
    const atCap = "x".repeat(INNER);
    const r = limitExtractedText(atCap);
    assert.equal(r.truncated, true, "text at exactly the inner cap means normalizeExtractedText cut the tail");
    assert.equal(r.text.length, INNER, "text at the inner cap is not sliced further");
  });

  it("does not flag text below the inner cap", async () => {
    const { limitExtractedText } = await import("../lib/upload-security");
    const { MAX_EXTRACTED_TEXT_CHARS: INNER } = await import("../lib/extract-text");
    const below = "x".repeat(INNER - 1);
    assert.deepEqual(limitExtractedText(below), { text: below, truncated: false });
  });

  it("still slices and flags text above the 2M outer cap", async () => {
    const { limitExtractedText, MAX_EXTRACTED_TEXT_CHARS: OUTER } = await import("../lib/upload-security");
    const over = "x".repeat(OUTER + 10);
    const r = limitExtractedText(over);
    assert.equal(r.truncated, true);
    assert.equal(r.text.length, OUTER);
  });

  it("upload paths surface the flag as a user-visible partial-extraction warning", () => {
    const uploadFirst = read("lib/tender-upload-first.ts");
    assert.ok(
      uploadFirst.includes("extracted text was truncated to the safe analysis limit"),
      "tender-upload-first must warn when extraction is truncated",
    );
  });
});
