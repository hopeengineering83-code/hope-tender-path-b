// Behavioral regression tests for the hardened generation/export gate.
//
// Verifies that the previously-allowed release paths (HUMAN_APPROVED_FALLBACK,
// legacy-analysis bypass, ungrounded critical metadata, manual-only requirements)
// are all blocked after the fix/metadata-release-truth hardening.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { evaluateGenerationReadiness, type GenerationReadinessInput } from "../lib/engine/generation-readiness-gate";
import { canExportWithAnalysisState } from "../lib/engine/analysis-state-resolver";

// ─── Fixture builder ─────────────────────────────────────────────────────────

const GOOD_HASH = "abc123";

function goodInput(overrides: Partial<GenerationReadinessInput> = {}): GenerationReadinessInput {
  return {
    purpose: "generate",
    tenderExistsAndOwned: true,
    activeFileCount: 1,
    extractionFiles: [{ fileId: "f1", corrupted: false, weak: false, hasOverride: false }],
    analysisState: "AI_SUCCEEDED",
    canonicalJobId: "job1",
    latestJobHash: GOOD_HASH,
    currentContentHash: GOOD_HASH,
    fallbackApprovalBound: false,
    currentHashChunks: [],
    requirementCount: 2,
    requirements: [
      {
        priority: "MANDATORY",
        sourceTenderFileId: "f1",
        sourcePageNumber: 3,
        sourceExactQuote: "The procuring entity requires ISO certification for all bidders.",
        sourceFileActiveInTender: true, sourceFileExtractedText: "This tender document contains the following: The procuring entity requires ISO certification for all bidders.. Additional context for the tender file extraction.",
      },
    ],
    criticalMetadataOk: true, exportReadyDocumentCount: 5,
    // BuildPlan enforcement is fail-closed: default to true so the "good"
    // base case passes; tests that exercise the BuildPlan blocker override.
    hasCurrentConfirmedBuildPlan: true,
    confirmedPlanDocumentsOk: true,
    recordedBuildPlanState: "VALID" as const,
    ...overrides,
  };
}

// ─── HUMAN_APPROVED_FALLBACK is now blocked ───────────────────────────────────

describe("hardened gate — HUMAN_APPROVED_FALLBACK blocked", () => {
  it("blocks HUMAN_APPROVED_FALLBACK regardless of approval binding", () => {
    const r = evaluateGenerationReadiness(goodInput({
      analysisState: "HUMAN_APPROVED_FALLBACK",
      fallbackApprovalBound: true,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "FALLBACK_NOT_ALLOWED");
    assert.ok(r.blockerDetail?.includes("regex fallback"), `expected fallback message, got: ${r.blockerDetail}`);
  });

  it("canExportWithAnalysisState returns false for HUMAN_APPROVED_FALLBACK", () => {
    assert.equal(canExportWithAnalysisState("HUMAN_APPROVED_FALLBACK"), false);
  });

  it("canExportWithAnalysisState returns true ONLY for AI_SUCCEEDED", () => {
    assert.equal(canExportWithAnalysisState("AI_SUCCEEDED"), true);
    assert.equal(canExportWithAnalysisState("REGEX_FALLBACK_UNAPPROVED"), false);
    assert.equal(canExportWithAnalysisState("PARTIAL_NEEDS_RESUME"), false);
    assert.equal(canExportWithAnalysisState("FAILED"), false);
    assert.equal(canExportWithAnalysisState("NOT_STARTED"), false);
    assert.equal(canExportWithAnalysisState("QUEUED"), false);
    assert.equal(canExportWithAnalysisState("RUNNING"), false);
    assert.equal(canExportWithAnalysisState("SUPERSEDED"), false);
  });
});

// ─── Legacy-analysis bypass is removed ───────────────────────────────────────

describe("hardened gate — legacy-analysis (no promoted job) is blocked", () => {
  it("blocks when canonicalJobId is null, even when requirements exist", () => {
    // Previously: `isLegacyAnalyzed = true` would skip the promotion + hash checks.
    // Now: no promoted job is always LEGACY_ANALYSIS_BLOCKED.
    const r = evaluateGenerationReadiness(goodInput({
      analysisState: "AI_SUCCEEDED",
      canonicalJobId: null,
      latestJobHash: GOOD_HASH,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "LEGACY_ANALYSIS_BLOCKED");
  });

  it("allows when canonicalJobId is set (normal promoted job)", () => {
    const r = evaluateGenerationReadiness(goodInput());
    assert.equal(r.ok, true);
  });
});

// ─── Critical metadata gate ───────────────────────────────────────────────────

describe("hardened gate — critical metadata gate (G)", () => {
  it("blocks when criticalMetadataOk is false", () => {
    const r = evaluateGenerationReadiness(goodInput({ criticalMetadataOk: false }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "METADATA_CRITICAL_FIELD_INVALID");
    assert.ok(r.blockerDetail?.includes("critical metadata"), `got: ${r.blockerDetail}`);
  });

  it("allows when criticalMetadataOk is true", () => {
    const r = evaluateGenerationReadiness(goodInput({ criticalMetadataOk: true }));
    assert.equal(r.ok, true);
  });

  it("metadata gate fires before requirement gate when both fail", () => {
    const r = evaluateGenerationReadiness(goodInput({
      criticalMetadataOk: false,
      requirementCount: 0,
    }));
    assert.equal(r.ok, false);
    // Metadata check (G) fires BEFORE requirements (F)
    assert.equal(r.blockerCode, "METADATA_CRITICAL_FIELD_INVALID");
  });
});

// ─── Content-hash binding is always enforced ──────────────────────────────────

describe("hardened gate — content-hash always enforced (no legacy bypass)", () => {
  it("blocks when content hash mismatches", () => {
    const r = evaluateGenerationReadiness(goodInput({
      latestJobHash: "old_hash",
      currentContentHash: "new_hash",
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "ANALYSIS_HASH_MISMATCH");
  });

  it("blocks when latestJobHash is null", () => {
    const r = evaluateGenerationReadiness(goodInput({ latestJobHash: null }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "ANALYSIS_HASH_MISMATCH");
  });
});

// ─── Manual-only requirements remain blocked ──────────────────────────────────

describe("hardened gate — ungrounded mandatory requirements blocked", () => {
  it("blocks when mandatory requirement has no source quote", () => {
    const r = evaluateGenerationReadiness(goodInput({
      requirements: [
        {
          priority: "MANDATORY",
          sourceTenderFileId: "f1",
          sourcePageNumber: 2,
          sourceExactQuote: "", // no quote
          sourceFileActiveInTender: true, sourceFileExtractedText: "This tender document contains the following: . Additional context for the tender file extraction.",
        },
      ],
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
  });

  it("blocks when mandatory requirement has inactive source file", () => {
    const r = evaluateGenerationReadiness(goodInput({
      requirements: [
        {
          priority: "MANDATORY",
          sourceTenderFileId: "deleted-file",
          sourcePageNumber: 2,
          sourceExactQuote: "ISO 9001 certification required for all bidders",
          sourceFileActiveInTender: false, // file deleted
        },
      ],
    }));
    assert.equal(r.ok, false);
    assert.equal(r.blockerCode, "REQUIREMENT_SOURCE_UNGROUNDED");
  });

  it("allows when all mandatory requirements are source-grounded", () => {
    const r = evaluateGenerationReadiness(goodInput());
    assert.equal(r.ok, true);
  });

  it("non-mandatory requirements can be ungrounded without blocking", () => {
    const r = evaluateGenerationReadiness(goodInput({
      requirements: [
        {
          priority: "DESIRABLE",
          sourceTenderFileId: null,
          sourcePageNumber: null,
          sourceExactQuote: null,
          sourceFileActiveInTender: false,
        },
        {
          priority: "MANDATORY",
          sourceTenderFileId: "f1",
          sourcePageNumber: 3,
          sourceExactQuote: "ISO certification is required for all bidders",
          sourceFileActiveInTender: true, sourceFileExtractedText: "This tender document contains the following: ISO certification is required for all bidders. Additional context for the tender file extraction.",
        },
      ],
    }));
    assert.equal(r.ok, true);
  });
});

// ─── Gate ordering guarantees ─────────────────────────────────────────────────

describe("hardened gate — blocker ordering", () => {
  it("FALLBACK_NOT_ALLOWED fires before LEGACY_ANALYSIS_BLOCKED", () => {
    const r = evaluateGenerationReadiness(goodInput({
      analysisState: "HUMAN_APPROVED_FALLBACK",
      canonicalJobId: null,
    }));
    assert.equal(r.blockerCode, "FALLBACK_NOT_ALLOWED");
  });

  it("EXTRACTION_CORRUPTED fires before ANALYSIS_NOT_READY", () => {
    const r = evaluateGenerationReadiness(goodInput({
      extractionFiles: [{ fileId: "f1", corrupted: true, weak: false, hasOverride: false }],
      analysisState: "NOT_STARTED",
    }));
    assert.equal(r.blockerCode, "EXTRACTION_CORRUPTED");
  });
});
