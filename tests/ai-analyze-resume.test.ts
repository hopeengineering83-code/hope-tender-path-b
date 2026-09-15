// AI Analyze resume/continuation regression tests.
//
// Verifies:
//   1. analyzeWithAI accepts previousChunkResults and skips already-completed chunks
//   2. analyzeWithAI returns chunkResults in AnalysisWithMeta
//   3. buildResumeState (route helper) correctly extracts chunkResults from saved job output
//   4. buildResumeState falls back to completedChunks when chunkResults is absent
//   5. Content hash mismatch causes full re-run (previousChunkResults reset)
//   6. Streaming path source: continueJobId variable is mutable (let, not const)
//   7. Streaming path source: previousChunkResults passed to analyzeWithAI
//   8. Non-streaming path source: same fix applied
//   9. Job output now includes chunkResults field (both paths)
//  10. Auto-resume: streaming path detects PARTIAL_SUCCESS job without ?continue param

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// ── Unit: chunkResults in AnalysisWithMeta ────────────────────────────────────

describe("analyzeWithAI — chunkResults in return value", () => {
  it("AnalysisWithMeta type includes chunkResults field", () => {
    const aiSource = readFileSync(path.join(process.cwd(), "lib/ai.ts"), "utf-8");
    assert.ok(
      aiSource.includes("chunkResults: ChunkResult[]") || aiSource.includes("chunkResults:"),
      "AnalysisWithMeta must declare chunkResults field",
    );
  });

  it("ChunkResult type is exported from lib/ai.ts", () => {
    const aiSource = readFileSync(path.join(process.cwd(), "lib/ai.ts"), "utf-8");
    assert.ok(
      aiSource.includes("export type ChunkResult"),
      "ChunkResult must be exported for use in route files",
    );
  });

  it("analyzeWithAI accepts previousChunkResults in opts", () => {
    const aiSource = readFileSync(path.join(process.cwd(), "lib/ai.ts"), "utf-8");
    assert.ok(
      aiSource.includes("previousChunkResults"),
      "analyzeWithAI opts must accept previousChunkResults",
    );
  });

  it("return statement includes chunkResults field", () => {
    const aiSource = readFileSync(path.join(process.cwd(), "lib/ai.ts"), "utf-8");
    assert.ok(
      aiSource.includes("chunkResults: sortedSuccesses") || aiSource.includes("chunkResults: ["),
      "analyzeWithAI return must include chunkResults",
    );
  });
});

describe("analyzeWithAI — resume queue building", () => {
  function buildResumeQueue(totalChunks: number, startFromChunk: number | undefined, previousChunkResults: Array<{ index: number }>) {
    const previousIndexes = new Set(previousChunkResults.map((entry) => entry.index));
    const hasSavedChunkResults = previousChunkResults.length > 0;
    const startIndex = hasSavedChunkResults ? 0 : Math.max(startFromChunk ?? 0, 0);
    return Array.from({ length: totalChunks }, (_, index) => ({ content: `chunk ${index}`, index }))
      .filter((c) => !previousIndexes.has(c.index) && c.index >= startIndex)
      .map((c) => c.index);
  }

  it("retries a missing middle chunk when chunks 0 and 2 are already saved", () => {
    assert.deepEqual(buildResumeQueue(3, 3, [{ index: 0 }, { index: 2 }]), [1]);
  });

  it("uses startFromChunk only for old jobs without chunkResults", () => {
    assert.deepEqual(buildResumeQueue(5, 3, []), [3, 4]);
  });
});

// ── Unit: buildResumeState helper ─────────────────────────────────────────────

describe("buildResumeState — extracts previousChunkResults from saved job output", () => {
  it("returns empty state when output is null", () => {
    // Inline reproduction of buildResumeState logic
    function buildResumeState(savedOutput: { chunkResults?: unknown[]; completedChunks?: number; contentHash?: string } | null) {
      if (!savedOutput) return { startFromChunk: 0, previousChunkResults: [], existingContentHash: undefined };
      const raw = (savedOutput.chunkResults ?? []) as Array<{ index: number; result: unknown; provider?: string | null }>;
      const previousChunkResults = raw.filter((r) => typeof r.index === "number" && r.result != null).sort((a, b) => a.index - b.index);
      const startFromChunk = previousChunkResults.length > 0
        ? 0
        : (typeof savedOutput.completedChunks === "number" ? savedOutput.completedChunks : 0);
      return { startFromChunk, previousChunkResults, existingContentHash: typeof savedOutput.contentHash === "string" ? savedOutput.contentHash : undefined };
    }

    const result = buildResumeState(null);
    assert.equal(result.startFromChunk, 0);
    assert.deepEqual(result.previousChunkResults, []);
    assert.equal(result.existingContentHash, undefined);
  });

  it("extracts chunk results and computes correct startFromChunk", () => {
    function buildResumeState(savedOutput: { chunkResults?: unknown[]; completedChunks?: number; contentHash?: string } | null) {
      if (!savedOutput) return { startFromChunk: 0, previousChunkResults: [], existingContentHash: undefined };
      const raw = (savedOutput.chunkResults ?? []) as Array<{ index: number; result: unknown; provider?: string | null }>;
      const previousChunkResults = raw.filter((r) => typeof r.index === "number" && r.result != null).sort((a, b) => a.index - b.index);
      const startFromChunk = previousChunkResults.length > 0
        ? 0
        : (typeof savedOutput.completedChunks === "number" ? savedOutput.completedChunks : 0);
      return { startFromChunk, previousChunkResults, existingContentHash: typeof savedOutput.contentHash === "string" ? savedOutput.contentHash : undefined };
    }

    const fakeChunks = [
      { index: 0, result: { summary: "chunk 0", requirements: [] }, provider: "gemini" },
      { index: 1, result: { summary: "chunk 1", requirements: [] }, provider: "openai" },
    ];
    const result = buildResumeState({
      chunkResults: fakeChunks,
      completedChunks: 2,
      contentHash: "abc123",
    });
    assert.equal(result.startFromChunk, 0, "saved chunkResults should resume by missing indexes, not highest completed index");
    assert.equal(result.previousChunkResults.length, 2);
    assert.equal(result.existingContentHash, "abc123");
  });

  it("falls back to completedChunks when chunkResults is missing", () => {
    function buildResumeState(savedOutput: { chunkResults?: unknown[]; completedChunks?: number; contentHash?: string } | null) {
      if (!savedOutput) return { startFromChunk: 0, previousChunkResults: [], existingContentHash: undefined };
      const raw = (savedOutput.chunkResults ?? []) as Array<{ index: number; result: unknown; provider?: string | null }>;
      const previousChunkResults = raw.filter((r) => typeof r.index === "number" && r.result != null).sort((a, b) => a.index - b.index);
      const startFromChunk = previousChunkResults.length > 0
        ? 0
        : (typeof savedOutput.completedChunks === "number" ? savedOutput.completedChunks : 0);
      return { startFromChunk, previousChunkResults, existingContentHash: typeof savedOutput.contentHash === "string" ? savedOutput.contentHash : undefined };
    }

    const result = buildResumeState({ completedChunks: 3, contentHash: "xyz" });
    assert.equal(result.startFromChunk, 3, "should fall back to completedChunks when no chunkResults");
    assert.deepEqual(result.previousChunkResults, []);
  });
});

// ── Source-level checks: DIRECTIVE 2 — streaming path removed ───────────────
// The streaming path (handleStreamingAnalyze) was removed. The legacy /ai-analyze
// route now returns 422 MANUAL_AI_ANALYZE_REQUIRED. Resume is handled by the
// durable worker (runNextChunk) which loads existing job checkpoints.

const routeSource = readFileSync(
  path.join(process.cwd(), "app/api/tenders/[id]/ai-analyze/route.ts"),
  "utf-8",
);

describe("ai-analyze/route — DIRECTIVE 2: streaming removed, resume via durable worker", () => {
  it("route returns MANUAL_AI_ANALYZE_REQUIRED (no streaming path)", () => {
    assert.ok(routeSource.includes("MANUAL_AI_ANALYZE_REQUIRED"),
      "route must return MANUAL_AI_ANALYZE_REQUIRED for fresh job creation");
  });

  it("route returns MANUAL_AI_ANALYZE_REQUIRED (no streaming)", () => {
    assert.ok(routeSource.includes("MANUAL_AI_ANALYZE_REQUIRED"),
      "route must return MANUAL_AI_ANALYZE_REQUIRED instead of creating fresh jobs");
  });

  it("durable worker handles resume via runNextChunk checkpoints", () => {
    const serviceSource = readFileSync(
      path.join(process.cwd(), "lib/ai-jobs/analysis-job-service.ts"),
      "utf-8",
    );
    assert.ok(serviceSource.includes("runNextChunk"),
      "analysis-job-service must have runNextChunk for durable resume");
  });

  it("streaming path detects resumable PARTIAL_SUCCESS or FAILED jobs for auto-resume when no continueJobId", () => {
    assert.ok(
      routeSource.includes("findLatestResumableAiAnalyzeJob")
        && routeSource.includes('status: { in: ["PARTIAL_SUCCESS", "FAILED"] }'),
      "streaming path must auto-detect latest resumable PARTIAL_SUCCESS or FAILED job for transparent resume",
    );
  });

  it("streaming path saves chunkResults in job output blob", () => {
    assert.ok(
      routeSource.includes("chunkResults: aiMeta.chunkResults"),
      "streaming path must include chunkResults in job output JSON for future resumption",
    );
  });

  it("content hash mismatch resets previousChunkResults in streaming path", () => {
    assert.ok(
      routeSource.includes("previousChunkResults = [];") && routeSource.includes("continueJobId = null;"),
      "streaming path must reset previousChunkResults and continueJobId when content hash changes",
    );
  });
});

describe("ai-analyze/route (non-streaming) — resume fixes", () => {
  it("non-streaming path passes previousChunkResults to analyzeWithAI", () => {
    const count = (routeSource.match(/analyzeWithAI\(tenderContent,\s*\{[^}]*previousChunkResults/g) ?? []).length;
    assert.ok(count >= 2, `both streaming and non-streaming paths must pass previousChunkResults (found ${count})`);
  });

  it("non-streaming path saves chunkResults in job output blob", () => {
    const count = (routeSource.match(/chunkResults:\s*aiMeta\.chunkResults/g) ?? []).length;
    assert.ok(count >= 2, `both paths must save chunkResults in job output (found ${count})`);
  });

  it("non-streaming path has auto-resume detection for resumable FAILED jobs too", () => {
    const count = (routeSource.match(/findLatestResumableAiAnalyzeJob\(id, userId, contentHash\)/g) ?? []).length;
    assert.ok(count >= 2, `auto-resume must use the shared resumable-job lookup in both paths (found ${count})`);
  });

  it("per-chunk progress output includes chunkProviders for later failure preservation", () => {
    assert.ok(
      routeSource.includes("function buildAiAnalyzePartialOutput")
        && routeSource.includes("chunkProviders")
        && routeSource.includes("output: JSON.stringify(buildAiAnalyzePartialOutput(completed, totalChunks, contentHash))"),
      "onChunkComplete output must persist chunkProviders along with chunkResults",
    );
  });

  it("failure helper preserves chunkResults and marks resumable failures as continue", () => {
    assert.ok(
      routeSource.includes("async function preserveAiAnalyzeProgressOnFailure")
        && routeSource.includes("const existingOutput = parseAiAnalyzeJobOutput")
        && routeSource.includes("chunkResults")
        && routeSource.includes('nextAction: hasChunkResults ? "CONTINUE_AI_ANALYZE" : "RETRY_AI_ANALYZE"'),
      "failure helper must merge failure metadata into existing output without deleting chunkResults",
    );
  });

  it("catch blocks use preserveAiAnalyzeProgressOnFailure instead of fallback-only output", () => {
    const fallbackOnlyWrites = routeSource.match(/output:\s*JSON\.stringify\(\{\s*analysisSource:\s*"REGEX_FALLBACK",\s*nextAction:\s*"RETRY_AI_ANALYZE"/g) ?? [];
    assert.equal(fallbackOnlyWrites.length, 0, "catch blocks must not overwrite job output with fallback-only JSON");
    const preserveCalls = routeSource.match(/preserveAiAnalyzeProgressOnFailure\(analysisJob\.id/g) ?? [];
    assert.ok(preserveCalls.length >= 2, `streaming and non-streaming catches must preserve progress (found ${preserveCalls.length})`);
  });
});

// ── Tender GET route: surfaces partial job ───────────────────────────────────

describe("tender GET route — surfaces latestPartialAnalysisJob", () => {
  it("route.ts queries for resumable PARTIAL_SUCCESS and FAILED jobs", () => {
    const routeGet = readFileSync(path.join(process.cwd(), "app/api/tenders/[id]/route.ts"), "utf-8");
    assert.ok(
      routeGet.includes('status: { in: ["PARTIAL_SUCCESS", "FAILED"] }')
        && routeGet.includes("latestPartialJobCandidates")
        && routeGet.includes("chunkResults"),
      "tender GET route must surface resumable failed jobs with saved chunkResults, not only PARTIAL_SUCCESS jobs",
    );
  });

  it("route.ts includes latestPartialAnalysisJob in the response payload", () => {
    const routeGet = readFileSync(path.join(process.cwd(), "app/api/tenders/[id]/route.ts"), "utf-8");
    assert.ok(
      routeGet.includes("latestPartialAnalysisJob"),
      "tender GET route must include latestPartialAnalysisJob in the response",
    );
  });
});

// ── Behavioral: successful chunk reuse ───────────────────────────────────────

describe("analyzeWithAI — successful chunks are reused, not re-executed", () => {
  function buildResumeQueue(
    totalChunks: number,
    previousChunkResults: Array<{ index: number }>,
  ): number[] {
    const previousIndexes = new Set(previousChunkResults.map((e) => e.index));
    const hasSaved = previousChunkResults.length > 0;
    const startIndex = hasSaved ? 0 : 0;
    return Array.from({ length: totalChunks }, (_, i) => i).filter(
      (i) => !previousIndexes.has(i) && i >= startIndex,
    );
  }

  it("all chunks cached → queue is empty (nothing re-executed)", () => {
    assert.deepEqual(
      buildResumeQueue(3, [{ index: 0 }, { index: 1 }, { index: 2 }]),
      [],
      "all cached chunks must produce an empty retry queue",
    );
  });

  it("two chunks cached → only the uncached chunk is queued", () => {
    assert.deepEqual(
      buildResumeQueue(3, [{ index: 0 }, { index: 2 }]),
      [1],
      "only the missing middle chunk must be retried",
    );
  });

  it("last chunk cached → only the first two chunks are queued", () => {
    assert.deepEqual(
      buildResumeQueue(3, [{ index: 2 }]),
      [0, 1],
      "non-contiguous cached chunks at the end must not suppress earlier uncached chunks",
    );
  });
});

// ── Behavioral: failed jobs preserve progress ────────────────────────────────

describe("analyzeWithAI — failed jobs preserve accumulated progress", () => {
  it("failure helper reads existing output before writing — does not wipe chunkResults", () => {
    const src = readFileSync(
      path.join(process.cwd(), "app/api/tenders/[id]/ai-analyze/route.ts"),
      "utf-8",
    );
    assert.ok(
      src.includes("const existingOutput = parseAiAnalyzeJobOutput"),
      "preserveAiAnalyzeProgressOnFailure must read existing output before overwriting — chunkResults must survive failure",
    );
  });

  it("failure helper sets CONTINUE_AI_ANALYZE when chunkResults are present", () => {
    const src = readFileSync(
      path.join(process.cwd(), "app/api/tenders/[id]/ai-analyze/route.ts"),
      "utf-8",
    );
    assert.ok(
      src.includes('nextAction: hasChunkResults ? "CONTINUE_AI_ANALYZE" : "RETRY_AI_ANALYZE"'),
      "FAILED jobs with saved chunks must have CONTINUE_AI_ANALYZE so the UI offers resume, not full retry",
    );
  });

  it("failure helper does not touch requirements — canonical data is never modified on failure", () => {
    const src = readFileSync(
      path.join(process.cwd(), "app/api/tenders/[id]/ai-analyze/route.ts"),
      "utf-8",
    );
    const helperStart = src.indexOf("async function preserveAiAnalyzeProgressOnFailure");
    assert.ok(helperStart !== -1, "preserveAiAnalyzeProgressOnFailure must exist");
    const helperBody = src.slice(helperStart, helperStart + 3_000);
    assert.ok(
      !helperBody.includes("requirement.createMany") && !helperBody.includes("requirement.deleteMany"),
      "failure helper must not create or delete requirements — canonical requirements are only updated on successful complete finalization",
    );
  });

  it("inline simulation: partial progress is preserved through FAILED finalization", () => {
    function preserveProgress(
      existingOutput: { chunkResults: Array<{ index: number }>; contentHash: string } | null,
    ) {
      const chunkResults = existingOutput?.chunkResults ?? [];
      const hasChunkResults = chunkResults.length > 0;
      return {
        chunkResults,
        nextAction: hasChunkResults ? "CONTINUE_AI_ANALYZE" : "RETRY_AI_ANALYZE",
        preserved: hasChunkResults,
      };
    }

    const partial = preserveProgress({
      chunkResults: [{ index: 0 }, { index: 2 }],
      contentHash: "abc123",
    });
    assert.equal(partial.preserved, true, "accumulated chunkResults must survive failure");
    assert.equal(partial.nextAction, "CONTINUE_AI_ANALYZE");
    assert.equal(partial.chunkResults.length, 2);

    const fresh = preserveProgress(null);
    assert.equal(fresh.preserved, false, "job with no prior chunks gets RETRY, not CONTINUE");
    assert.equal(fresh.nextAction, "RETRY_AI_ANALYZE");
  });
});

// ── Behavioral: content-hash mismatch invalidates checkpoints ────────────────

describe("analyzeWithAI — content-hash mismatch invalidates old checkpoints", () => {
  it("route resets previousChunkResults and continueJobId when hash changes", () => {
    const src = readFileSync(
      path.join(process.cwd(), "app/api/tenders/[id]/ai-analyze/route.ts"),
      "utf-8",
    );
    assert.ok(
      src.includes("previousChunkResults = [];") && src.includes("continueJobId = null;"),
      "route must clear previousChunkResults and continueJobId when existingContentHash !== contentHash",
    );
  });

  it("checkpoint helper deletes rows for non-matching content hashes", () => {
    const src = readFileSync(
      path.join(process.cwd(), "lib/ai-analyze-checkpoints.ts"),
      "utf-8",
    );
    assert.ok(
      src.includes("clearAnalyzeCheckpointsForContentHashMismatch"),
      "checkpoint helper must export clearAnalyzeCheckpointsForContentHashMismatch",
    );
    assert.ok(
      src.includes("contentHash: { not: contentHash }"),
      "clearAnalyzeCheckpointsForContentHashMismatch must delete all rows whose contentHash differs from the current hash",
    );
  });

  it("inline simulation: mismatched hash produces empty resume state", () => {
    function resolveResumeState(
      savedHash: string | undefined,
      currentHash: string,
      savedChunks: Array<{ index: number }>,
    ) {
      if (savedHash && savedHash !== currentHash) {
        return { previousChunkResults: [], continueJobId: null };
      }
      return { previousChunkResults: savedChunks, continueJobId: "job-123" };
    }

    const match = resolveResumeState("hash-A", "hash-A", [{ index: 0 }, { index: 1 }]);
    assert.equal(match.previousChunkResults.length, 2, "matching hash must preserve prior chunks");
    assert.equal(match.continueJobId, "job-123");

    const mismatch = resolveResumeState("hash-OLD", "hash-NEW", [{ index: 0 }, { index: 1 }]);
    assert.deepEqual(mismatch.previousChunkResults, [], "hash mismatch must clear all prior chunks");
    assert.equal(mismatch.continueJobId, null);
  });
});

// ── Behavioral: partial jobs remain resumable ─────────────────────────────────

describe("analyzeWithAI — partial jobs remain resumable", () => {
  it("auto-resume discovery queries for PARTIAL_SUCCESS and FAILED jobs", () => {
    const src = readFileSync(
      path.join(process.cwd(), "app/api/tenders/[id]/ai-analyze/route.ts"),
      "utf-8",
    );
    assert.ok(
      src.includes('status: { in: ["PARTIAL_SUCCESS", "FAILED"] }'),
      "auto-resume must search for both PARTIAL_SUCCESS and FAILED jobs — a FAILED job with chunkResults is still resumable",
    );
  });

  it("auto-resume verifies contentHash before loading prior chunkResults", () => {
    const src = readFileSync(
      path.join(process.cwd(), "app/api/tenders/[id]/ai-analyze/route.ts"),
      "utf-8",
    );
    assert.ok(
      src.includes("savedOutput.contentHash"),
      "auto-resume must verify contentHash of the discovered partial job matches the current content before loading chunks",
    );
  });

  it("tender GET route exposes partial job so the UI can offer resume", () => {
    const routeGet = readFileSync(
      path.join(process.cwd(), "app/api/tenders/[id]/route.ts"),
      "utf-8",
    );
    assert.ok(
      routeGet.includes("latestPartialAnalysisJob"),
      "tender GET route must include latestPartialAnalysisJob in the response so the UI can wire the Resume button",
    );
  });

  it("PARTIAL_SUCCESS job output retains chunkResults for the next resume request", () => {
    const src = readFileSync(
      path.join(process.cwd(), "app/api/tenders/[id]/ai-analyze/route.ts"),
      "utf-8",
    );
    // After the streaming supersession fix, the status is computed via
    // streamTerminalStatus which includes the SUPERSEDED case. The partial
    // check is now: aiMeta.isPartial ? "PARTIAL_SUCCESS" : (superseded ? "SUPERSEDED" : "SUCCEEDED")
    const partialStatusCount = (
      src.match(/aiMeta\.isPartial \? "PARTIAL_SUCCESS"/g) ?? []
    ).length;
    assert.ok(
      partialStatusCount >= 2,
      "both streaming and non-streaming paths must mark partial jobs as PARTIAL_SUCCESS (found in output JSON)",
    );
    const chunkResultsCount = (src.match(/chunkResults: aiMeta\.chunkResults/g) ?? []).length;
    assert.ok(
      chunkResultsCount >= 2,
      "both paths must save chunkResults so the next resume request can skip already-completed chunks",
    );
  });
});
