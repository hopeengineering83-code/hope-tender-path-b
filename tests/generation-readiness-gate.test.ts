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
    requirements: [groundedMandatory()],
    submissionPlanDocumentCount: 4,
    metadataBlocked: false,
    metadataBlockerReason: null,
    isLegacyAnalyzed: false,
    reviewedSelectedExperts: 1,
    totalSelectedExperts: 1,
    reviewedSelectedProjects: 1,
    totalSelectedProjects: 1,
    ...overrides,
  };
}

test("baseline: a fully-ready tender passes the gate", () => {
  const r = evaluateGenerationReadiness(ready());
  assert.equal(r.ok, true, JSON.stringify(r));
});

test("1. blocks if AI analysis is not success (Rule 4)", () => {
  const r = evaluateGenerationReadiness(ready({ analysisState: "FAILED" as any }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "ANALYSIS_NOT_READY");
});

test("2. blocks if regex fallback is approved (Rule 4 strict)", () => {
  const r = evaluateGenerationReadiness(ready({ analysisState: "HUMAN_APPROVED_FALLBACK" as any }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "FALLBACK_UNAPPROVED");
});

test("3. blocks if metadata is blocked (Rule 3)", () => {
  const r = evaluateGenerationReadiness(ready({ metadataBlocked: true, metadataBlockerReason: "Ungrounded" }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "METADATA_CRITICAL_BLOCKED");
});

test("4. blocks if mandatory requirements are ungrounded (Rule 5)", () => {
  const ungrounded: ReadinessRequirement = { ...groundedMandatory(), sourceExactQuote: "too short" };
  const r = evaluateGenerationReadiness(ready({ requirements: [ungrounded] }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
});

test("5. blocks if vault matches are unreviewed (Rule 7)", () => {
  const r = evaluateGenerationReadiness(ready({ reviewedSelectedExperts: 0, totalSelectedExperts: 1 }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "VAULT_EVIDENCE_INCOMPLETE");
});

test("6. blocks if submission plan is missing (Rule 6)", () => {
  const r = evaluateGenerationReadiness(ready({ submissionPlanDocumentCount: 0 }));
  assert.equal(r.ok, false);
  assert.equal(r.blockerCode, "SUBMISSION_PLAN_MISSING");
});
