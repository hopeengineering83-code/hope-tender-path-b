// Phase 33 quality-gap regression tests.
//
// Coverage:
//   1. traceability/route: extractionMethod is derived from the source TenderFile's
//      extractionMethod field ("text" | "ocr" | "mixed" | "failed") rather than the
//      generic "ai_extracted" sentinel — so callers can distinguish OCR vs text reqs.
//   2. traceability/route: files query now selects extractionMethod from DB.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const traceSource = readFileSync(
  path.join(process.cwd(), "app/api/tenders/[id]/traceability/route.ts"),
  "utf-8",
);

describe("traceability/route — extractionMethod sourced from TenderFile", () => {
  it("selects extractionMethod from TenderFile in the files query", () => {
    assert.ok(
      traceSource.includes("extractionMethod: true"),
      "traceability route must select extractionMethod from TenderFile so per-requirement method can be derived",
    );
  });

  it("looks up source file by sourceTenderFileId to derive extractionMethod", () => {
    assert.ok(
      traceSource.includes("tender.files.find((f) => f.id === requirement.sourceTenderFileId)"),
      "traceability must look up the source TenderFile by sourceTenderFileId",
    );
  });

  it("uses the file extractionMethod when available", () => {
    assert.ok(
      traceSource.includes("srcFile?.extractionMethod"),
      "traceability must use the source file's extractionMethod field when the file is found",
    );
  });

  it("falls back to ai_extracted when file has no extractionMethod", () => {
    assert.ok(
      traceSource.includes('"ai_extracted"'),
      "traceability must fall back to ai_extracted when source file has no extractionMethod value",
    );
  });

  it("returns manual_or_unknown when requirement has no sourceTenderFileId", () => {
    assert.ok(
      traceSource.includes('"manual_or_unknown"'),
      "traceability must return manual_or_unknown when requirement has no sourceTenderFileId",
    );
  });
});
