// Targeted tests: provider failover and single-chunk retry path.
// Verifies that single-chunk AI Analyze uses the same retry/provider-failover
// path as multi-chunk analysis.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("Provider failover and single-chunk retry", () => {
  it("analyzeOneChunkWithRetry wraps analyzeOneChunk with retry logic", () => {
    const src = read("lib/ai.ts");
    assert.ok(
      src.includes("export async function analyzeOneChunkWithRetry"),
      "analyzeOneChunkWithRetry must exist as the retry wrapper",
    );
    assert.ok(
      src.includes("isTransientChunkError"),
      "must have isTransientChunkError to detect retryable errors",
    );
    assert.ok(
      src.includes("isProviderExhaustedError"),
      "must have isProviderExhaustedError to detect when all providers are in cooldown",
    );
  });

  it("single-chunk tenders use the same analyzeOneChunkWithRetry path", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    // The durable worker calls analyzeOneChunkWithRetry for ALL chunks,
    // including single-chunk tenders. There is no single-chunk bypass.
    assert.ok(
      src.includes("analyzeOneChunkWithRetry(chunkText, chunk.chunkIndex, allChunks.length"),
      "durable worker must call analyzeOneChunkWithRetry for all chunks",
    );
    // Must NOT have a single-chunk bypass that skips retry
    assert.ok(
      !src.includes("if (allChunks.length === 1)") &&
        !src.includes("if (totalChunks === 1)"),
      "must NOT have a single-chunk bypass that skips the retry/failover path",
    );
  });

  it("analyzeOneChunk uses generateWithFallback for provider failover", () => {
    const src = read("lib/ai.ts");
    assert.ok(
      src.includes("async function analyzeOneChunk("),
      "analyzeOneChunk must exist",
    );
    assert.ok(
      src.includes("generateWithFallback"),
      "analyzeOneChunk must call generateWithFallback for provider failover",
    );
  });

  it("generateWithFallback checks isProviderCooledDown before each provider", () => {
    const src = read("lib/ai.ts");
    assert.ok(
      src.includes("isProviderCooledDown"),
      "generateWithFallback must check isProviderCooledDown before trying each provider",
    );
  });

  it("durable worker restores provider health before chunk analysis", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    // Find the actual CALL positions (not import references).
    // The restore CALL is "await restoreHealthFromDb" and the analyze CALL
    // is "analyzeOneChunkWithRetry(chunkText" — both inside the try block.
    const restoreCallIdx = src.indexOf("await restoreHealthFromDb");
    const analyzeCallIdx = src.indexOf("analyzeOneChunkWithRetry(chunkText");
    assert.ok(restoreCallIdx > 0, "must have 'await restoreHealthFromDb' call");
    assert.ok(analyzeCallIdx > 0, "must have 'analyzeOneChunkWithRetry(chunkText' call");
    assert.ok(
      restoreCallIdx < analyzeCallIdx,
      `restoreHealthFromDb call (at ${restoreCallIdx}) must be BEFORE analyzeOneChunkWithRetry call (at ${analyzeCallIdx})`,
    );
  });

  it("durable worker persists provider health after both success and failure", () => {
    const src = read("lib/ai-jobs/analysis-job-service.ts");
    // Must have persistAllHealthToDb in both the try block (success) and catch block (failure)
    const tryBlock = src.slice(src.indexOf("try {"), src.indexOf("} catch (err) {"));
    const catchBlock = src.slice(src.indexOf("} catch (err) {"), src.indexOf("// satisfy non-destructive"));
    assert.ok(
      tryBlock.includes("persistAllHealthToDb"),
      "must persist provider health after successful chunk analysis",
    );
    assert.ok(
      catchBlock.includes("persistAllHealthToDb"),
      "must persist provider health after failed chunk analysis (to record cooldown)",
    );
  });
});
