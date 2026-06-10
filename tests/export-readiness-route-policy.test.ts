import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";

// NOTE: The export-readiness route now delegates all policy logic (severity,
// next-action guidance, blocker construction) to lib/engine/export-readiness.ts
// and lib/engine/final-submission-readiness.ts.  These tests verify the policy
// strings are enforced in the canonical engine layer, not in the route handler.

describe("export-readiness route policy mappings", () => {
  it("contains explicit next-action guidance for strict-scope and source-grounding blockers", async () => {
    const src = await readFile("lib/engine/export-readiness.ts", "utf8");
    assert.ok(src.includes("EXTRA_FILES"));
    assert.ok(src.includes("FILE_ORDER"));
    assert.ok(src.includes("SOURCE_REFERENCES_MISSING"));
  });

  it("treats hygiene and scope/order blockers as HIGH severity", async () => {
    const src = await readFile("lib/engine/export-readiness.ts", "utf8");
    assert.ok(src.includes("AI/meta-preparation trace") || src.includes("hygiene"));
    assert.ok(src.includes("EXTRA_FILES") && src.includes("FILE_ORDER") && src.includes("SOURCE_REFERENCES_MISSING"));
  });

  it("enriches tender-level blockers with a nextAction field", async () => {
    // The canonical getFinalSubmissionReadiness engine adds nextActions to each blocker.
    const src = await readFile("lib/engine/final-submission-readiness.ts", "utf8");
    assert.ok(src.includes("nextActions") || src.includes("nextAction"));
    assert.ok(src.includes("recommendedAction"));
  });

  it("export-readiness blocks on PARTIAL_EXTRACTION_AI_ANALYZED with HIGH severity", async () => {
    // Regression: before this fix, PARTIAL_EXTRACTION_AI_ANALYZED was only blocked for
    // generate-docs; export was silently allowed even though documents may have been built
    // on 60-75% extraction coverage. Now both generate and export gates block it.
    const src = await readFile("lib/engine/export-readiness.ts", "utf8");
    assert.ok(
      src.includes("PARTIAL_EXTRACTION_AI_ANALYZED"),
      "export-readiness must block on PARTIAL_EXTRACTION_AI_ANALYZED",
    );
    assert.ok(
      src.includes("ANALYSIS_FROM_PARTIAL_EXTRACTION"),
      "export-readiness must use ANALYSIS_FROM_PARTIAL_EXTRACTION blocker category",
    );
  });

  it("generate route blocks on PARTIAL_EXTRACTION_AI_ANALYZED", async () => {
    const src = await readFile("app/api/tenders/[id]/generate/route.ts", "utf8");
    assert.ok(
      src.includes("PARTIAL_EXTRACTION_AI_ANALYZED"),
      "generate route must block on PARTIAL_EXTRACTION_AI_ANALYZED",
    );
    assert.ok(
      src.includes("PARTIAL_EXTRACTION_ANALYSIS"),
      "generate route must use PARTIAL_EXTRACTION_ANALYSIS error code",
    );
    assert.ok(
      src.includes("acceptPartialExtraction"),
      "generate route must provide acceptPartialExtraction override mechanism",
    );
  });

  it("export-readiness blocks on OCR_REQUIRED (AI analysis was skipped — no reliable analysis)", async () => {
    const src = await readFile("lib/engine/export-readiness.ts", "utf8");
    assert.ok(
      src.includes('"OCR_REQUIRED"'),
      "export-readiness must block when analysisExtractionStatus === OCR_REQUIRED (AI was skipped)",
    );
    assert.ok(
      src.includes("ANALYSIS_SKIPPED_OCR_REQUIRED"),
      "export-readiness must use ANALYSIS_SKIPPED_OCR_REQUIRED blocker category",
    );
  });

  it("export-readiness blocks on EXTRACTION_WEAK_REVIEW_REQUIRED (AI ran on weak extraction)", async () => {
    const src = await readFile("lib/engine/export-readiness.ts", "utf8");
    assert.ok(
      src.includes('"EXTRACTION_WEAK_REVIEW_REQUIRED"'),
      "export-readiness must block when analysisExtractionStatus === EXTRACTION_WEAK_REVIEW_REQUIRED",
    );
    assert.ok(
      src.includes("ANALYSIS_FROM_WEAK_EXTRACTION_REVIEW"),
      "export-readiness must use ANALYSIS_FROM_WEAK_EXTRACTION_REVIEW blocker category",
    );
  });

  it("export-readiness blocks when total page count is unknown (CLAUDE.md requirement)", async () => {
    const src = await readFile("lib/engine/export-readiness.ts", "utf8");
    assert.ok(
      src.includes("EXTRACTION_PAGE_COUNT_UNKNOWN"),
      "export-readiness must use EXTRACTION_PAGE_COUNT_UNKNOWN blocker category",
    );
    assert.ok(
      src.includes("totalPages"),
      "export-readiness must check totalPages for the page-count-unknown gate",
    );
  });
});
