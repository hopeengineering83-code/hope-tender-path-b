// Targeted test: single-chunk AI Analyze must use the same retry path
// as multi-chunk. Previously the single-chunk path called analyzeOneChunk
// directly (no retry), while multi-chunk used analyzeOneChunkWithRetry.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("Single-chunk retry fix (ported from PR #888)", () => {
  it("single-chunk path uses analyzeOneChunkWithRetry (not analyzeOneChunk)", () => {
    const src = read("lib/ai.ts");
    // Find the single-chunk path — it's the one with chunks[0] and totalChunks: 1
    const singleChunkMatch = src.match(/analyzeOneChunk(?:WithRetry)?\(chunks\[0\],\s*0,\s*1,/);
    assert.ok(singleChunkMatch, "must find the single-chunk analyze call");
    assert.ok(
      singleChunkMatch[0].includes("WithRetry"),
      `single-chunk path must use analyzeOneChunkWithRetry, got: ${singleChunkMatch[0]}`,
    );
  });

  it("multi-chunk path still uses analyzeOneChunkWithRetry", () => {
    const src = read("lib/ai.ts");
    // The multi-chunk path uses item.content and chunks.length
    assert.ok(
      src.includes("analyzeOneChunkWithRetry(item.content, item.index, chunks.length,"),
      "multi-chunk path must still use analyzeOneChunkWithRetry",
    );
  });

  it("correlationId is propagated to WorkerJobResult", () => {
    const src = read("app/api/ai-jobs/run-next/route.ts");
    assert.ok(
      src.includes("correlationId?: string;"),
      "WorkerJobResult type must include correlationId field",
    );
    assert.ok(
      src.includes("correlationId: result.correlationId"),
      "terminal handler push must include correlationId from result",
    );
    assert.ok(
      src.includes("correlationId: worst.correlationId ?? null"),
      "top-level response must include correlationId",
    );
  });

  it("ai-job-handlers propagates retryable and correlationId", () => {
    // AI_ANALYZE's implementation lives in ai-job-handlers-legacy.ts —
    // lib/ai-job-handlers.ts now only re-exports it and locally overrides
    // EXTRACT_TEXT's getHandler branch.
    const src = read("lib/ai-job-handlers-legacy.ts");
    assert.ok(
      src.includes("finalizeRetryable") && src.includes("finalizeCorrelationId"),
      "ai-job-handlers must extract retryable and correlationId from finalize result",
    );
    assert.ok(
      src.includes("...(finalizeRetryable !== undefined ? { retryable: finalizeRetryable }"),
      "ai-job-handlers must propagate retryable to output",
    );
    assert.ok(
      src.includes("...(finalizeCorrelationId ? { correlationId: finalizeCorrelationId }"),
      "ai-job-handlers must propagate correlationId to output",
    );
  });

  it("orchestrator restores provider health before analysis", () => {
    const src = read("lib/engine/analysis-orchestrator.ts");
    assert.ok(
      src.includes("restoreHealthFromDb"),
      "orchestrator must call restoreHealthFromDb before analysis",
    );
    // Restore must be BEFORE analyzeWithAI
    const restoreIdx = src.indexOf("restoreHealthFromDb");
    const analyzeIdx = src.indexOf("analyzeWithAI(tenderContent");
    assert.ok(restoreIdx > 0 && analyzeIdx > 0, "both must exist");
    assert.ok(restoreIdx < analyzeIdx, "restore must be before analyzeWithAI");
  });

  it("orchestrator persists provider health after analysis (finally block)", () => {
    const src = read("lib/engine/analysis-orchestrator.ts");
    assert.ok(
      src.includes("persistAllHealthToDb"),
      "orchestrator must call persistAllHealthToDb",
    );
    assert.ok(
      src.includes("} finally {") && src.includes("persistAllHealthToDb"),
      "persistAllHealthToDb must be in a finally block",
    );
  });
});
