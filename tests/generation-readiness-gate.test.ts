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
    sourceFileActiveInTender: true, sourceFileExtractedText: "This tender document contains the following: The bidder shall submit audited financial statements.. Additional context for the tender file extraction.",
  };
}

function ready(overrides: Partial<GenerationReadinessInput> = {}): GenerationReadinessInput {
  return {
    purpose: "generate",
    tenderExistsAndOwned: true,
    activeFileCount: 1,
    extractionFiles: [{ fileId: "file-1", corrupted: false, weak: false, hasOverride: false }],
    analysisState: "AI_SUCCEEDED",
    canonicalJobId: "job-1",
    latestJobHash: "hash-current",
    currentContentHash: "hash-current",
    fallbackApprovalBound: false,
    currentHashChunks: [
      { status: "SUCCEEDED", totalChunks: 2 },
      { status: "SUCCEEDED", totalChunks: 2 },
    ],
    requirementCount: 1,
    requirements: [groundedMandatory()], exportReadyDocumentCount: 5,
    criticalMetadataOk: true,
    // BuildPlan enforcement is fail-closed: undefined blocks the same as false.
    // Default to true so the "ready" base case actually passes; tests that
    // exercise the BuildPlan-confirmed blocker override this to false.
    hasCurrentConfirmedBuildPlan: true,
    confirmedBuildPlanItemsValid: true,
    confirmedPlanDocumentsOk: true,
    ...overrides,
  };
}

test("baseline: a fully-ready tender passes the gate", () => {
  const r = evaluateGenerationReadiness(ready());
  assert.equal(r.ok, true, JSON.stringify(r));
});

// 1–6. Analysis state must be export-eligible.
test("1. NOT_STARTED analysis blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ analysisState: "NOT_STARTED", canonicalJobId: null }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "ANALYSIS_NOT_READY");
});

test("2. QUEUED analysis blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ analysisState: "QUEUED", canonicalJobId: null }));
  assert.equal(r.blockerCode, "ANALYSIS_NOT_READY");
});

test("3. RUNNING analysis blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ analysisState: "RUNNING", canonicalJobId: null }));
  assert.equal(r.blockerCode, "ANALYSIS_NOT_READY");
});

test("4. FAILED analysis blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ analysisState: "FAILED", canonicalJobId: null }));
  assert.equal(r.blockerCode, "ANALYSIS_NOT_READY");
});

test("5. PARTIAL_NEEDS_RESUME analysis blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ analysisState: "PARTIAL_NEEDS_RESUME", canonicalJobId: null }));
  assert.equal(r.blockerCode, "ANALYSIS_NOT_READY");
});

test("6. SUPERSEDED analysis blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ analysisState: "SUPERSEDED", canonicalJobId: null }));
  assert.equal(r.blockerCode, "ANALYSIS_NOT_READY");
});

// 7. Current hash mismatch blocks generation (for export/final-zip only).
//    Draft generation does NOT hard-block on hash mismatch — it's a warning.
test("7. content-hash mismatch blocks export (not draft)", () => {
  const r = evaluateGenerationReadiness(ready({ latestJobHash: "hash-old", currentContentHash: "hash-new", purpose: "export" }));
  assert.equal(r.blockerCode, "ANALYSIS_HASH_MISMATCH");
});

// 8. Missing promotedAt (no canonical job) blocks generation.
test("8. missing canonical promotion blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ canonicalJobId: null }));
  assert.equal(r.blockerCode, "LEGACY_ANALYSIS_BLOCKED");
});

// 9. Missing chunk blocks generation (succeeded < expected totalChunks).
test("9. missing chunk blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ currentHashChunks: [{ status: "SUCCEEDED", totalChunks: 3 }] }));
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
  assert.equal(r.blockerCode, "CHUNKS_INCOMPLETE");
});

// 11. Missing requirement source fields block generation.
test("11. ungrounded mandatory requirement (no source file) blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({
    requirements: [{ ...groundedMandatory(), sourceTenderFileId: null, sourceFileActiveInTender: false }],
  }));
  assert.equal(r.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
});

test("11b. empty/short source quote blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ requirements: [{ ...groundedMandatory(), sourceExactQuote: "n/a" }] }));
  assert.equal(r.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
});

test("11c. missing page number blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ requirements: [{ ...groundedMandatory(), sourcePageNumber: null }] }));
  assert.equal(r.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
});

// 12. Cross-tender source file blocks generation (file not active in THIS tender).
test("12. cross-tender source file blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ requirements: [{ ...groundedMandatory(), sourceFileActiveInTender: false }] }));
  assert.equal(r.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
});

// 13. Deleted/inactive source file → no active files at all.
test("13. no active tender file blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ activeFileCount: 0, extractionFiles: [] }));
  assert.equal(r.blockerCode, "EXTRACTION_NO_ACTIVE_FILE");
});

// 14. Missing requirements blocks generation.
test("14. zero requirements block generation", () => {
  const r = evaluateGenerationReadiness(ready({ requirementCount: 0, requirements: [] }));
  assert.equal(r.blockerCode, "REQUIREMENTS_MISSING");
});

// 15. Missing Build Plan blocks generation (no plan/generated documents).
test("15. no BuildPlan blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ hasCurrentConfirmedBuildPlan: false, recordedBuildPlanState: "MISSING", exportReadyDocumentCount: 0 }));
  assert.equal(r.blockerCode, "BUILD_PLAN_MISSING");
});

// 16. Unapproved regex fallback blocks generation.
test("16. unapproved regex fallback blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({ analysisState: "REGEX_FALLBACK_UNAPPROVED", canonicalJobId: null }));
  assert.equal(r.blockerCode, "FALLBACK_UNAPPROVED");
});

// 17. HUMAN_APPROVED_FALLBACK is now always blocked — even when hash matched.
test("17. HUMAN_APPROVED_FALLBACK blocks regardless of hash (fallback no longer allowed)", () => {
  const r = evaluateGenerationReadiness(ready({
    analysisState: "HUMAN_APPROVED_FALLBACK",
    canonicalJobId: "job-old",
    latestJobHash: "hash-old",
    currentContentHash: "hash-new",
    fallbackApprovalBound: false,
  }));
  assert.equal(r.blockerCode, "FALLBACK_NOT_ALLOWED");
});

// 17b. HUMAN_APPROVED_FALLBACK blocked regardless of approval binding.
test("17b. HUMAN_APPROVED_FALLBACK blocks even with fallbackApprovalBound=false", () => {
  const r = evaluateGenerationReadiness(ready({
    analysisState: "HUMAN_APPROVED_FALLBACK",
    fallbackApprovalBound: false,
  }));
  assert.equal(r.blockerCode, "FALLBACK_NOT_ALLOWED");
});

// 18. HUMAN_APPROVED_FALLBACK is now always blocked — no bound approval can override it.
test("18. HUMAN_APPROVED_FALLBACK blocked even when fallbackApprovalBound=true", () => {
  const r = evaluateGenerationReadiness(ready({
    analysisState: "HUMAN_APPROVED_FALLBACK",
    fallbackApprovalBound: true,
  }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "FALLBACK_NOT_ALLOWED");
});

test("18b. HUMAN_APPROVED_FALLBACK blocks before submission-plan check", () => {
  const r = evaluateGenerationReadiness(ready({
    analysisState: "HUMAN_APPROVED_FALLBACK",
    fallbackApprovalBound: true, exportReadyDocumentCount: 5,
  }));
  assert.equal(r.blockerCode, "FALLBACK_NOT_ALLOWED");
});

// 19. Background PROPOSAL_GENERATION purpose is gated the same way.
test("19. background-proposal-generation is blocked by the same conditions", () => {
  const blocked = evaluateGenerationReadiness(ready({ purpose: "background-proposal-generation", analysisState: "FAILED", canonicalJobId: null }));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.purpose, "background-proposal-generation");
  const ok = evaluateGenerationReadiness(ready({ purpose: "background-proposal-generation" }));
  assert.equal(ok.ok, true);
});

// 20. Export / final-zip enforce the same gate.
test("20. export and final-zip are blocked on stale/partial/unready analysis", () => {
  for (const purpose of ["export", "final-zip"] as const) {
    const stale = evaluateGenerationReadiness(ready({ purpose, latestJobHash: "old", currentContentHash: "new" }));
    assert.equal(stale.blockerCode, "ANALYSIS_HASH_MISMATCH", `${purpose} stale must block`);
    const partial = evaluateGenerationReadiness(ready({ purpose, analysisState: "PARTIAL_NEEDS_RESUME", canonicalJobId: null }));
    assert.equal(partial.ok, false, `${purpose} partial must block`);
    const fine = evaluateGenerationReadiness(ready({ purpose }));
    assert.equal(fine.ok, true, `${purpose} ready must pass`);
  }
});

// Extraction quality (condition B).
test("corrupted extraction is a hard block (never overridable)", () => {
  const r = evaluateGenerationReadiness(ready({
    extractionFiles: [{ fileId: "file-1", corrupted: true, weak: false, hasOverride: true }],
  }));
  assert.equal(r.blockerCode, "EXTRACTION_CORRUPTED");
});

test("weak extraction without an override blocks generation", () => {
  const r = evaluateGenerationReadiness(ready({
    extractionFiles: [{ fileId: "file-1", corrupted: false, weak: true, hasOverride: false }],
  }));
  assert.equal(r.blockerCode, "EXTRACTION_WEAK_NO_OVERRIDE");
});

test("weak extraction WITH a valid override passes", () => {
  const r = evaluateGenerationReadiness(ready({
    extractionFiles: [{ fileId: "file-1", corrupted: false, weak: true, hasOverride: true }],
  }));
  assert.equal(r.ok, true, JSON.stringify(r));
});

// Ownership is the first fail-closed condition.
test("ownership failure blocks before any other check", () => {
  const r = evaluateGenerationReadiness(ready({ tenderExistsAndOwned: false, analysisState: "FAILED" }));
  assert.equal(r.blockerCode, "OWNERSHIP_TENDER_NOT_FOUND");
});

// Single-shot success (zero chunk rows) is valid when state is promoted+ready.
test("zero chunk rows (single-shot success) is acceptable", () => {
  const r = evaluateGenerationReadiness(ready({ currentHashChunks: [] }));
  assert.equal(r.ok, true, JSON.stringify(r));
});

// Legacy-analyzed tenders (no promoted job) are now always blocked.
test("legacy-analyzed tender (no job, has requirements) is now blocked", () => {
  const r = evaluateGenerationReadiness(ready({
    canonicalJobId: null,
    latestJobHash: null,
  }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "LEGACY_ANALYSIS_BLOCKED");
});

test("tender without job AND without requirements blocks with LEGACY_ANALYSIS_BLOCKED", () => {
  const r = evaluateGenerationReadiness(ready({
    canonicalJobId: null,
    latestJobHash: null,
    requirementCount: 0,
    requirements: [],
  }));
  assert.equal(r.blockerCode, "LEGACY_ANALYSIS_BLOCKED");
});
