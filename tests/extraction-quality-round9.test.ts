/**
 * Regression tests for the extraction quality fixes (round 9 — deferred gaps).
 *
 * Tests the following fixes:
 * 1. totalPages defaults to 1 for DOCX/XLSX/PPTX (was null — blocked all non-PDF)
 * 2. Export route re-assesses extraction quality from extractedText (was stale)
 * 3. Dead code deleted (extraction-quality-calc.ts)
 * 4. MAX_EXTRACTED_TEXT_CHARS conflict documented (500K fires before 2M)
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

describe("extraction quality round 9 — MAX_EXTRACTED_TEXT_CHARS conflict documented", () => {
  const src = read("lib/upload-security.ts");

  it("documents the 500K vs 2M conflict", () => {
    assert.ok(
      src.includes("fires FIRST") && src.includes("500_000"),
      "must document that the 500K inner limiter fires before the 2M outer limiter",
    );
    assert.ok(
      src.includes("extractionTruncated flag is therefore effectively always"),
      "must document that extractionTruncated is effectively always false",
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
