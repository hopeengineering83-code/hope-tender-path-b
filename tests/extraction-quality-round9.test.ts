/**
 * Regression tests for the extraction quality fixes (round 9 — deferred gaps).
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("extraction quality round 9 — totalPages for non-PDF (Option C)", () => {
  const src = read("lib/ai-jobs/tender-extraction-service.ts");
  it("uses assessExtractionQualityPerPage to derive totalPages", () => {
    assert.ok(src.includes("assessExtractionQualityPerPage(text)"));
    assert.ok(src.includes("perPage.totalDetectedPages"));
  });
  it("defaults totalPages to the detected document-level page for non-PDF", () => {
    assert.ok(src.includes("perPage.totalDetectedPages > 0 ? perPage.totalDetectedPages : null"));
    assert.ok(!src.includes("pageMarkers > 0 ? pageMarkers : null"));
  });
});

describe("extraction quality round 9 — export route re-assessment", () => {
  const src = read("app/api/tenders/[id]/export/route.ts");
  it("imports assessExtractionQuality", () => {
    assert.ok(src.includes('import { assessExtractionQuality } from'));
  });
  it("selects extractedText + originalFileName + id in the files Prisma select", () => {
    assert.ok(src.includes("extractedText: true"));
    assert.ok(src.includes("originalFileName: true"));
    assert.ok(src.includes("id: true"));
  });
  it("re-assesses extraction quality from extractedText before the gate", () => {
    assert.ok(src.includes("assessExtractionQuality(file.extractedText, file.originalFileName)"));
    assert.ok(src.includes("Math.min(file.extractionScore ?? quality.score, quality.score)"));
    assert.ok(src.includes("isExtractionAcceptableForExport(effectiveExtractionFiles)"));
  });
});

describe("extraction quality round 9 — dead code deleted", () => {
  it("extraction-quality-calc.ts is deleted", () => {
    assert.ok(!existsSync("lib/extraction-quality-calc.ts"));
  });
});

describe("extraction quality round 9/14 — source-driven 2M cap is fail-closed", () => {
  const extractionSrc = read("lib/extract-text.ts");
  const uploadSrc = read("lib/upload-security.ts");
  it("keeps one 2M extraction limit and detects exact-cap truncation", () => {
    assert.ok(extractionSrc.includes("MAX_EXTRACTED_TEXT_CHARS = 2_000_000"));
    assert.ok(uploadSrc.includes("INNER_EXTRACTION_CHAR_LIMIT") && uploadSrc.includes("fires FIRST"));
    assert.ok(uploadSrc.includes("text.length >= INNER_EXTRACTION_CHAR_LIMIT"));
    assert.ok(!uploadSrc.includes("extractionTruncated flag is therefore effectively always"));
  });
});

describe("extraction quality round 9 — reimport surfaces failures", () => {
  // The re-extraction loop (and its failedFiles collection) moved out of
  // app/api/company/reimport/route.ts into lib/company-vault-reextraction.ts
  // so it can also run inside the VAULT_INGEST background job — the route
  // itself now only enqueues that job. See tests/vault-ingest-job.test.ts
  // for real end-to-end coverage of a failed re-extraction surfacing in the
  // job output.
  const src = read("lib/company-vault-reextraction.ts");
  it("collects failed files with public error text and an optional stable integrity code", () => {
    assert.match(src, /failedFiles: Array<\{ name: string; error: string; code\?: string \}>/);
    assert.match(src, /failedFiles\.push\(/);
    assert.match(src, /FILE_INTEGRITY_NOT_VERIFIED/);
  });
  it("returns reextracted + failedFiles from reextractAllCompanyDocuments", () => {
    assert.match(src, /export async function reextractAllCompanyDocuments/);
    assert.match(src, /return \{ reextracted, failedFiles \}/);
  });
});

describe("extraction truncation flag — behavioral (round 14)", () => {
  it("flags text cut at the inner cap as truncated", async () => {
    const { limitExtractedText } = await import("../lib/upload-security");
    const { MAX_EXTRACTED_TEXT_CHARS: INNER } = await import("../lib/extract-text");
    const atCap = "x".repeat(INNER);
    const result = limitExtractedText(atCap);
    assert.equal(result.truncated, true);
    assert.equal(result.text.length, INNER);
  });
  it("does not flag text below the inner cap", async () => {
    const { limitExtractedText } = await import("../lib/upload-security");
    const { MAX_EXTRACTED_TEXT_CHARS: INNER } = await import("../lib/extract-text");
    const below = "x".repeat(INNER - 1);
    assert.deepEqual(limitExtractedText(below), { text: below, truncated: false });
  });
  it("still slices and flags text above the outer cap", async () => {
    const { limitExtractedText, MAX_EXTRACTED_TEXT_CHARS: OUTER } = await import("../lib/upload-security");
    const over = "x".repeat(OUTER + 10);
    const result = limitExtractedText(over);
    assert.equal(result.truncated, true);
    assert.equal(result.text.length, OUTER);
  });
  it("upload paths surface a user-visible partial-extraction warning", () => {
    const worker = read("lib/ai-jobs/tender-extraction-service.ts");
    assert.match(worker, /extractionTruncated = limited\.truncated/);
    assert.match(worker, /Truncated: \$\{extractionTruncated \? "yes" : "no"\}/);
  });
});
