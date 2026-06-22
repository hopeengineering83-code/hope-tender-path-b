import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateGenerationReadiness,
  type GenerationReadinessInput,
  type ReadinessRequirement,
} from "../lib/engine/generation-readiness-gate";

// A fully-ready baseline. Each test mutates exactly one fact to prove that
// fact's blocker fires, and that the baseline itself passes.

function groundedMandatory(): ReadinessRequirement {
  return {
    priority: "MANDATORY",
    sourceTenderFileId: "file-1",
    sourcePageNumber: 3,
    sourceExactQuote: "The bidder shall submit audited financial statements.",
    sourceFileActiveInTender: true,
  };
}

function ready(overrides: Partial<GenerationReadinessInput> = {}): GenerationReadinessInput {
  return {
    purpose: "generate",
    tenderExistsAndOwned: true,
    activeFileCount: 1,
    analysisState: "AI_SUCCEEDED",
    canonicalJobId: "job-1",
    latestJobHash: "hash-current",
    currentContentHash: "hash-current",
    currentHashChunks: [
      { status: "SUCCEEDED", totalChunks: 2 },
      { status: "SUCCEEDED", totalChunks: 2 },
    ],
    requirementCount: 1,
    requirements: [groundedMandatory()],
    submissionPlanConfirmed: true,
    submissionPlanDerivedDocumentCount: 4,
    ...overrides,
  };
}

test("baseline: a fully-ready tender passes the gate", () => {
  const r = evaluateGenerationReadiness(ready());
  assert.equal(r.ok, true, JSON.stringify(r));
});

// 1. No AI Analyze job blocks generation.
test("1. NOT_STARTED analysis blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ analysisState: "NOT_STARTED", canonicalJobId: null }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "ANALYSIS_NOT_READY");
});

// 2. QUEUED job blocks generation.
test("2. QUEUED analysis blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ analysisState: "QUEUED", canonicalJobId: null }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "ANALYSIS_NOT_READY");
});

// 3. RUNNING job blocks generation.
test("3. RUNNING analysis blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ analysisState: "RUNNING", canonicalJobId: null }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "ANALYSIS_NOT_READY");
});

// 4. FAILED job blocks generation.
test("4. FAILED analysis blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ analysisState: "FAILED", canonicalJobId: null }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "ANALYSIS_NOT_READY");
});

// 5. PARTIAL_SUCCESS (PARTIAL_NEEDS_RESUME) job blocks generation.
test("5. PARTIAL_NEEDS_RESUME analysis blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ analysisState: "PARTIAL_NEEDS_RESUME", canonicalJobId: null }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "ANALYSIS_NOT_READY");
});

// 6. Superseded job blocks generation.
test("6. SUPERSEDED analysis blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ analysisState: "SUPERSEDED", canonicalJobId: null }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "ANALYSIS_NOT_READY");
});

// 7. Current hash mismatch blocks generation.
test("7. content-hash mismatch blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ latestJobHash: "hash-old", currentContentHash: "hash-new" }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "ANALYSIS_HASH_MISMATCH");
});

// 8. Missing promotedAt (no canonical job) blocks generation.
test("8. missing canonical promotion blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ canonicalJobId: null }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "ANALYSIS_NO_PROMOTED_JOB");
});

// 9. Missing chunk blocks generation (succeeded < expected totalChunks).
test("9. missing chunk blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({
    currentHashChunks: [{ status: "SUCCEEDED", totalChunks: 3 }],
  }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "CHUNKS_INCOMPLETE");
});

// 10. Failed chunk blocks generation.
test("10. failed chunk blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({
    currentHashChunks: [
      { status: "SUCCEEDED", totalChunks: 2 },
      { status: "FAILED", totalChunks: 2 },
    ],
  }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "CHUNKS_INCOMPLETE");
});

// 11. Missing requirement source fields block generation.
test("11. ungrounded mandatory requirement (no source file) blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({
    requirements: [{ ...groundedMandatory(), sourceTenderFileId: null, sourceFileActiveInTender: false }],
  }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
});

test("11b. empty/short source quote blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({
    requirements: [{ ...groundedMandatory(), sourceExactQuote: "n/a" }],
  }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
});

test("11c. missing page number blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({
    requirements: [{ ...groundedMandatory(), sourcePageNumber: null }],
  }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
});

// 12. Cross-tender source file blocks generation (file not active in THIS tender).
test("12. cross-tender source file blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({
    requirements: [{ ...groundedMandatory(), sourceFileActiveInTender: false }],
  }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
});

// 13. Deleted/inactive source file blocks generation (no active files at all).
test("13. no active tender file blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ activeFileCount: 0 }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "EXTRACTION_NO_ACTIVE_FILE");
});

// 14. Missing evidence/requirements blocks generation.
test("14. zero requirements block generation", () => {
  const r = evaluateGenerationReadiness(ready({ requirementCount: 0, requirements: [] }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "REQUIREMENTS_MISSING");
});

// 15. Missing or unapproved Build Plan blocks generation.
test("15. unconfirmed submission plan blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ submissionPlanConfirmed: false }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "SUBMISSION_PLAN_MISSING");
});

test("15b. empty submission plan blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ submissionPlanDerivedDocumentCount: 0 }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "SUBMISSION_PLAN_EMPTY");
});

// 16. Unapproved regex fallback blocks generation.
test("16. unapproved regex fallback blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ analysisState: "REGEX_FALLBACK_UNAPPROVED", canonicalJobId: null }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "FALLBACK_UNAPPROVED");
});

// 17. Fallback approval from a previous hash blocks generation.
//     A human-approved fallback whose promoted-job hash no longer matches the
//     current content hash must NOT authorize.
test("17. approved fallback from a previous hash blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({
    analysisState: "HUMAN_APPROVED_FALLBACK",
    canonicalJobId: "job-old",
    latestJobHash: "hash-old",
    currentContentHash: "hash-new",
  }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "ANALYSIS_HASH_MISMATCH");
});

// 18. Exact approved fallback for current job/hash passes only when all else passes.
test("18. human-approved fallback bound to current hash passes when all else is ready", () => {
  const r = evaluateGenerationReadiness(ready({
    analysisState: "HUMAN_APPROVED_FALLBACK",
    canonicalJobId: "job-1",
    latestJobHash: "hash-current",
    currentContentHash: "hash-current",
  }));
  assert.equal(r.ok, true, JSON.stringify(r));
});

test("18b. approved fallback bound to current hash STILL blocks when plan is empty", () => {
  const r = evaluateGenerationReadiness(ready({
    analysisState: "HUMAN_APPROVED_FALLBACK",
    submissionPlanDerivedDocumentCount: 0,
  }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "SUBMISSION_PLAN_EMPTY");
});

// 19. Background PROPOSAL_GENERATION purpose is gated the same way.
test("19. background-proposal-generation is blocked by the same conditions", () => {
  const blocked = evaluateGenerationReadiness(ready({
    purpose: "background-proposal-generation",
    analysisState: "FAILED",
    canonicalJobId: null,
  }));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.purpose, "background-proposal-generation");
  const ok = evaluateGenerationReadiness(ready({ purpose: "background-proposal-generation" }));
  assert.equal(ok.ok, true);
});

// 20. Export / final-zip enforce the same gate.
test("20. export and final-zip are blocked on stale/partial/unready analysis", () => {
  for (const purpose of ["export", "final-zip"] as const) {
    const stale = evaluateGenerationReadiness(ready({ purpose, latestJobHash: "old", currentContentHash: "new" }));
    assert.equal(stale.ok, false, `${purpose} stale must block`);
    assert.equal(stale.blockerCode, "ANALYSIS_HASH_MISMATCH");

    const partial = evaluateGenerationReadiness(ready({ purpose, analysisState: "PARTIAL_NEEDS_RESUME", canonicalJobId: null }));
    assert.equal(partial.ok, false, `${purpose} partial must block`);

    const fine = evaluateGenerationReadiness(ready({ purpose }));
    assert.equal(fine.ok, true, `${purpose} ready must pass`);
  }
});

// Ownership is the first fail-closed condition.
test("ownership failure blocks before any other check", () => {
  const r = evaluateGenerationReadiness(ready({ tenderExistsAndOwned: false, analysisState: "FAILED" }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "OWNERSHIP_TENDER_NOT_FOUND");
});

// Single-shot success (zero chunk rows) is valid when state is promoted+ready.
test("zero chunk rows (single-shot success) is acceptable", () => {
  const r = evaluateGenerationReadiness(ready({ currentHashChunks: [] }));
  assert.equal(r.ok, true, JSON.stringify(r));
});
