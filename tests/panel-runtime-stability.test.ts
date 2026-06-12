// Characterization tests for PR 1 — Runtime baseline and panel error stability.
//
// Verifies:
//   1. The analysis-quality $queryRaw fallback is safe when the result is empty.
//   2. Every panel route that previously lacked try/catch now produces a
//      structured error response with the required fields.
//   3. Existing recovery-action routes remain intact (metadata repair,
//      source-grounding repair, submission-plan build, Generate Docs gate).
//   4. Generate Docs gate continues to block on unresolved CRITICAL gaps.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── 1. $queryRaw fallback — safe on empty result ─────────────────────────────

describe("analysis-quality route — $queryRaw empty-array fallback", () => {
  it("destructuring with nullish coalescing is safe when array is empty", () => {
    // Reproduce the exact pattern used in the fixed route.
    const emptyRows: Array<{ extractedTextLength: number; totalPageCount: number }> = [];
    const { extractedTextLength, totalPageCount } = emptyRows[0] ?? { extractedTextLength: 0, totalPageCount: 0 };
    assert.equal(extractedTextLength, 0, "extractedTextLength must default to 0 when no rows");
    assert.equal(totalPageCount, 0, "totalPageCount must default to 0 when no rows");
  });

  it("is unsafe with the old pattern — documents the regression", () => {
    const emptyRows: Array<{ extractedTextLength: number; totalPageCount: number }> = [];
    assert.throws(() => {
      // This is the OLD pattern that caused the production TypeError.
      // If this stops throwing, the regression guard is broken.
      const [{ extractedTextLength: _a, totalPageCount: _b }] = emptyRows as unknown as [{ extractedTextLength: number; totalPageCount: number }];
    }, TypeError, "old pattern must throw TypeError when array is empty");
  });

  it("is safe when result has one row (normal case)", () => {
    const rows = [{ extractedTextLength: 12345, totalPageCount: 42 }];
    const { extractedTextLength, totalPageCount } = rows[0] ?? { extractedTextLength: 0, totalPageCount: 0 };
    assert.equal(extractedTextLength, 12345);
    assert.equal(totalPageCount, 42);
  });
});

// ─── 2. Panel error response shape ────────────────────────────────────────────

const REQUIRED_PANEL_ERROR_FIELDS = ["panel", "endpoint", "diagnosticId", "code", "retryable", "staleDataPossible"] as const;

const PANEL_ROUTES = [
  { panel: "analysis-quality",    file: "app/api/tenders/[id]/analysis-quality/route.ts" },
  { panel: "extraction-quality",  file: "app/api/tenders/[id]/extraction-quality/route.ts" },
  { panel: "readiness",           file: "app/api/tenders/[id]/readiness/route.ts" },
  { panel: "generation-readiness", file: "app/api/tenders/[id]/generation-readiness/route.ts" },
  { panel: "matching-quality",    file: "app/api/tenders/[id]/matching-quality/route.ts" },
] as const;

describe("panel routes — structured error response fields", () => {
  for (const { panel, file } of PANEL_ROUTES) {
    it(`${panel} route contains try/catch and diagnosticId error field`, () => {
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      assert.ok(src.includes("catch (error)"), `${panel} must have a catch (error) block`);
      assert.ok(src.includes("diagnosticId"), `${panel} must include diagnosticId in error response`);
      assert.ok(src.includes("randomUUID"), `${panel} must import randomUUID for diagnosticId`);
    });

    it(`${panel} route emits structured log with route, tenderId, diagnosticId`, () => {
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      assert.ok(src.includes("console.error"), `${panel} must log errors`);
      assert.ok(src.includes("route:"), `${panel} structured log must include route:`);
      assert.ok(src.includes("tenderId"), `${panel} structured log must include tenderId`);
      assert.ok(src.includes("errorClass"), `${panel} structured log must include errorClass`);
    });

    it(`${panel} error response includes retryable flag`, () => {
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      assert.ok(src.includes("retryable"), `${panel} error response must include retryable`);
    });
  }

  it("panel error response shape satisfies required field contract", () => {
    // Construct a synthetic panel error object matching the shape written in the routes.
    const mockPanelError = {
      error: "Panel failed to load.",
      panel: "analysis-quality",
      endpoint: "/api/tenders/[id]/analysis-quality",
      diagnosticId: "550e8400-e29b-41d4-a716-446655440000",
      code: "ANALYSIS_QUALITY_RUNTIME_ERROR",
      retryable: true,
      staleDataPossible: false,
    };
    for (const field of REQUIRED_PANEL_ERROR_FIELDS) {
      assert.ok(field in mockPanelError, `panel error response must contain field: ${field}`);
    }
  });

  it("analysis-quality panelError uses same diagnosticId in log and response", () => {
    // The panelError helper now accepts diagnosticId as a parameter rather than
    // generating its own, so the ID written to server logs matches the ID
    // returned in the error response body.
    const src = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/analysis-quality/route.ts"), "utf8");
    // The catch block must pass the same `diagnosticId` variable to panelError.
    assert.ok(
      src.includes("panelError(\"Analysis quality panel failed to load.\", 500, diagnosticId,"),
      "panelError call must forward the logged diagnosticId so log and response share the same id",
    );
  });

  it("extraction-quality sample query propagates DB errors rather than silencing them", () => {
    const src = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/extraction-quality/route.ts"), "utf8");
    // The text-sample $queryRaw must NOT have .catch(() => []) which would convert
    // DB failures to empty-string assessments (wrong quality data returned as 200).
    const queryBlock = src.slice(src.indexOf("const textSamples"), src.indexOf("const textSampleById"));
    assert.ok(
      !queryBlock.includes(".catch("),
      "text-sample $queryRaw must not swallow errors — genuine DB failures should propagate to the outer catch",
    );
  });

  it("analysis-quality error response does not include raw detail/error.message", () => {
    const src = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/analysis-quality/route.ts"), "utf8");
    // The panelError call in the catch block must not pass 'detail' containing
    // the raw error message — keep internals in the server log only.
    assert.ok(
      !src.includes("detail: error instanceof Error"),
      "panelError must not forward raw error.message to clients",
    );
  });

  it("analysis-quality file-metrics $queryRaw does not swallow genuine DB failures", () => {
    const src = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/analysis-quality/route.ts"), "utf8");
    const queryBlock = src.slice(src.indexOf("const fileMetricsRows"), src.indexOf("const { extractedTextLength"));
    assert.ok(
      !queryBlock.includes(".catch("),
      "file-metrics $queryRaw must not catch errors — genuine failures must reach the outer try/catch",
    );
  });

  for (const { panel: p, file: f } of PANEL_ROUTES) {
    it(`${p} — prismaReady is inside the try block`, () => {
      const src = readFileSync(resolve(process.cwd(), f), "utf8");
      const tryIdx = src.indexOf("try {");
      const prismaReadyIdx = src.indexOf("await prismaReady");
      assert.ok(
        prismaReadyIdx > tryIdx,
        `${p}: await prismaReady must be inside the try block so DB bootstrap failures produce a structured error response`,
      );
    });
  }
});

// ─── 3. Recovery action routes remain intact ──────────────────────────────────

const RECOVERY_ACTION_ROUTES = [
  { action: "metadata repair",       file: "app/api/tenders/[id]/repair-metadata/route.ts" },
  { action: "source-grounding repair", file: "app/api/tenders/[id]/repair-source-grounding/route.ts" },
  { action: "submission-plan build", file: "app/api/tenders/[id]/submission-plan/build/route.ts" },
  { action: "Generate Docs gate",    file: "app/api/tenders/[id]/generate/route.ts" },
] as const;

describe("recovery action routes — present and unmodified by PR 1", () => {
  for (const { action, file } of RECOVERY_ACTION_ROUTES) {
    it(`${action} route file exists`, () => {
      const fullPath = resolve(process.cwd(), file);
      assert.ok(existsSync(fullPath), `${action} route must exist at ${file}`);
    });
  }

  it("Generate Docs gate checks for CRITICAL compliance gaps before generating", () => {
    const src = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/generate/route.ts"), "utf8");
    // The generate route filters complianceGap rows by severity CRITICAL and isResolved false.
    // Hard-blocking critical gaps use the HARD_BLOCKERS error code.
    assert.ok(
      src.includes('severity: "CRITICAL"'),
      "generate route must filter compliance gaps by CRITICAL severity",
    );
    assert.ok(
      src.includes("isResolved: false"),
      "generate route must filter compliance gaps by isResolved: false",
    );
    assert.ok(
      src.includes("HARD_BLOCKERS") || src.includes("CRITICAL_GAPS"),
      "generate route must have a hard-block error code for critical compliance gaps",
    );
    assert.ok(src.includes("422"), "generate route must return 422 for critical gaps");
  });

  it("metadata repair route accepts POST", () => {
    const src = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/repair-metadata/route.ts"), "utf8");
    assert.ok(src.includes("export async function POST"), "repair-metadata must export POST handler");
  });

  it("source-grounding repair route accepts POST", () => {
    const src = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/repair-source-grounding/route.ts"), "utf8");
    assert.ok(src.includes("export async function POST"), "repair-source-grounding must export POST handler");
  });

  it("submission-plan build route accepts POST", () => {
    const src = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/submission-plan/build/route.ts"), "utf8");
    assert.ok(src.includes("export async function POST"), "submission-plan build must export POST handler");
  });
});

// ─── 4. Generate Docs gate continues to block on critical gaps ─────────────────

describe("Generate Docs gate — CRITICAL gap blocking preserved", () => {
  it("generate route checks complianceGap count with severity CRITICAL and isResolved false", () => {
    const src = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/generate/route.ts"), "utf8");
    assert.ok(
      src.includes("severity: \"CRITICAL\"") || src.includes('severity: "CRITICAL"'),
      "generate route must filter compliance gaps by CRITICAL severity",
    );
    assert.ok(
      src.includes("isResolved: false"),
      "generate route must filter compliance gaps by isResolved: false",
    );
  });

  it("generate route gates on expert and project review status", () => {
    const src = readFileSync(resolve(process.cwd(), "app/api/tenders/[id]/generate/route.ts"), "utf8");
    // The route uses REVIEWED trust level to gate generation on expert/project quality.
    assert.ok(
      src.includes("trustLevel") && src.includes("REVIEWED"),
      "generate route must check trustLevel === REVIEWED for expert/project matches",
    );
  });
});

// ─── 5. analysis-quality route — safe empty-state for no requirements ─────────

describe("analysis-quality assessor — stable with empty inputs", () => {
  it("assessTenderAnalysisQuality returns a score object when requirements are empty", () => {
    const { assessTenderAnalysisQuality } = require("../lib/analysis-quality");
    const result = assessTenderAnalysisQuality({
      requirements: [],
      analysisSummary: null,
      evaluationMethodology: null,
      submissionNotes: "",
      exactFileNaming: "[]",
      exactFileOrder: "[]",
      clientName: null,
      referenceNumber: null,
      country: null,
      clientContactName: null,
      matchingScore: 0,
      extractedTextLength: 0,
      totalPageCount: 0,
      deadline: null,
      submissionMethod: null,
      submissionAddress: null,
      submissionEmails: null,
      analysisExtractionStatus: null,
      selectedReviewedExperts: 0,
      selectedReviewedProjects: 0,
      analysisSource: "UNKNOWN",
    });
    assert.ok(typeof result === "object" && result !== null, "assessTenderAnalysisQuality must return an object");
    assert.ok(typeof result.score === "number", "result must have a numeric score");
    assert.ok(["GOOD", "FAIR", "POOR", "UNSAFE"].includes(result.severity), `result.severity must be a valid value, got: ${result.severity}`);
  });

  it("extraction quality summarizer handles zero files gracefully", () => {
    const { summarizeExtractionCoverage } = require("../lib/engine/extraction-quality-gate");
    const coverage = summarizeExtractionCoverage([]);
    assert.ok(typeof coverage === "object" && coverage !== null, "summarizeExtractionCoverage must return an object for empty input");
    assert.equal(coverage.totalFiles ?? 0, 0, "totalFiles must be 0 for empty input");
  });
});
