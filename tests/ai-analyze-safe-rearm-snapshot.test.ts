import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canSafelyReuseAnalysisSnapshot, type CanonicalAnalysisSnapshot } from "../lib/ai-jobs/analysis-job-service";

const current: CanonicalAnalysisSnapshot = {
  canonicalFileIds: ["file-a"],
  fileContentHashes: { "file-a": "text-hash" },
  fileSourceByteHashes: { "file-a": "byte-hash" },
  analysisInputHash: "analysis-hash",
  totalChunks: 1,
  chunkHashes: { 0: "chunk-hash" },
  snapshotVersion: 1,
};

describe("manual AI Analyze snapshot reuse", () => {
  it("reuses chunks only when every frozen identity matches", () => {
    assert.equal(canSafelyReuseAnalysisSnapshot(JSON.stringify({ snapshot: current }), current), true);
  });

  it("fails closed for legacy or incomplete byte provenance", () => {
    const { fileSourceByteHashes: _omitted, ...legacy } = current;
    assert.equal(canSafelyReuseAnalysisSnapshot(JSON.stringify({ snapshot: legacy }), current), false);
    assert.equal(canSafelyReuseAnalysisSnapshot("{}", current), false);
    assert.equal(canSafelyReuseAnalysisSnapshot("invalid", current), false);
  });

  it("rejects file, extracted-text, source-byte, input or chunk drift", () => {
    const cases: CanonicalAnalysisSnapshot[] = [
      { ...current, canonicalFileIds: ["file-b"] },
      { ...current, fileContentHashes: { "file-a": "changed" } },
      { ...current, fileSourceByteHashes: { "file-a": "changed" } },
      { ...current, analysisInputHash: "changed" },
      { ...current, chunkHashes: { 0: "changed" } },
    ];
    for (const old of cases) {
      assert.equal(canSafelyReuseAnalysisSnapshot(JSON.stringify({ snapshot: old }), current), false);
    }
  });
});
