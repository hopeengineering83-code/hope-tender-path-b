// Phase 19: Regression guard tests for AI-tool engine module contracts.
// Cherry-picked from PR #665 with fixes: removed hallucinated function names
// (isDocumentExportable) and verified against actual exports.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("export-readiness module contract guards", () => {
  it("exports checkExportReadiness function", () => {
    const src = readFileSync("lib/engine/export-readiness.ts", "utf8");
    assert.ok(src.includes("export function checkExportReadiness"), "checkExportReadiness must be exported");
  });

  it("exports checkFullExportReadiness function", () => {
    const src = readFileSync("lib/engine/export-readiness.ts", "utf8");
    assert.ok(src.includes("export async function checkFullExportReadiness"), "checkFullExportReadiness must be exported");
  });

  it("exports isReadyForFinalExport function", () => {
    const src = readFileSync("lib/engine/export-readiness.ts", "utf8");
    assert.ok(src.includes("export function isReadyForFinalExport"), "isReadyForFinalExport must be exported");
  });

  it("exports exportReadinessError function", () => {
    const src = readFileSync("lib/engine/export-readiness.ts", "utf8");
    assert.ok(src.includes("export function exportReadinessError"), "exportReadinessError must be exported");
  });

  it("ExportReadyDocument type has generationStatus field", () => {
    const src = readFileSync("lib/engine/export-readiness.ts", "utf8");
    assert.ok(src.includes("generationStatus"), "ExportReadyDocument must include generationStatus");
  });
});

describe("document-quality-validator module contract guards", () => {
  it("exports validateDocumentQuality function", () => {
    const src = readFileSync("lib/engine/document-quality-validator.ts", "utf8");
    assert.ok(src.includes("export function validateDocumentQuality"), "validateDocumentQuality must be exported");
  });

  it("DocumentValidationResult includes boilerplateHits field", () => {
    const src = readFileSync("lib/engine/document-quality-validator.ts", "utf8");
    assert.ok(src.includes("boilerplateHits"), "DocumentValidationResult must include boilerplateHits field");
  });

  it("validateDocumentQuality uses GENERIC_BOILERPLATE_PATTERNS", () => {
    const src = readFileSync("lib/engine/document-quality-validator.ts", "utf8");
    assert.ok(src.includes("GENERIC_BOILERPLATE_PATTERNS"), "validator must check boilerplate patterns");
  });

  it("validator blocks at boilerplateHits >= 5", () => {
    const src = readFileSync("lib/engine/document-quality-validator.ts", "utf8");
    assert.ok(src.includes("boilerplateHits.length >= 5"), "validator must block when >= 5 boilerplate hits");
  });

  it("validator warns at boilerplateHits >= 3", () => {
    const src = readFileSync("lib/engine/document-quality-validator.ts", "utf8");
    assert.ok(src.includes("boilerplateHits.length >= 3"), "validator must warn when >= 3 boilerplate hits");
  });
});

describe("authority-review module contract guards", () => {
  it("exports runAuthorityReview function", () => {
    const src = readFileSync("lib/engine/authority-review.ts", "utf8");
    assert.ok(src.includes("export function runAuthorityReview"), "runAuthorityReview must be exported");
  });

  it("uses shared AI_TRACE_PATTERNS from detection-patterns", () => {
    const src = readFileSync("lib/engine/authority-review.ts", "utf8");
    assert.ok(src.includes("AI_TRACE_PATTERNS"), "authority-review must use shared AI_TRACE_PATTERNS");
  });

  it("uses shared PLACEHOLDER_PATTERNS from detection-patterns", () => {
    const src = readFileSync("lib/engine/authority-review.ts", "utf8");
    assert.ok(src.includes("PLACEHOLDER_PATTERNS"), "authority-review must use shared PLACEHOLDER_PATTERNS");
  });

  it("imports from detection-patterns", () => {
    const src = readFileSync("lib/engine/authority-review.ts", "utf8");
    assert.ok(src.includes("from \"./detection-patterns\""), "authority-review must import from detection-patterns");
  });

  it("AUTHORITY_READY status is the positive gate for export", () => {
    const src = readFileSync("app/api/tenders/[id]/export/route.ts", "utf8");
    assert.ok(src.includes("AUTHORITY_READY"), "export route must check for AUTHORITY_READY status");
  });
});

describe("detection-patterns module completeness guards", () => {
  it("PLACEHOLDER_PATTERNS includes lorem ipsum", () => {
    const src = readFileSync("lib/engine/detection-patterns.ts", "utf8");
    assert.ok(src.includes("lorem") && src.includes("ipsum"), "PLACEHOLDER_PATTERNS must include lorem ipsum");
  });

  it("AI_TRACE_PATTERNS includes anthropic", () => {
    const src = readFileSync("lib/engine/detection-patterns.ts", "utf8");
    assert.ok(src.includes("anthropic"), "AI_TRACE_PATTERNS must flag anthropic branding");
  });

  it("AI_TRACE_PATTERNS includes gemini", () => {
    const src = readFileSync("lib/engine/detection-patterns.ts", "utf8");
    assert.ok(src.includes("gemini"), "AI_TRACE_PATTERNS must flag gemini branding");
  });

  it("GENERIC_BOILERPLATE_PATTERNS is exported", () => {
    const src = readFileSync("lib/engine/detection-patterns.ts", "utf8");
    assert.ok(src.includes("export const GENERIC_BOILERPLATE_PATTERNS"), "GENERIC_BOILERPLATE_PATTERNS must be exported");
  });

  it("GENERIC_BOILERPLATE_PATTERNS has at least 10 entries", () => {
    const { GENERIC_BOILERPLATE_PATTERNS } = require("../lib/engine/quality/detection-patterns");
    assert.ok(
      Array.isArray(GENERIC_BOILERPLATE_PATTERNS) && GENERIC_BOILERPLATE_PATTERNS.length >= 10,
      `GENERIC_BOILERPLATE_PATTERNS should have at least 10 patterns, got ${GENERIC_BOILERPLATE_PATTERNS?.length ?? 0}`,
    );
  });
});

describe("export and download route authority code consistency", () => {
  it("export route uses AUTHORITY_REVIEW_BLOCKED error code", () => {
    const src = readFileSync("app/api/tenders/[id]/export/route.ts", "utf8");
    assert.ok(src.includes("AUTHORITY_REVIEW_BLOCKED"), "export route must use AUTHORITY_REVIEW_BLOCKED");
    assert.ok(!src.includes("AUTHORITY_REVIEW_NOT_READY"), "export route must not use deprecated AUTHORITY_REVIEW_NOT_READY code");
  });

  it("download route uses AUTHORITY_REVIEW_BLOCKED error code for single-doc", () => {
    const src = readFileSync("app/api/tenders/[id]/download/route.ts", "utf8");
    assert.ok(src.includes("AUTHORITY_REVIEW_BLOCKED"), "download route must use AUTHORITY_REVIEW_BLOCKED");
  });

  it("download route single-doc blocks on NEEDS_REVIEW (not just BLOCKED)", () => {
    const src = readFileSync("app/api/tenders/[id]/download/route.ts", "utf8");
    assert.ok(
      src.includes("!== \"AUTHORITY_READY\""),
      "single-doc download must block on NEEDS_REVIEW status, not just BLOCKED",
    );
  });
});
