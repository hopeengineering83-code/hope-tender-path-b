// Tests for all fragments ported from PR #888 into PR #887.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("PR #888 ported fragments", () => {
  it("Fragment 1: restoreHealthFromDbBounded exists", () => {
    const src = read("lib/ai-provider-health-db.ts");
    assert.ok(src.includes("export async function restoreHealthFromDbBounded"), "must have restoreHealthFromDbBounded");
    assert.ok(src.includes("Promise.race"), "must use Promise.race for timeout bounding");
    assert.ok(src.includes("timeoutMs"), "must accept timeoutMs parameter");
  });

  it("Fragment 1: persistAllHealthToDbBounded exists", () => {
    const src = read("lib/ai-provider-health-db.ts");
    assert.ok(src.includes("export async function persistAllHealthToDbBounded"), "must have persistAllHealthToDbBounded");
  });

  it("Fragment 2: orchestrator uses bounded health functions", () => {
    const src = read("lib/engine/analysis-orchestrator.ts");
    assert.ok(src.includes("restoreHealthFromDbBounded"), "orchestrator must use restoreHealthFromDbBounded");
    assert.ok(src.includes("persistAllHealthToDbBounded"), "orchestrator must use persistAllHealthToDbBounded");
    assert.ok(!src.includes("restoreHealthFromDb()"), "orchestrator must NOT use unbounded restoreHealthFromDb");
  });

  it("Fragment 3a: run-next uses bounded restore before retry re-arm", () => {
    const src = read("app/api/ai-jobs/run-next/route.ts");
    assert.ok(src.includes("restoreHealthFromDbBounded"), "run-next must use restoreHealthFromDbBounded");
    // The CALL (not import) must be before the findJobsDueForRetry CALL.
    // Imports appear at the top; we need to check the actual call positions.
    const restoreCallIdx = src.indexOf("await restoreHealthFromDbBounded");
    const retryCallIdx = src.indexOf("await findJobsDueForRetry");
    assert.ok(restoreCallIdx > 0, "must have 'await restoreHealthFromDbBounded' call");
    assert.ok(retryCallIdx > 0, "must have 'await findJobsDueForRetry' call");
    assert.ok(restoreCallIdx < retryCallIdx, `restore call (at ${restoreCallIdx}) must be before retry call (at ${retryCallIdx})`);
  });

  it("Fragment 3b: analyzeOneChunkWithRetry checks deadline before starting", () => {
    const src = read("lib/ai.ts");
    assert.ok(
      src.includes("AI_ANALYSIS_DEADLINE_REACHED_BEFORE_CHUNK_ATTEMPT"),
      "must fail fast with AI_ANALYSIS_DEADLINE_REACHED_BEFORE_CHUNK_ATTEMPT if deadline already reached",
    );
  });

  it("Fragment 4: state resolver fails closed on SUCCEEDED without promotedAt", () => {
    const src = read("lib/engine/analysis-state-resolver.ts");
    // SUCCEEDED without promotedAt must be treated as FAILED
    assert.ok(src.includes("!job.promotedAt"), "must check !job.promotedAt in SUCCEEDED branch");
    // The fail-closed path must set state to FAILED
    const succeededIdx = src.indexOf('job.status === "SUCCEEDED"');
    const failClosedBlock = src.slice(succeededIdx, succeededIdx + 500);
    assert.ok(
      failClosedBlock.includes('state = "FAILED"'),
      "SUCCEEDED without promotedAt must set state to FAILED",
    );
  });

  it("Fragment 5: ai-job-handlers returns code/retryable/correlationId at top level", () => {
    // AI_ANALYZE's implementation lives in ai-job-handlers-legacy.ts —
    // lib/ai-job-handlers.ts now only re-exports it and locally overrides
    // EXTRACT_TEXT's getHandler branch.
    const src = read("lib/ai-job-handlers-legacy.ts");
    assert.ok(
      src.includes("...(finalizeCode ? { code: finalizeCode }"),
      "must return code at top level (not just in output)",
    );
    assert.ok(
      src.includes("...(finalizeRetryable !== undefined ? { retryable: finalizeRetryable }"),
      "must return retryable at top level",
    );
    assert.ok(
      src.includes("...(finalizeCorrelationId ? { correlationId: finalizeCorrelationId }"),
      "must return correlationId at top level",
    );
  });

  it("Fragment 6: streaming path promotes inside transaction with tx", () => {
    const src = read("app/api/tenders/[id]/ai-analyze/route.ts");
    assert.ok(
      src.includes("promoteAnalysisToCanonical(analysisJob.id, runId, tx)"),
      "streaming path must call promoteAnalysisToCanonical with tx (inside transaction)",
    );
    // Must NOT call promoteAnalysisToCanonical outside the transaction
    assert.ok(
      !src.includes("if (!streamPromoSuperseded && analysisJob)"),
      "streaming path must NOT promote outside the transaction (old pattern)",
    );
  });
});
