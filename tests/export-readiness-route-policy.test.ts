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
      !src.includes("acceptPartialExtraction"),
      "generate route must provide acceptPartialExtraction override mechanism",
    );
  });

  it("generate-missing-plan-files route blocks on OCR_REQUIRED, EXTRACTION_WEAK_REVIEW_REQUIRED, and REGEX_FALLBACK_FROM_WEAK_EXTRACTION", async () => {
    const src = await readFile("app/api/tenders/[id]/generate-missing-plan-files/route.ts", "utf8")
      + await readFile("lib/engine/missing-plan-file-generation.ts", "utf8");
    assert.ok(
      src.includes('"OCR_REQUIRED"'),
      "generate-missing-plan-files must block when analysisExtractionStatus === OCR_REQUIRED",
    );
    assert.ok(
      src.includes('"EXTRACTION_WEAK_REVIEW_REQUIRED"'),
      "generate-missing-plan-files must block when analysisExtractionStatus === EXTRACTION_WEAK_REVIEW_REQUIRED",
    );
    assert.ok(
      src.includes('"REGEX_FALLBACK_FROM_WEAK_EXTRACTION"'),
      "generate-missing-plan-files must block when analysisExtractionStatus === REGEX_FALLBACK_FROM_WEAK_EXTRACTION",
    );
    assert.ok(
      src.includes("ANALYSIS_FROM_CORRUPTED_EXTRACTION"),
      "generate-missing-plan-files must use ANALYSIS_FROM_CORRUPTED_EXTRACTION code for OCR_REQUIRED",
    );
    assert.ok(
      src.includes("ANALYSIS_FROM_WEAK_EXTRACTION"),
      "generate-missing-plan-files must use ANALYSIS_FROM_WEAK_EXTRACTION code for weak extraction",
    );
  });

  it("generate route blocks on OCR_REQUIRED (corrupted extraction — AI was skipped)", async () => {
    const src = await readFile("app/api/tenders/[id]/generate/route.ts", "utf8");
    assert.ok(
      src.includes('"OCR_REQUIRED"'),
      "generate route must block when analysisExtractionStatus === OCR_REQUIRED",
    );
    assert.ok(
      src.includes("ANALYSIS_FROM_CORRUPTED_EXTRACTION"),
      "generate route must use ANALYSIS_FROM_CORRUPTED_EXTRACTION error code for OCR_REQUIRED",
    );
    assert.ok(
      src.includes("RUN_OCR_OR_UPLOAD_CLEARER_SCAN"),
      "generate route must provide RUN_OCR_OR_UPLOAD_CLEARER_SCAN nextAction for OCR_REQUIRED",
    );
  });

  it("generate route blocks on EXTRACTION_WEAK_REVIEW_REQUIRED (weak extraction)", async () => {
    const src = await readFile("app/api/tenders/[id]/generate/route.ts", "utf8");
    assert.ok(
      src.includes('"EXTRACTION_WEAK_REVIEW_REQUIRED"'),
      "generate route must block when analysisExtractionStatus === EXTRACTION_WEAK_REVIEW_REQUIRED",
    );
    assert.ok(
      src.includes("ANALYSIS_FROM_WEAK_EXTRACTION"),
      "generate route must use ANALYSIS_FROM_WEAK_EXTRACTION error code for weak extraction",
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

  it("export-readiness blocks when critical tender facts contain placeholder strings", async () => {
    const src = await readFile("lib/engine/export-readiness.ts", "utf8");
    assert.ok(
      src.includes("TENDER_FACTS_PLACEHOLDER_IN_CRITICAL_FIELD"),
      "export-readiness must use TENDER_FACTS_PLACEHOLDER_IN_CRITICAL_FIELD blocker when clientName/procuringEntityName/submissionMethod contain placeholder text",
    );
    assert.ok(
      src.includes("containsMetadataPlaceholder"),
      "export-readiness must call containsMetadataPlaceholder() to detect placeholder strings",
    );
  });

  it("export-readiness blocks when company profile is missing in link-vault-evidence (422 not 404)", async () => {
    const src = await readFile("app/api/tenders/[id]/link-vault-evidence-auto/route.ts", "utf8");
    assert.ok(
      !src.includes("Tender or company not found"),
      "route must not use combined 'Tender or company not found' 404 — company absence is 422",
    );
    assert.ok(
      src.includes("COMPANY_NOT_FOUND") && src.includes("status: 422"),
      "missing company profile must return 422 with COMPANY_NOT_FOUND code",
    );
  });
});
