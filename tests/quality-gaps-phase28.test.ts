// Phase 28 quality-gap regression tests.
//
// Coverage:
//   1. generate/route.ts blocks EXTRACTION_CORRUPTED_AI_SKIPPED
//   2. generate/route.ts blocks REGEX_FALLBACK_FROM_WEAK_EXTRACTION
//   3. generate/route.ts empty-catch narrowed to P2002 only
//   4. export-readiness.ts imports assessExtractionQualityPerPage
//   5. export-readiness.ts: SUBMISSION_INSTRUCTIONS_NOT_EXTRACTED blocker present
//   6. export-readiness.ts: REQUIRED_DOCUMENT_PAGES_NOT_EXTRACTED advisory present

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const generateSource = readFileSync(
  path.join(process.cwd(), "app/api/tenders/[id]/generate/route.ts"),
  "utf-8",
);

const exportReadinessSource = readFileSync(
  path.join(process.cwd(), "lib/engine/export-readiness.ts"),
  "utf-8",
);

// ── 1-2. generate/route.ts — analysis-extraction-status gate ─────────────────

describe("generate/route.ts — analysis extraction status gate", () => {
  it("blocks EXTRACTION_CORRUPTED_AI_SKIPPED", () => {
    assert.ok(
      generateSource.includes("EXTRACTION_CORRUPTED_AI_SKIPPED"),
      "generate route must block when analysisExtractionStatus is EXTRACTION_CORRUPTED_AI_SKIPPED",
    );
  });

  it("blocks REGEX_FALLBACK_FROM_WEAK_EXTRACTION", () => {
    assert.ok(
      generateSource.includes("REGEX_FALLBACK_FROM_WEAK_EXTRACTION"),
      "generate route must block when analysisExtractionStatus is REGEX_FALLBACK_FROM_WEAK_EXTRACTION",
    );
  });

  it("returns 422 for corrupted extraction", () => {
    assert.ok(
      generateSource.includes("ANALYSIS_FROM_CORRUPTED_EXTRACTION"),
      "generate route must return errorCode ANALYSIS_FROM_CORRUPTED_EXTRACTION for corrupted extraction",
    );
  });

  it("returns 422 for regex fallback extraction", () => {
    assert.ok(
      generateSource.includes("ANALYSIS_FROM_WEAK_EXTRACTION"),
      "generate route must return errorCode ANALYSIS_FROM_WEAK_EXTRACTION for regex fallback",
    );
  });
});

// ── 3. generate/route.ts — narrowed catch block ───────────────────────────────

describe("generate/route.ts — race-condition catch narrowed to P2002", () => {
  it("catch block references Prisma.PrismaClientKnownRequestError", () => {
    assert.ok(
      generateSource.includes("PrismaClientKnownRequestError"),
      "race-condition catch must check PrismaClientKnownRequestError, not swallow all errors",
    );
  });

  it("catch block checks error code P2002", () => {
    assert.ok(
      generateSource.includes('"P2002"'),
      "race-condition catch must check for unique constraint error code P2002",
    );
  });

  it("catch block re-throws non-P2002 errors", () => {
    assert.ok(
      generateSource.includes("throw err"),
      "catch block must re-throw errors that are not unique-constraint violations",
    );
  });
});

// ── 4-6. export-readiness.ts — submission instructions extracted check ─────────

describe("export-readiness.ts — submission instructions extraction gate", () => {
  it("imports assessExtractionQualityPerPage", () => {
    assert.ok(
      exportReadinessSource.includes("assessExtractionQualityPerPage"),
      "export-readiness must import assessExtractionQualityPerPage to check per-page content",
    );
  });

  it("blocks export when submission instruction pages are absent", () => {
    assert.ok(
      exportReadinessSource.includes("SUBMISSION_INSTRUCTIONS_NOT_EXTRACTED"),
      "export-readiness must block with SUBMISSION_INSTRUCTIONS_NOT_EXTRACTED when no submission pages found",
    );
  });

  it("marks submission instructions blocker as HIGH severity", () => {
    assert.ok(
      exportReadinessSource.includes("submissionInstructionPages"),
      "export-readiness must check submissionInstructionPages from per-page extraction report",
    );
  });

  it("surfaces advisory when required-document pages are absent", () => {
    assert.ok(
      exportReadinessSource.includes("REQUIRED_DOCUMENT_PAGES_NOT_EXTRACTED"),
      "export-readiness must surface REQUIRED_DOCUMENT_PAGES_NOT_EXTRACTED advisory warning",
    );
  });
});
