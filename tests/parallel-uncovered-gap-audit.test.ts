// Lane B — regression tests for parallel-uncovered-gap-audit fixes.
//
// Each test proves a specific fix and would fail if the fix were reverted.
// Tests are source-text + behavioral assertions so they run without a database.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── P1-2: observability Error normalization ───────────────────────────────

describe("P1-2 — observability normalizes Error objects for JSON.stringify", () => {
  it("emit() calls normalizeForJson before JSON.stringify", () => {
    const src = read("lib/observability.ts");
    assert.match(src, /function normalizeForJson/, "must have normalizeForJson helper");
    assert.match(src, /normalizeForJson\(context\) as LogContext/, "emit must call normalizeForJson on context");
  });

  it("normalizeForJson extracts Error message, name, stack, code, meta", () => {
    const src = read("lib/observability.ts");
    assert.match(src, /name: value\.name/);
    assert.match(src, /message: value\.message/);
    assert.match(src, /obj\.stack = value\.stack/);
    assert.match(src, /prismaErr\.code/);
    assert.match(src, /prismaErr\.meta/);
  });

  it("normalizeForJson guards against circular references", () => {
    const src = read("lib/observability.ts");
    assert.match(src, /if \(seen\.has\(value\)\) return "\[Circular\]"/);
  });
});

// ─── P1-7: liveness returns 200 for degraded (not 503) ─────────────────────

describe("P1-7 — liveness returns HTTP 200 for degraded status", () => {
  it("decides the HTTP status from database usability, never from ok", () => {
    const src = read("lib/liveness.ts");
    // The invariant, not one spelling of it. The old code used `ok ? 200 : 503`
    // and so returned 503 whenever an OPTIONAL subsystem (an AI provider, file
    // storage) was unconfigured, even though pages served fine. What decides
    // the status must be database facts only.
    //
    // "Database usable" later grew a second term — whether the deployed Prisma
    // client can actually query the database, not merely whether its tables
    // exist — after a live deployment answered 200/"healthy" on a database
    // that rejected every sign-in. That term belongs here; AI and storage
    // still do not.
    const httpStatusExpr = /const httpStatus = ([^;]+);/.exec(src)?.[1] ?? "";
    assert.ok(httpStatusExpr.length > 0, "httpStatus must be computed in one place");
    assert.doesNotMatch(httpStatusExpr, /\bok\b/, "degraded must still return 200");
    for (const optional of ["aiHealth", "storageHealth"]) {
      assert.ok(
        !httpStatusExpr.includes(optional),
        `${optional} is an optional subsystem and must not decide the HTTP status (got: ${httpStatusExpr})`,
      );
    }
    assert.match(httpStatusExpr, /allCriticalTablesExist|databaseUsable/);
    assert.doesNotMatch(src, /status: ok \? 200 : 503/);
  });
});

// ─── P1-3: actionable-engine-error does NOT leak raw error.message ─────────

describe("P1-3 — actionable-engine-error sanitizes detail field", () => {
  it("does NOT set detail: message in any branch", () => {
    const src = read("lib/engine/actionable-engine-error.ts");
    // Strip comments so the check only applies to real code.
    const codeOnly = src.replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(codeOnly, /detail:\s*message/);
  });

  it("does NOT use withDetail (which appended raw message to summary)", () => {
    const src = read("lib/engine/actionable-engine-error.ts");
    const codeOnly = src.replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(codeOnly, /withDetail/);
  });

  it("the hint does NOT claim raw error is included", () => {
    const src = read("lib/engine/actionable-engine-error.ts");
    assert.doesNotMatch(src, /original server error is included in detail/);
  });
});

// ─── P1-4: structured-generation-error does NOT leak raw error.message ─────

describe("P1-4 — structured-generation-error sanitizes blockerSummary + message", () => {
  it("does NOT set blockerSummary: raw.slice in any branch", () => {
    const src = read("lib/engine/structured-generation-error.ts");
    const codeOnly = src.replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(codeOnly, /blockerSummary:\s*raw\.slice/);
  });

  it("the generic fallback does NOT set message: raw.slice", () => {
    const src = read("lib/engine/structured-generation-error.ts");
    const codeOnly = src.replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(codeOnly, /message:\s*raw\.length\s*>\s*0\s*\?\s*raw\.slice/);
    assert.match(codeOnly, /message:\s*"Document generation failed\."/);
  });
});

// ─── P1-6: contentChangedHardBlock no longer has the dead !latestJob conjunct ──

describe("P1-6 — contentChangedHardBlock is no longer always false", () => {
  it("does NOT include the structurally-impossible !latestJob conjunct", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    assert.doesNotMatch(src, /contentChangedHardBlock = hashMismatch && !hasGoodAnalysisForCurrentSource && !latestJob/);
  });

  it("uses the correct expression: hashMismatch && !hasGoodAnalysisForCurrentSource", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    assert.match(src, /contentChangedHardBlock = hashMismatch && !hasGoodAnalysisForCurrentSource/);
  });
});

// ─── P0-1: the workflow idempotencyKey is deterministic ────────────────────
//
// Retargeted from lib/engine/tender-operation-lock.ts, which was deleted: it
// had no production importer, so a deterministic key in it protected nothing.
// The live key is derived in lib/engine/tender-workflow-runner.ts.

describe("P0-1 — workflow idempotencyKey is deterministic", () => {
  const src = read("lib/engine/tender-workflow-runner.ts");
  // Strip comments so the check only applies to real code.
  const codeOnly = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  it("does NOT derive the idempotencyKey from wall-clock time", () => {
    assert.doesNotMatch(codeOnly, /idempotencyKey[^\n]*Date\.now\(\)/);
    assert.doesNotMatch(codeOnly, /idempotencyKey[^\n]*randomUUID/);
  });

  it("derives it by stable hash of tenant, tender, operation and request", () => {
    assert.match(src, /export function deriveIdempotencyKey/);
    assert.match(src, /computeStableHash\(\{[\s\S]*?tenantId[\s\S]*?tenderId[\s\S]*?operation/);
  });
});

// ─── P1-8: check-critical-schema includes the 10+ missing tables ───────────

describe("P1-8 — check-critical-schema includes critical tables", () => {
  const requiredNewTables = [
    "Session",
    "BuildPlan",
    "TenderMetadataOverride",
    "FallbackApprovalRecord",
    "TenderWorkflowRun",
    "TenderFactsLedger",
    "AiAnalyzeChunk",
    "AiAnalyzeRetryState",
    "ExtractionQualityOverride",
    "AiUsageRecord",
    "TenderShare",
    "ProviderHealthSnapshot",
  ];

  for (const table of requiredNewTables) {
    it(`REQUIRED_TABLES includes ${table}`, () => {
      const src = read("scripts/critical-schema-contract.mjs");
      assert.match(src, new RegExp(`"${table}"`), `REQUIRED_TABLES must include ${table}`);
    });
  }
});

// ─── P1-9: audit-safe-api-errors scans lib/ (not just app/api) ─────────────

describe("P1-9 — audit-safe-api-errors scans lib/ files", () => {
  it("the git ls-files command includes lib/engine and other lib/ paths", () => {
    const src = read("scripts/audit-safe-api-errors.mjs");
    assert.match(src, /ls-files.*lib\/engine/);
    assert.match(src, /lib\/secure-password-reset\.ts/);
    assert.match(src, /lib\/liveness\.ts/);
  });

  it("does NOT filter to route.ts only (accepts all .ts files)", () => {
    const src = read("scripts/audit-safe-api-errors.mjs");
    // The old filter was .filter(file => file.endsWith("route.ts"))
    // The new filter accepts all .ts files (excluding .test.ts and .d.ts)
    assert.doesNotMatch(src, /\.filter\(\(file\)\s*=>\s*file\.endsWith\("route\.ts"\)\)/);
    assert.match(src, /\.endsWith\("\.ts"\)/);
  });
});

// ─── P1-10: TENDER_ENGINE_DOCUMENTS_SUPERSEDED audit inside transaction ────

describe("P1-10 — supersede audit is inside the transaction", () => {
  it("writeEngineRunAudit accepts an optional tx parameter", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    assert.match(src, /tx\?\s*:\s*\{\s*auditLog/, "writeEngineRunAudit must accept tx");
    assert.match(src, /if \(args\.tx\)/, "must branch on tx presence");
  });

  it("the TENDER_ENGINE_DOCUMENTS_SUPERSEDED audit is NOT called before the transaction", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    // The old code called writeEngineRunAudit with action TENDER_ENGINE_DOCUMENTS_SUPERSEDED
    // before the transaction. The new code calls it inside the transaction (after updateMany).
    // Find the transaction start and the audit call — the audit must be AFTER the tx starts.
    const txStart = src.indexOf("await prisma.$transaction(async (tx) => {");
    assert.ok(txStart > -1, "transaction must exist");
    const supersedeAudit = src.indexOf('"TENDER_ENGINE_DOCUMENTS_SUPERSEDED"', txStart);
    assert.ok(supersedeAudit > -1, "supersede audit must be inside the transaction");
    // The audit must come after the updateMany supersede call inside the tx.
    const updateManyIdx = src.indexOf("tx.generatedDocument.updateMany", txStart);
    assert.ok(updateManyIdx > -1 && supersedeAudit > updateManyIdx, "audit must be after the supersede updateMany inside the tx");
  });

  it("the audit call passes tx as the transaction client", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    // Slice the region around the supersede audit inside the transaction.
    const txStart = src.indexOf("await prisma.$transaction(async (tx) => {");
    const txEnd = src.indexOf("}, { timeout:", txStart);
    assert.ok(txStart > -1 && txEnd > -1, "transaction block must exist");
    const txBlock = src.slice(txStart, txEnd);
    // The audit call inside the tx must pass `tx` as the transaction client.
    const auditIdx = txBlock.indexOf("TENDER_ENGINE_DOCUMENTS_SUPERSEDED");
    assert.ok(auditIdx > -1, "supersede audit must be inside the tx block");
    const afterAudit = txBlock.slice(auditIdx);
    assert.match(afterAudit, /tx,?\s*\n\s*\}/, "audit call must pass tx");
  });
});

// ─── P1-11: chunk-recovery validates resultJson before promoting ───────────

describe("P1-11 — chunk-recovery validates resultJson before promoting to SUCCEEDED", () => {
  it("does NOT promote chunks with just resultJson: { not: null }", () => {
    const src = read("lib/ai-jobs/chunk-recovery.ts");
    // The old code selected only id and promoted all non-null resultJson chunks.
    // The new code selects resultJson too and filters by content validity.
    assert.match(src, /select:\s*\{\s*id:\s*true,\s*resultJson:\s*true\s*\}/, "must select resultJson for validation");
  });

  it("filters by JSON.parse + non-empty object check", () => {
    const src = read("lib/ai-jobs/chunk-recovery.ts");
    assert.match(src, /JSON\.parse\(c\.resultJson\)/, "must JSON.parse the resultJson");
    assert.match(src, /Object\.keys\(parsed\)\.length\s*>\s*0/, "must check non-empty object");
    assert.match(src, /validCompleted/, "must use a validCompleted filter array");
  });
});
