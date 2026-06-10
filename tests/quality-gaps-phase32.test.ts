// Phase 32 quality-gap regression tests.
//
// Coverage:
//   1. engine/route: blocks when analysisExtractionStatus is EXTRACTION_CORRUPTED_AI_SKIPPED
//   2. engine/route: blocks when analysisExtractionStatus is REGEX_FALLBACK_FROM_WEAK_EXTRACTION
//   3. engine/route: fetches analysisExtractionStatus in the tender select query

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const engineSource = readFileSync(
  path.join(process.cwd(), "app/api/tenders/[id]/engine/route.ts"),
  "utf-8",
);

describe("engine/route — analysisExtractionStatus blocking checks", () => {
  it("selects analysisExtractionStatus from DB in tender query", () => {
    assert.ok(
      engineSource.includes("analysisExtractionStatus: true"),
      "engine route must select analysisExtractionStatus from the tender query",
    );
  });

  it("blocks engine run when analysisExtractionStatus is EXTRACTION_CORRUPTED_AI_SKIPPED", () => {
    assert.ok(
      engineSource.includes('"EXTRACTION_CORRUPTED_AI_SKIPPED"') &&
        engineSource.includes('"ANALYSIS_FROM_CORRUPTED_EXTRACTION"'),
      "engine route must block with ANALYSIS_FROM_CORRUPTED_EXTRACTION when analysisExtractionStatus is EXTRACTION_CORRUPTED_AI_SKIPPED",
    );
  });

  it("blocks engine run when analysisExtractionStatus is REGEX_FALLBACK_FROM_WEAK_EXTRACTION", () => {
    assert.ok(
      engineSource.includes('"REGEX_FALLBACK_FROM_WEAK_EXTRACTION"') &&
        engineSource.includes('"ANALYSIS_FROM_WEAK_EXTRACTION"'),
      "engine route must block with ANALYSIS_FROM_WEAK_EXTRACTION when analysisExtractionStatus is REGEX_FALLBACK_FROM_WEAK_EXTRACTION",
    );
  });

  it("provides RUN_OCR_OR_UPLOAD_CLEARER_SCAN as nextAction for corrupted extraction", () => {
    assert.ok(
      engineSource.includes('"RUN_OCR_OR_UPLOAD_CLEARER_SCAN"'),
      "engine route must suggest RUN_OCR_OR_UPLOAD_CLEARER_SCAN when analysis is from corrupted extraction",
    );
  });

  it("provides RERUN_AI_ANALYZE as nextAction for regex fallback extraction", () => {
    assert.ok(
      engineSource.includes('"RERUN_AI_ANALYZE"'),
      "engine route must suggest RERUN_AI_ANALYZE when analysis used regex fallback",
    );
  });

  it("places analysis status blocks after the extraction quality gate", () => {
    const extractionGateIdx = engineSource.indexOf("isExtractionAcceptableForGeneration");
    const corruptedBlockIdx = engineSource.indexOf('"ANALYSIS_FROM_CORRUPTED_EXTRACTION"');
    assert.ok(
      extractionGateIdx > -1 && corruptedBlockIdx > extractionGateIdx,
      "analysisExtractionStatus blocks must appear after the isExtractionAcceptableForGeneration gate",
    );
  });
});
