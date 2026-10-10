import assert from "node:assert/strict";
import test from "node:test";
import { resolveCanonicalAnalysisPresentation } from "../components/analysis-quality-panel";
import type { SnapshotAnalysisState } from "../lib/engine/tender-release-snapshot";

function analysis(overrides: Partial<SnapshotAnalysisState> = {}): SnapshotAnalysisState {
  return {
    state: "AI_SUCCEEDED",
    canonicalJobId: "analysis-job-current",
    latestJobHash: "canonical-hash",
    currentContentHash: "canonical-hash",
    contentHashMatch: true,
    eligibleForExport: true,
    blocker: null,
    ...overrides,
  };
}

test("Analysis Quality trusts only current promoted canonical AI analysis", () => {
  const current = resolveCanonicalAnalysisPresentation(analysis());
  assert.equal(current.current, true);
  assert.equal(current.rawSource, "AI");
  assert.equal(current.source.label, "AI");
  assert.doesNotMatch(current.source.label, /Not current/i);

  const hashMismatch = resolveCanonicalAnalysisPresentation(analysis({
    latestJobHash: "stale-hash",
    contentHashMatch: false,
    eligibleForExport: false,
    blocker: "Tender content changed since the last analysis.",
  }));
  assert.equal(hashMismatch.current, false);
  assert.equal(hashMismatch.source.label, "Not current");

  const superseded = resolveCanonicalAnalysisPresentation(analysis({
    state: "SUPERSEDED",
    canonicalJobId: null,
    contentHashMatch: false,
    eligibleForExport: false,
  }));
  assert.equal(superseded.current, false);
  assert.equal(superseded.source.label, "Not current");
});
