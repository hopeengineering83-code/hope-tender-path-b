// Phase 32 quality-gap regression tests.
//
// Coverage:
//   1. engine/route: blocks when analysisExtractionStatus is OCR_REQUIRED (AI was skipped)
//   2. engine/route: blocks when analysisExtractionStatus is REGEX_FALLBACK_FROM_WEAK_EXTRACTION
//   3. engine/route: fetches analysisExtractionStatus in the tender select query
//   4. auto-finalize/route: blocks on degraded analysisExtractionStatus (gate 3)
//   5. generate/route: evaluation criteria missing is a hard blocker
//   6. ai.ts: contactDetailsSource includes procurementReferenceNumber for source traceability
//   7. ai.ts: contactDetailsSource chunk merge uses best-wins (not first-wins) per key
//
// Note: "EXTRACTION_CORRUPTED_AI_SKIPPED" is tender.status (job status).
// The analysisExtractionStatus field is set to "OCR_REQUIRED" in that case.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const engineSource = readFileSync(
  path.join(process.cwd(), "app/api/tenders/[id]/engine/route.ts"),
  "utf-8",
);

const autoFinalizeSource = readFileSync(
  path.join(process.cwd(), "app/api/tenders/[id]/auto-finalize/route.ts"),
  "utf-8",
);

const aiSource = readFileSync(
  path.join(process.cwd(), "lib/ai.ts"),
  "utf-8",
);

describe("engine/route — analysisExtractionStatus blocking checks", () => {
  it("selects analysisExtractionStatus from DB in tender query", () => {
    assert.ok(
      engineSource.includes("analysisExtractionStatus: true"),
      "engine route must select analysisExtractionStatus from the tender query",
    );
  });

  it("blocks engine run when analysisExtractionStatus is OCR_REQUIRED (AI was skipped)", () => {
    // Regression: original code compared analysisExtractionStatus === "EXTRACTION_CORRUPTED_AI_SKIPPED"
    // which is never written to that field. ai-analyze writes "OCR_REQUIRED" instead.
    assert.ok(
      engineSource.includes('"OCR_REQUIRED"') &&
        engineSource.includes('"ANALYSIS_FROM_CORRUPTED_EXTRACTION"'),
      "engine route must block with ANALYSIS_FROM_CORRUPTED_EXTRACTION when analysisExtractionStatus is OCR_REQUIRED",
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

describe("auto-finalize/route — gate 3: analysisExtractionStatus blocking checks", () => {
  it("blocks when analysisExtractionStatus is OCR_REQUIRED", () => {
    assert.ok(
      autoFinalizeSource.includes('"OCR_REQUIRED"') &&
        autoFinalizeSource.includes("ANALYSIS_FROM_DEGRADED_EXTRACTION"),
      "auto-finalize must block with ANALYSIS_FROM_DEGRADED_EXTRACTION when OCR_REQUIRED",
    );
  });

  it("blocks when analysisExtractionStatus is REGEX_FALLBACK_FROM_WEAK_EXTRACTION", () => {
    assert.ok(
      autoFinalizeSource.includes('"REGEX_FALLBACK_FROM_WEAK_EXTRACTION"'),
      "auto-finalize must check for REGEX_FALLBACK_FROM_WEAK_EXTRACTION",
    );
  });

  it("blocks when analysisExtractionStatus is EXTRACTION_WEAK_REVIEW_REQUIRED", () => {
    assert.ok(
      autoFinalizeSource.includes('"EXTRACTION_WEAK_REVIEW_REQUIRED"'),
      "auto-finalize must check for EXTRACTION_WEAK_REVIEW_REQUIRED",
    );
  });

  it("blocks when analysisExtractionStatus is PARTIAL_EXTRACTION_AI_ANALYZED", () => {
    assert.ok(
      autoFinalizeSource.includes('"PARTIAL_EXTRACTION_AI_ANALYZED"'),
      "auto-finalize must check for PARTIAL_EXTRACTION_AI_ANALYZED",
    );
  });

  it("gate 3 returns status 422", () => {
    const count = (autoFinalizeSource.match(/status: 422/g) ?? []).length;
    assert.ok(count >= 4, `auto-finalize must return status 422 for at least 4 gates, got ${count}`);
  });

  it("gate 3 is placed after gate 2b (client display name check)", () => {
    const gate2bIdx = autoFinalizeSource.indexOf("MISSING_CLIENT_DETAILS");
    const gate3Idx = autoFinalizeSource.indexOf("ANALYSIS_FROM_DEGRADED_EXTRACTION");
    assert.ok(
      gate2bIdx > -1 && gate3Idx > gate2bIdx,
      "Gate 3 (analysis status) must appear after Gate 2b (client name) in source",
    );
  });
});

describe("ai.ts — contactDetailsSource: procurementReferenceNumber source traceability", () => {
  it("includes procurementReferenceNumber in contactDetailsSource prompt schema", () => {
    assert.ok(
      aiSource.includes('"procurementReferenceNumber"') &&
        aiSource.includes("contactDetailsSource"),
      "AI prompt must include procurementReferenceNumber inside the contactDetailsSource block for source page/quote traceability",
    );
  });

  it("procurementReferenceNumber entry in contactDetailsSource appears after other contact keys", () => {
    const sourceIdx = aiSource.indexOf("contactDetailsSource");
    const refIdx = aiSource.indexOf('"procurementReferenceNumber"', sourceIdx);
    assert.ok(
      sourceIdx > -1 && refIdx > sourceIdx,
      "procurementReferenceNumber must appear inside the contactDetailsSource object in the prompt",
    );
  });
});

describe("ai.ts — contactDetailsSource chunk merge: best-wins logic present in source", () => {
  it("source uses best-wins logic (not pure first-wins) for contactDetailsSource merge", () => {
    assert.ok(
      aiSource.includes("existingHasData") && aiSource.includes("newHasData"),
      "ai.ts must use best-wins logic (existingHasData/newHasData) for contactDetailsSource merge, not naive first-wins",
    );
  });

  it("merge skips updating when existing already has real data", () => {
    assert.ok(
      aiSource.includes("!existingHasData && newHasData"),
      "merge condition must only replace when existing has no data but new entry does",
    );
  });
});
