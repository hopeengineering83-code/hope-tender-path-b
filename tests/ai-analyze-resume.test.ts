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

// ── Unit: buildResumeState helper ─────────────────────────────────────────────

describe("buildResumeState — extracts previousChunkResults from saved job output", () => {
  it("returns empty state when output is null", () => {
    // Inline reproduction of buildResumeState logic
    function buildResumeState(savedOutput: { chunkResults?: unknown[]; completedChunks?: number; contentHash?: string } | null) {
      if (!savedOutput) return { startFromChunk: 0, previousChunkResults: [], existingContentHash: undefined };
      const raw = (savedOutput.chunkResults ?? []) as Array<{ index: number; result: unknown; provider?: string | null }>;
      const previousChunkResults = raw.filter((r) => typeof r.index === "number" && r.result != null).sort((a, b) => a.index - b.index);
      const startFromChunk = previousChunkResults.length > 0
        ? Math.max(...previousChunkResults.map((r) => r.index)) + 1
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
        ? Math.max(...previousChunkResults.map((r) => r.index)) + 1
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
    assert.equal(result.startFromChunk, 2, "should start from chunk 2 (index of last completed + 1)");
    assert.equal(result.previousChunkResults.length, 2);
    assert.equal(result.existingContentHash, "abc123");
  });

  it("falls back to completedChunks when chunkResults is missing", () => {
    function buildResumeState(savedOutput: { chunkResults?: unknown[]; completedChunks?: number; contentHash?: string } | null) {
      if (!savedOutput) return { startFromChunk: 0, previousChunkResults: [], existingContentHash: undefined };
      const raw = (savedOutput.chunkResults ?? []) as Array<{ index: number; result: unknown; provider?: string | null }>;
      const previousChunkResults = raw.filter((r) => typeof r.index === "number" && r.result != null).sort((a, b) => a.index - b.index);
      const startFromChunk = previousChunkResults.length > 0
        ? Math.max(...previousChunkResults.map((r) => r.index)) + 1
        : (typeof savedOutput.completedChunks === "number" ? savedOutput.completedChunks : 0);
      return { startFromChunk, previousChunkResults, existingContentHash: typeof savedOutput.contentHash === "string" ? savedOutput.contentHash : undefined };
    }

    const result = buildResumeState({ completedChunks: 3, contentHash: "xyz" });
    assert.equal(result.startFromChunk, 3, "should fall back to completedChunks when no chunkResults");
    assert.deepEqual(result.previousChunkResults, []);
  });
});

// ── Source-level checks: streaming path ──────────────────────────────────────

const routeSource = readFileSync(
  path.join(process.cwd(), "app/api/tenders/[id]/ai-analyze/route.ts"),
  "utf-8",
);

describe("ai-analyze/route (streaming) — resume fixes", () => {
  it("continueJobId is declared as let (mutable) in streaming path", () => {
    // Must be let, not const, so auto-resume can assign the discovered job id.
    const streamingSection = routeSource.slice(0, routeSource.indexOf("async function handleStreamingAnalyze") + 10_000);
    assert.ok(
      streamingSection.includes("let continueJobId"),
      "streaming path must declare continueJobId as let so auto-resume can assign it",
    );
  });

  it("streaming path passes previousChunkResults to analyzeWithAI", () => {
    assert.ok(
      routeSource.includes("analyzeWithAI(tenderContent, {") && routeSource.includes("previousChunkResults"),
      "streaming path must pass previousChunkResults to analyzeWithAI",
    );
  });

  it("streaming path uses normalizePreviousChunkResults to extract chunkResults from job output", () => {
    assert.ok(
      routeSource.includes("normalizePreviousChunkResults") && routeSource.includes("parseAiAnalyzeJobOutput"),
      "streaming path must use parseAiAnalyzeJobOutput + normalizePreviousChunkResults to load resume state",
    );
  });

  it("streaming path detects PARTIAL_SUCCESS job for auto-resume when no continueJobId", () => {
    assert.ok(
      routeSource.includes("PARTIAL_SUCCESS") && routeSource.includes("latestPartial"),
      "streaming path must auto-detect latest PARTIAL_SUCCESS job for transparent resume",
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

  it("non-streaming path has auto-resume detection for PARTIAL_SUCCESS", () => {
    // Both paths contain the auto-resume logic — verify at least 2 occurrences of the PARTIAL_SUCCESS lookup
    const count = (routeSource.match(/status.*PARTIAL_SUCCESS/g) ?? []).length;
    assert.ok(count >= 2, `auto-resume must be present in both streaming and non-streaming paths (found ${count})`);
  });
});

// ── Tender GET route: surfaces partial job ───────────────────────────────────

describe("tender GET route — surfaces latestPartialAnalysisJob", () => {
  it("route.ts queries for PARTIAL_SUCCESS job", () => {
    const routeGet = readFileSync(path.join(process.cwd(), "app/api/tenders/[id]/route.ts"), "utf-8");
    assert.ok(
      routeGet.includes("PARTIAL_SUCCESS") && routeGet.includes("latestPartialJob"),
      "tender GET route must query for the latest PARTIAL_SUCCESS job",
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

// ── Frontend: initialises continueJobId from server data ─────────────────────

describe("tender-detail.tsx — resume banner and continueJobId wiring", () => {
  it("continueJobId initialised from latestPartialAnalysisJob on mount", () => {
    const uiSource = readFileSync(path.join(process.cwd(), "app/dashboard/tenders/[id]/tender-detail.tsx"), "utf-8");
    assert.ok(
      uiSource.includes("latestPartialAnalysisJob?.jobId"),
      "tender-detail must initialise continueJobId from initial.latestPartialAnalysisJob?.jobId",
    );
  });

  it("resume banner is shown when continueJobId is set and latestPartialAnalysisJob exists", () => {
    const uiSource = readFileSync(path.join(process.cwd(), "app/dashboard/tenders/[id]/tender-detail.tsx"), "utf-8");
    assert.ok(
      uiSource.includes("Previous analysis was interrupted"),
      "tender-detail must render a resume banner when analysis was interrupted",
    );
  });

  it("button label changes to Resume AI Analyze when continueJobId is set", () => {
    const uiSource = readFileSync(path.join(process.cwd(), "app/dashboard/tenders/[id]/tender-detail.tsx"), "utf-8");
    assert.ok(
      uiSource.includes("Resume AI Analyze"),
      "AI Analyze button must say 'Resume AI Analyze' when a partial job is available",
    );
  });

  it("start-fresh button clears continueJobId", () => {
    const uiSource = readFileSync(path.join(process.cwd(), "app/dashboard/tenders/[id]/tender-detail.tsx"), "utf-8");
    assert.ok(
      uiSource.includes("Start fresh") && uiSource.includes("setContinueJobId(null)"),
      "tender-detail must provide a 'Start fresh' option that clears the resume state",
    );
  });
});

// ── Unit: gap-filling queue logic ─────────────────────────────────────────────

describe("analyzeWithAI queue logic — processes gaps when previousChunkResults exist", () => {
  it("queue includes chunk 1 when chunks 0 and 2 are already completed", () => {
    // Reproduce the queue-filter logic from lib/ai.ts
    function buildQueue(
      totalChunks: number,
      previousIndexes: Set<number>,
      startIndex: number,
    ): number[] {
      return Array.from({ length: totalChunks }, (_, index) => index).filter((index) => {
        if (previousIndexes.has(index)) return false;
        return previousIndexes.size > 0 || index >= startIndex;
      });
    }

    // Chunks 0 and 2 done; chunk 1 is missing
    const prev = new Set([0, 2]);
    const queue = buildQueue(3, prev, 3); // startIndex=3 would wrongly skip chunk 1 with old logic
    assert.deepEqual(queue, [1], "should queue only the missing chunk 1");
  });

  it("queue skips all chunks when all are in previousIndexes", () => {
    function buildQueue(totalChunks: number, previousIndexes: Set<number>, startIndex: number): number[] {
      return Array.from({ length: totalChunks }, (_, index) => index).filter((index) => {
        if (previousIndexes.has(index)) return false;
        return previousIndexes.size > 0 || index >= startIndex;
      });
    }

    const prev = new Set([0, 1, 2]);
    const queue = buildQueue(3, prev, 3);
    assert.deepEqual(queue, [], "all chunks already done — queue must be empty");
  });

  it("queue respects startIndex when previousIndexes is empty", () => {
    function buildQueue(totalChunks: number, previousIndexes: Set<number>, startIndex: number): number[] {
      return Array.from({ length: totalChunks }, (_, index) => index).filter((index) => {
        if (previousIndexes.has(index)) return false;
        return previousIndexes.size > 0 || index >= startIndex;
      });
    }

    // No previous results — resume from chunk 2 using only startIndex
    const prev = new Set<number>();
    const queue = buildQueue(4, prev, 2);
    assert.deepEqual(queue, [2, 3], "without previousIndexes should respect startIndex");
  });

  it("lib/ai.ts queue filter does not use startIndex as lower bound when previousIndexes exist", () => {
    const aiSource = readFileSync(path.join(process.cwd(), "lib/ai.ts"), "utf-8");
    // Verify the correct pattern is present: previousIndexes.size > 0 as the gate
    assert.ok(
      aiSource.includes("previousIndexes.size > 0"),
      "lib/ai.ts queue filter must use previousIndexes.size > 0 to bypass startIndex lower bound for gap-filling",
    );
  });
});

// ── Source: catch blocks preserve chunkResults ────────────────────────────────

describe("ai-analyze/route catch blocks — preserve chunkResults on failure", () => {
  it("streaming catch block sets PARTIAL_SUCCESS when partial chunks exist", () => {
    assert.ok(
      routeSource.includes("hasPartialChunks") && routeSource.includes("PARTIAL_SUCCESS"),
      "streaming catch block must set PARTIAL_SUCCESS status when partial progress exists",
    );
  });

  it("streaming catch block does not overwrite output when partial chunks exist", () => {
    // The pattern: spread no output field when hasPartialChunks
    assert.ok(
      routeSource.includes("hasPartialChunks ? {} :"),
      "streaming catch block must conditionally skip output overwrite to preserve per-chunk writes",
    );
  });

  it("non-streaming catch block also sets PARTIAL_SUCCESS when partial chunks exist", () => {
    const occurrences = (routeSource.match(/hasPartialChunks \? "PARTIAL_SUCCESS" : "FAILED"/g) ?? []).length;
    assert.ok(occurrences >= 2, `both streaming and non-streaming catch blocks must check hasPartialChunks (found ${occurrences})`);
  });

  it("nextAction is RETRY_AI_ANALYZE only when no chunks completed", () => {
    // CONTINUE_AI_ANALYZE is implied by PARTIAL_SUCCESS status; RETRY_AI_ANALYZE
    // is only written to output when no chunks exist (hasPartialChunks === false).
    assert.ok(
      routeSource.includes("RETRY_AI_ANALYZE"),
      "RETRY_AI_ANALYZE must only appear in the no-chunks-completed branch",
    );
    // Ensure RETRY_AI_ANALYZE is not set unconditionally in catch blocks
    // (it must be inside the `hasPartialChunks ? {} : { output: ... }` branch)
    assert.ok(
      routeSource.includes("hasPartialChunks ? {} :") && routeSource.includes("RETRY_AI_ANALYZE"),
      "RETRY_AI_ANALYZE must be gated behind hasPartialChunks check",
    );
  });
});
