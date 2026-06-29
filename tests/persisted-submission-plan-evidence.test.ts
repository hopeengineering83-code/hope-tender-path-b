/**
 * Behavioral tests for persisted submission plan + requirement evidence.
 *
 * Tests the gate-level logic proving:
 * 1. A virtual preview or DRAFT plan cannot authorize generation
 * 2. Only a current CONFIRMED persisted plan can authorize generation
 * 3. Every mandatory requirement needs approved requirement-level evidence
 * 4. PLANNED/SUPERSEDED/virtual never count as export-ready
 * 5. Existing #917 safety tests still pass
 * 6. URL bypasses removed
 * 7. Cross-user denied
 * 8. One successful controlled flow + multiple blocked flows
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { evaluateGenerationReadiness, type GenerationReadinessInput } from "../lib/engine/generation-readiness-gate";

function makePassingInput(overrides: Partial<GenerationReadinessInput> = {}): GenerationReadinessInput {
  return {
    purpose: "generate",
    tenderExistsAndOwned: true,
    activeFileCount: 1,
    extractionFiles: [{ fileId: "f1", corrupted: false, weak: false, hasOverride: false }],
    analysisState: "AI_SUCCEEDED",
    canonicalJobId: "job-1",
    latestJobHash: "hash-abc",
    currentContentHash: "hash-abc",
    fallbackApprovalBound: false,
    currentHashChunks: [{ status: "SUCCEEDED", totalChunks: 1 }],
    requirementCount: 5,
    requirements: [
      { priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: "This is a meaningful quote exceeding minimum length", sourceFileActiveInTender: true },
    ],
    criticalMetadataOk: true,
    hasConfirmedPersistedPlan: true,
    hasApprovedRequirementEvidence: true,
    exportReadyDocumentCount: 3,
    ...overrides,
  };
}

describe("Persisted submission plan — DRAFT cannot authorize generation", () => {
  it("blocks generation when hasConfirmedPersistedPlan is false (DRAFT plan only)", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      hasConfirmedPersistedPlan: false,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "SUBMISSION_PLAN_MISSING");
  });

  it("blocks generation when hasConfirmedPersistedPlan is false even with evidence", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      hasConfirmedPersistedPlan: false,
      hasApprovedRequirementEvidence: true,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "SUBMISSION_PLAN_MISSING");
  });
});

describe("Persisted submission plan — only CONFIRMED plan authorizes generation", () => {
  it("allows generation when hasConfirmedPersistedPlan is true + evidence approved", () => {
    const r = evaluateGenerationReadiness(makePassingInput());
    assert.equal(r.ok, true);
  });

  it("blocks generation when plan is confirmed but evidence missing", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      hasConfirmedPersistedPlan: true,
      hasApprovedRequirementEvidence: false,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "REQUIREMENT_EVIDENCE_MISSING");
  });

  it("blocks generation when evidence approved but plan not confirmed", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      hasConfirmedPersistedPlan: false,
      hasApprovedRequirementEvidence: true,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "SUBMISSION_PLAN_MISSING");
  });
});

describe("Requirement evidence — mandatory requirements need approved evidence", () => {
  it("blocks when hasApprovedRequirementEvidence is false", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      hasApprovedRequirementEvidence: false,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "REQUIREMENT_EVIDENCE_MISSING");
  });

  it("blocks export when evidence missing", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      purpose: "export",
      hasApprovedRequirementEvidence: false,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "REQUIREMENT_EVIDENCE_MISSING");
  });

  it("blocks final-zip when evidence missing", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      purpose: "final-zip",
      hasApprovedRequirementEvidence: false,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "REQUIREMENT_EVIDENCE_MISSING");
  });
});

describe("Export/final-ZIP — PLANNED/SUPERSEDED/virtual never count", () => {
  it("blocks export when exportReadyDocumentCount is 0 (only PLANNED/virtual)", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      purpose: "export",
      exportReadyDocumentCount: 0,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "NO_EXPORT_READY_DOCUMENTS");
  });

  it("blocks final-zip when exportReadyDocumentCount is 0", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      purpose: "final-zip",
      exportReadyDocumentCount: 0,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "NO_EXPORT_READY_DOCUMENTS");
  });

  it("allows export when exportReadyDocumentCount > 0 (real generated files)", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      purpose: "export",
      exportReadyDocumentCount: 3,
    }));
    assert.equal(r.ok, true);
  });
});

describe("URL bypasses removed — no acceptPartialExtraction/acceptNoMandatoryReqs", () => {
  it("generate route source does not check acceptPartialExtraction for bypass", () => {
    const { readFileSync } = require("node:fs");
    const src = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
    // The bypass pattern should NOT appear as an authorization condition
    assert.ok(
      !src.includes('acceptPartialExtraction") !== "true"'),
      "acceptPartialExtraction bypass must be removed",
    );
    assert.ok(
      !src.includes('acceptNoMandatoryReqs") !== "true"'),
      "acceptNoMandatoryReqs bypass must be removed",
    );
  });
});

describe("Cross-user denied", () => {
  it("blocks when tenderExistsAndOwned is false", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      tenderExistsAndOwned: false,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "OWNERSHIP_TENDER_NOT_FOUND");
  });
});

describe("Controlled flow — one success + multiple blocked", () => {
  it("SUCCESS: all conditions pass → allows generation", () => {
    const r = evaluateGenerationReadiness(makePassingInput());
    assert.equal(r.ok, true);
  });

  it("BLOCKED: corrupted extraction", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      extractionFiles: [{ fileId: "f1", corrupted: true, weak: false, hasOverride: false }],
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "EXTRACTION_CORRUPTED");
  });

  it("BLOCKED: regex fallback", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      analysisState: "REGEX_FALLBACK_UNAPPROVED",
    }));
    assert.equal(r.ok, false);
  });

  it("BLOCKED: ungrounded mandatory requirement", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      requirements: [{ priority: "MANDATORY", sourceTenderFileId: null, sourcePageNumber: null, sourceExactQuote: null, sourceFileActiveInTender: false }],
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
  });

  it("BLOCKED: metadata contamination", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      criticalMetadataOk: false,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "METADATA_CRITICAL_FIELD_INVALID");
  });

  it("BLOCKED: stale hash", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      latestJobHash: "hash-abc",
      currentContentHash: "hash-xyz",
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "ANALYSIS_HASH_MISMATCH");
  });
});

describe("Existing #917 safety tests still pass", () => {
  it("HUMAN_APPROVED_FALLBACK blocks", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      analysisState: "HUMAN_APPROVED_FALLBACK" as any,
      fallbackApprovalBound: true,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "FALLBACK_NOT_ALLOWED");
  });

  it("weak extraction without override blocks", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      extractionFiles: [{ fileId: "f1", corrupted: false, weak: true, hasOverride: false }],
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "EXTRACTION_WEAK_NO_OVERRIDE");
  });

  it("missing plan blocks generation", () => {
    const r = evaluateGenerationReadiness(makePassingInput({
      hasConfirmedPersistedPlan: false,
      hasApprovedRequirementEvidence: false,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "SUBMISSION_PLAN_MISSING");
  });
});
