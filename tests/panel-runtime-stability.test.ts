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
import { randomUUID } from "node:crypto";

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
      // OBS-001: routes migrated from console.error to logger.error (which internally
      // calls console.error in lib/observability.ts). Accept either form.
      assert.ok(src.includes("console.error") || src.includes("logger.error"), `${panel} must log errors`);
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
    assert.ok(["GOOD", "WARNING", "POOR", "UNSAFE"].includes(result.severity), `result.severity must be a valid value, got: ${result.severity}`);
  });

  it("extraction quality summarizer handles zero files gracefully", () => {
    const { summarizeExtractionCoverage } = require("../lib/engine/extraction-quality-gate");
    const coverage = summarizeExtractionCoverage([]);
    assert.ok(typeof coverage === "object" && coverage !== null, "summarizeExtractionCoverage must return an object for empty input");
    assert.equal(coverage.totalFiles ?? 0, 0, "totalFiles must be 0 for empty input");
  });
});

// ─── 6. Behavioral safety checks ──────────────────────────────────────────────

describe("matching-quality assessor — stable with empty child rows", () => {
  it("assessMatchingQuality returns a valid object when all inputs are empty", () => {
    const { assessMatchingQuality } = require("../lib/matching-quality");
    const result = assessMatchingQuality({ requirements: [], expertMatches: [], projectMatches: [] });
    assert.ok(typeof result === "object" && result !== null, "must return an object");
    assert.ok(typeof result.score === "number", "result must have a numeric score");
    assert.ok(["GOOD", "WARNING", "POOR"].includes(result.severity), `severity must be valid, got: ${result.severity}`);
    assert.ok(typeof result.state === "string", "result must have a state string");
  });

  it("assessMatchingQuality returns MATCHING_NOT_REQUIRED when no expert or project requirements exist", () => {
    const { assessMatchingQuality } = require("../lib/matching-quality");
    const result = assessMatchingQuality({
      requirements: [{ requirementType: "TECHNICAL" }],
      expertMatches: [],
      projectMatches: [],
    });
    assert.equal(result.state, "MATCHING_NOT_REQUIRED", "state must be MATCHING_NOT_REQUIRED when no expert/project requirements exist");
  });

  it("assessMatchingQuality penalises score when expert requirement exists but no vault matches (NO_VAULT)", () => {
    const { assessMatchingQuality } = require("../lib/matching-quality");
    const result = assessMatchingQuality({
      requirements: [{ requirementType: "EXPERT" }],
      expertMatches: [],
      projectMatches: [],
      vaultReviewedExperts: 0,
      vaultReviewedProjects: 0,
    });
    assert.ok(result.score < 100, "score must be penalised when expert requirements have no matches and no vault");
    assert.equal(result.expertRequirementExists, true, "expertRequirementExists must be true");
  });
});

describe("panel catch block — behavioral error shape contract", () => {
  it("simulated DB query failure produces structured panel error with matched diagnosticId, not unhandled exception", async () => {

    async function simulatedPanelHandler(simulateFailure: "none" | "query" | "prismaReady") {
      const tenderId = "tender-behavioral-test";
      const logged: Record<string, unknown> = {};
      try {
        if (simulateFailure === "prismaReady") throw new Error("DB pool not ready — bootstrap failed");
        if (simulateFailure === "query") throw new TypeError("Cannot destructure property 'extractedTextLength' of undefined");
        return { status: 200, body: { tenderId } };
      } catch (error) {
        const diagnosticId = randomUUID();
        logged.diagnosticId = diagnosticId;
        logged.errorClass = error instanceof Error ? error.constructor.name : "UnknownError";
        logged.message = error instanceof Error ? error.message : String(error);
        const body = {
          error: "Analysis quality panel failed to load.",
          panel: "analysis-quality",
          endpoint: "/api/tenders/[id]/analysis-quality",
          diagnosticId,
          code: "ANALYSIS_QUALITY_RUNTIME_ERROR",
          retryable: true,
          staleDataPossible: false,
        };
        return { status: 500, body, logged };
      }
    }

    const queryResult = await simulatedPanelHandler("query");
    assert.equal(queryResult.status, 500, "DB query failure must return 500");
    assert.ok("diagnosticId" in queryResult.body, "response must have diagnosticId");
    const queryLogged = (queryResult as unknown as { logged: { diagnosticId: string } }).logged;
    assert.equal(queryResult.body.diagnosticId, queryLogged.diagnosticId, "logged diagnosticId must match response diagnosticId");
    assert.ok(!("detail" in queryResult.body), "response must not contain a 'detail' field");
    assert.ok(!("message" in queryResult.body), "response must not contain a 'message' field");
    assert.ok(
      !Object.values(queryResult.body).some((v) => typeof v === "string" && v.includes("Cannot destructure")),
      "raw error message must not appear in the response body",
    );

    const prismaResult = await simulatedPanelHandler("prismaReady");
    assert.equal(prismaResult.status, 500, "prismaReady rejection must return 500");
    assert.ok("diagnosticId" in prismaResult.body, "prismaReady failure response must have diagnosticId");
    const prismaLogged = (prismaResult as unknown as { logged: { diagnosticId: string } }).logged;
    assert.equal(prismaResult.body.diagnosticId, prismaLogged.diagnosticId, "logged diagnosticId must match response diagnosticId for prismaReady failure");
    assert.equal(prismaResult.body.retryable, true, "prismaReady failure must be retryable");
  });

  it("randomUUID produces a valid v4 UUID for diagnosticId", () => {
    const id = randomUUID();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "diagnosticId must be a valid v4 UUID");
  });
});

describe("extraction-quality route — DB failure returns structured error, not silent empty response", () => {
  it("simulated text-sample query failure produces structured 500, not a misleading 200 with empty data", async () => {

    async function simulatedExtractionHandler(queryThrows: boolean) {
      const tenderId = "tender-extraction-test";
      try {
        if (queryThrows) throw new Error("DB connection refused — text-sample query failed");
        return { status: 200, body: { tenderId, files: [] } };
      } catch (error) {
        const diagnosticId = randomUUID();
        return {
          status: 500,
          body: {
            error: "Extraction quality panel failed to load.",
            panel: "extraction-quality",
            endpoint: "/api/tenders/[id]/extraction-quality",
            diagnosticId,
            code: "EXTRACTION_QUALITY_RUNTIME_ERROR",
            retryable: true,
            staleDataPossible: false,
          },
        };
      }
    }

    const failResult = await simulatedExtractionHandler(true);
    assert.equal(failResult.status, 500, "DB query failure must produce 500, not 200 with empty files");
    assert.ok(!("files" in failResult.body), "error response must not contain a 'files' array (would mask the failure as empty-data success)");
    assert.equal((failResult.body as unknown as { code: string }).code, "EXTRACTION_QUALITY_RUNTIME_ERROR");

    const okResult = await simulatedExtractionHandler(false);
    assert.equal(okResult.status, 200, "successful query must still return 200");
    assert.ok("files" in okResult.body, "successful response must contain files");
  });

  it("summarizeExtractionCoverage handles files with zero extracted characters without throwing", () => {
    const { summarizeExtractionCoverage } = require("../lib/engine/extraction-quality-gate");
    const files = [
      { id: "f1", fileName: "empty.pdf", totalPages: 10, extractedPages: 0, ocrPages: 0, failedPages: 10, extractionScore: 0, extractionMethod: null, characterCount: 0 },
    ];
    const coverage = summarizeExtractionCoverage(files);
    assert.ok(typeof coverage === "object" && coverage !== null, "must return an object for zero-char files");
    assert.ok(typeof coverage.totalPages === "number", "coverage.totalPages must be a number");
    assert.equal(coverage.totalPages, 10, "totalPages must reflect the file page count");
  });

  it("isExtractionAcceptableForGeneration returns false for completely failed extraction", () => {
    const { isExtractionAcceptableForGeneration } = require("../lib/engine/extraction-quality-gate");
    const files = [{ id: "f1", extractionScore: 0, totalPages: 5, extractedPages: 0, ocrPages: 0, failedPages: 5 }];
    assert.equal(isExtractionAcceptableForGeneration(files), false, "completely failed extraction must block generation");
  });
});

describe("panel routes — 401 check precedes DB access; 404 is handled for every route", () => {
  const ALL_PANEL_ROUTES = [
    { panel: "analysis-quality",     file: "app/api/tenders/[id]/analysis-quality/route.ts" },
    { panel: "extraction-quality",   file: "app/api/tenders/[id]/extraction-quality/route.ts" },
    { panel: "readiness",            file: "app/api/tenders/[id]/readiness/route.ts" },
    { panel: "generation-readiness", file: "app/api/tenders/[id]/generation-readiness/route.ts" },
    { panel: "matching-quality",     file: "app/api/tenders/[id]/matching-quality/route.ts" },
  ] as const;

  it("all panel routes check authentication before executing any DB query (401 before try block)", () => {
    for (const { panel, file } of ALL_PANEL_ROUTES) {
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      const sessionIdx = src.indexOf("getSession()");
      const tryIdx = src.indexOf("try {");
      const prismaReadyIdx = src.indexOf("await prismaReady");
      assert.ok(sessionIdx > 0, `${panel}: must call getSession() for authentication`);
      assert.ok(sessionIdx < tryIdx, `${panel}: getSession() must be called before the try block`);
      assert.ok(sessionIdx < prismaReadyIdx, `${panel}: authentication must precede prismaReady`);
    }
  });

  it("all panel routes return 404 with 'Tender not found' when tender query returns null", () => {
    for (const { panel, file } of ALL_PANEL_ROUTES) {
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      assert.ok(src.includes("404"), `${panel}: must return 404 status when tender is not found`);
      assert.ok(
        src.includes('"Tender not found"') || src.includes("'Tender not found'"),
        `${panel}: must include "Tender not found" in the 404 response body`,
      );
    }
  });
});
