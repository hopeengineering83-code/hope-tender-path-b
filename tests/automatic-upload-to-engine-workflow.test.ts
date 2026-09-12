import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  continueSuccessfulAnalysis,
  engineContinuationRunId,
  evaluateEngineContinuation,
  type AnalysisContinuationRecord,
} from "../lib/ai-jobs/engine-continuation-service";

function analysis(overrides: Partial<AnalysisContinuationRecord> = {}): AnalysisContinuationRecord {
  return {
    id: "analysis-1",
    jobType: "AI_ANALYZE",
    status: "SUCCEEDED",
    userId: "user-1",
    tenderId: "tender-1",
    analysisInputHash: "revision-a",
    promotedAt: new Date("2026-07-24T00:00:00.000Z"),
    supersededBy: null,
    input: JSON.stringify({ autoContinue: true }),
    tenderOwnedByUser: true,
    companyId: "company-1",
    ...overrides,
  };
}

describe("engine continuation — MANUAL ENGINE BOUNDARY", () => {
  it("SUCCEEDED plus autoContinue=true does NOT enqueue an Engine job", () => {
    const result = evaluateEngineContinuation(analysis());
    assert.equal(result.queued, false);
    assert.equal(result.reason, "MANUAL_ENGINE_REQUIRED");
  });

  it("missing autoContinue does NOT enqueue an Engine job", () => {
    const result = evaluateEngineContinuation(analysis({ input: JSON.stringify({ source: "manual-analysis" }) }));
    assert.equal(result.queued, false);
    assert.equal(result.reason, "MANUAL_ENGINE_REQUIRED");
  });

  it("PARTIAL_SUCCESS does NOT enqueue an Engine job", () => {
    const result = evaluateEngineContinuation(analysis({ status: "PARTIAL_SUCCESS" }));
    assert.equal(result.queued, false);
    assert.equal(result.reason, "ANALYSIS_NOT_SUCCEEDED");
  });

  it("FAILED does NOT enqueue an Engine job", () => {
    const result = evaluateEngineContinuation(analysis({ status: "FAILED" }));
    assert.equal(result.queued, false);
    assert.equal(result.reason, "ANALYSIS_NOT_SUCCEEDED");
  });

  it("forged autoContinue=true cannot start Engine", () => {
    const forged = analysis({ input: JSON.stringify({ autoContinue: true, source: "forged" }) });
    const result = evaluateEngineContinuation(forged);
    assert.equal(result.queued, false);
    assert.equal(result.reason, "MANUAL_ENGINE_REQUIRED");
  });

  it("stale analysis (superseded) cannot start Engine", () => {
    const result = evaluateEngineContinuation(analysis({ supersededBy: "analysis-2" }));
    assert.equal(result.queued, false);
    assert.equal(result.reason, "ANALYSIS_SUPERSEDED");
  });

  it("unpromoted analysis cannot start Engine", () => {
    const result = evaluateEngineContinuation(analysis({ promotedAt: null }));
    assert.equal(result.queued, false);
    assert.equal(result.reason, "ANALYSIS_NOT_PROMOTED");
  });

  it("cross-tenant analysis cannot start Engine", () => {
    const result = evaluateEngineContinuation(analysis({ tenderOwnedByUser: false }));
    assert.equal(result.queued, false);
    assert.equal(result.reason, "TENDER_OR_COMPANY_OWNERSHIP_INVALID");
  });

  it("engineContinuationRunId is deterministic for the same inputs", () => {
    const runId1 = engineContinuationRunId({
      companyId: "company-1",
      tenderId: "tender-1",
      userId: "user-1",
      analysisRevision: "revision-a",
    });
    const runId2 = engineContinuationRunId({
      companyId: "company-1",
      tenderId: "tender-1",
      userId: "user-1",
      analysisRevision: "revision-a",
    });
    assert.equal(runId1, runId2);
    assert.match(runId1, /^pipeline:engine:/);
  });
});
