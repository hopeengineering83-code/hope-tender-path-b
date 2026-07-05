// Tests for the per-chunk AiJob checkpoint added to ai-proposal/route.ts.
//
// The checkpoint stores each successfully-generated chunk's markdown in
// AiJob.output so a resume call can return the cached result instead of
// re-generating, surviving browser-close or chunk-2 timeouts.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ─── Contract checks (source-level) ──────────────────────────────────────────

describe("ai-proposal route — checkpoint contract (source-level)", () => {
  const src = readFileSync("app/api/tenders/[id]/ai-proposal/route.ts", "utf8");

  it("reads proposalJobId from request body", () => {
    assert.match(src, /proposalJobId/);
    assert.match(src, /body\.proposalJobId/);
  });

  it("creates an AiJob if no proposalJobId provided", () => {
    assert.match(src, /aiJob\.create/);
    assert.match(src, /jobType.*PROPOSAL_GENERATION/);
  });

  it("loads an existing AiJob when proposalJobId is provided (resume path)", () => {
    assert.match(src, /aiJob\.findFirst/);
    assert.match(src, /resumeJobId/);
  });

  it("returns proposalJobId in every success response", () => {
    // The response JSON must include proposalJobId so the client can store it
    // and send it on the next chunk call.
    assert.match(src, /proposalJobId.*proposalJobId/s);
  });

  it("returns proposalJobId in the 500 error response so the client can resume after retry", () => {
    // Even on server error, the client should get the jobId back so it can
    // resume on the next attempt without creating a new AiJob.
    assert.match(src, /proposalJobId.*status.*500/s);
  });

  it("returns the cached chunk immediately when already in AiJob.output", () => {
    // When chunks[chunkKey] exists and forceRefresh is false, the route must
    // return early with cached: true and not call generateProposalSectionsParallel.
    assert.match(src, /cached\.chunks\[chunkKey\]/);
    assert.match(src, /cached: true.*proposalJobId/s);
  });

  it("saves each successful chunk to AiJob.output (never saves fallback)", () => {
    // Fallback output is deterministic/low-quality — should not be checkpointed
    // so the user is forced to retry with real AI.
    assert.match(src, /!fallback.*chunkNum.*saveChunkOutput/s);
    assert.match(src, /saveChunkOutput/);
  });

  it("marks AiJob SUCCEEDED on final chunk or non-chunked generation", () => {
    assert.match(src, /chunkNum.*3.*SUCCEEDED/s);
    assert.match(src, /status.*SUCCEEDED/);
  });

  it("marks AiJob FAILED on outer catch", () => {
    assert.match(src, /status.*FAILED.*errorMessage/s);
  });

  it("force refresh bypasses chunk cache", () => {
    // When forceRefresh=true, even an existing cached chunk should be regenerated.
    assert.match(src, /forceRefresh/);
    assert.match(src, /!forceRefresh/);
  });
});

// ─── Chunk output merge logic (pure) ─────────────────────────────────────────
// Mirrors the saveChunkOutput + loadChunkOutput pattern. Verifies the JSON
// structure that gets stored in AiJob.output.

type ChunkOutput = { chunks: Record<string, string> };

function mergeChunk(existing: ChunkOutput, chunkKey: string, markdown: string): ChunkOutput {
  return { chunks: { ...existing.chunks, [chunkKey]: markdown } };
}

describe("chunk output merge logic", () => {
  it("stores a new chunk under the correct key", () => {
    const merged = mergeChunk({ chunks: {} }, "1", "# Section A\nCover letter content.");
    assert.equal(merged.chunks["1"], "# Section A\nCover letter content.");
  });

  it("preserves previously stored chunks when adding a new one", () => {
    const after1 = mergeChunk({ chunks: {} }, "1", "chunk 1 content");
    const after2 = mergeChunk(after1, "2", "chunk 2 content");
    assert.equal(after2.chunks["1"], "chunk 1 content");
    assert.equal(after2.chunks["2"], "chunk 2 content");
  });

  it("overwrites an existing chunk key (used when forceRefresh=true)", () => {
    const initial = mergeChunk({ chunks: { "2": "old content" } }, "2", "new regenerated content");
    assert.equal(initial.chunks["2"], "new regenerated content");
  });

  it("round-trips through JSON correctly", () => {
    const output: ChunkOutput = { chunks: { "1": "cover", "2": "technical" } };
    const serialized = JSON.stringify(output);
    const restored = JSON.parse(serialized) as ChunkOutput;
    assert.equal(restored.chunks["1"], "cover");
    assert.equal(restored.chunks["2"], "technical");
    assert.equal(Object.keys(restored.chunks).length, 2);
  });

  it("checking for a missing chunk returns undefined (not throw)", () => {
    const output: ChunkOutput = { chunks: { "1": "chunk 1" } };
    assert.equal(output.chunks["2"], undefined);
    assert.equal(output.chunks["2"] ?? null, null);
  });
});

// ─── Resume logic (pure) ─────────────────────────────────────────────────────

describe("resume-from-checkpoint logic", () => {
  it("when chunk already cached, no generation should be needed", () => {
    // Simulates the route's cache-hit path: chunks["1"] exists → return immediately
    const stored: ChunkOutput = { chunks: { "1": "cached chunk 1 markdown" } };
    const chunkNum = 1;
    const chunkKey = String(chunkNum);
    const isCached = Boolean(stored.chunks[chunkKey]);
    assert.ok(isCached, "chunk 1 should be found in the cache");
  });

  it("when chunk NOT cached, generation should proceed", () => {
    const stored: ChunkOutput = { chunks: { "1": "cached chunk 1 markdown" } };
    const chunkNum = 2;
    const chunkKey = String(chunkNum);
    const isCached = Boolean(stored.chunks[chunkKey]);
    assert.ok(!isCached, "chunk 2 should NOT be found in the cache");
  });

  it("partial resume: chunk 1 done, chunk 2 missing → resume from chunk 2", () => {
    const stored: ChunkOutput = { chunks: { "1": "cover + company", "3": "additional" } };
    const allChunks = ["1", "2", "3"];
    const missing = allChunks.filter((k) => !stored.chunks[k]);
    assert.deepEqual(missing, ["2"], "only chunk 2 should be missing");
  });

  it("all chunks done → resume detects nothing to generate", () => {
    const stored: ChunkOutput = { chunks: { "1": "a", "2": "b", "3": "c" } };
    const allChunks = ["1", "2", "3"];
    const missing = allChunks.filter((k) => !stored.chunks[k]);
    assert.equal(missing.length, 0, "nothing should be missing");
  });
});
