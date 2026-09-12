// P0 — single canonical AI input: AiJob.analysisInputHash is overloaded, so the
// job-type filter in front of it is load-bearing and must stay that way.
//
// The column carries two different things depending on job type:
//
//   AI_ANALYZE    computeAnalysisContentHash(tenderText) — the canonical
//                 analysis input, hashed once at manual creation before any
//                 provider is dispatched, and frozen into CanonicalAnalysisSnapshot.
//   EXTRACT_TEXT  stableHash(payload) — the extraction job's own input payload
//                 (lib/ai-jobs/tender-extraction-service.ts).
//
// Both are non-null hex strings, so nothing about the VALUE distinguishes them.
// The only thing keeping an extraction payload hash from being adopted as an
// analysis revision is that every consumer checks jobType first. That check is
// therefore a correctness boundary, not a formality: if it were dropped or
// reordered behind the hash check, the Engine would bind downstream generation
// to a revision that never described the analysed content, and every artifact
// derived from it would carry a provenance claim that was never true.
//
// evaluateEngineContinuation is pure, so these assert the real decision
// function rather than a description of it.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { evaluateEngineContinuation } from "../lib/ai-jobs/engine-continuation-service";

/** A record that is valid in every respect except where a test varies it. */
function validAnalysis(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    jobType: "AI_ANALYZE",
    status: "SUCCEEDED",
    userId: "user-1",
    tenderId: "tender-1",
    analysisInputHash: "a".repeat(64),
    promotedAt: new Date(),
    supersededBy: null,
    input: JSON.stringify({ manualRequested: true }),
    tenderOwnedByUser: true,
    companyId: "company-1",
    ...overrides,
  } as Parameters<typeof evaluateEngineContinuation>[0];
}

describe("analysisInputHash is only honoured on an AI_ANALYZE job", () => {
  it("rejects an EXTRACT_TEXT job even though it carries a hash", () => {
    // This is the exact confusion the overloaded column allows: an extraction
    // job whose analysisInputHash is a stableHash of its own payload.
    const result = evaluateEngineContinuation(validAnalysis({ jobType: "EXTRACT_TEXT" }));
    assert.equal(
      result.reason,
      "NOT_AI_ANALYSIS",
      "an extraction payload hash must never be adopted as an analysis revision",
    );
    assert.equal(result.queued, false);
  });

  it("rejects every other job type that could carry the column", () => {
    for (const jobType of ["ENGINE_RUN", "PROPOSAL_GENERATION", "VAULT_INGEST", "AUTO_FINALIZE"]) {
      const result = evaluateEngineContinuation(validAnalysis({ jobType }));
      assert.equal(result.reason, "NOT_AI_ANALYSIS", `${jobType} must not supply an analysis revision`);
    }
  });

  it("checks job type BEFORE the hash, so a missing hash cannot mask a wrong type", () => {
    // If the ordering were reversed, an EXTRACT_TEXT job with no hash would
    // report ANALYSIS_REVISION_MISSING — a recoverable-looking reason that
    // invites a caller to supply a hash and retry, quietly promoting the wrong
    // job type. The type error must win.
    const result = evaluateEngineContinuation(
      validAnalysis({ jobType: "EXTRACT_TEXT", analysisInputHash: null }),
    );
    assert.equal(result.reason, "NOT_AI_ANALYSIS");
  });

  it("still requires a hash on a genuine AI_ANALYZE job", () => {
    const result = evaluateEngineContinuation(validAnalysis({ analysisInputHash: null }));
    assert.equal(result.reason, "ANALYSIS_REVISION_MISSING");
  });

  it("refuses a superseded analysis even when everything else is valid", () => {
    const result = evaluateEngineContinuation(validAnalysis({ supersededBy: "job-2" }));
    assert.equal(
      result.reason,
      "ANALYSIS_SUPERSEDED",
      "a superseded revision must never be able to authorise downstream work",
    );
  });

  it("refuses an unpromoted or non-succeeded analysis", () => {
    assert.equal(evaluateEngineContinuation(validAnalysis({ promotedAt: null })).reason, "ANALYSIS_NOT_PROMOTED");
    assert.equal(evaluateEngineContinuation(validAnalysis({ status: "PARTIAL_SUCCESS" })).reason, "ANALYSIS_NOT_SUCCEEDED");
    assert.equal(evaluateEngineContinuation(validAnalysis({ status: "FAILED" })).reason, "ANALYSIS_NOT_SUCCEEDED");
  });

  it("reaches the manual gate only when the whole chain is satisfied", () => {
    const result = evaluateEngineContinuation(validAnalysis());
    assert.equal(
      result.reason,
      "MANUAL_ENGINE_REQUIRED",
      "a fully valid analysis must still stop at the explicit Run Engine action",
    );
    assert.equal(result.queued, false);
  });
});
