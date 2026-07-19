import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  analysisStateLabel,
  canExportWithAnalysisState,
  canResumeAnalysis,
  deriveAnalysisStateDetail,
  type DeriveAnalysisStateInput,
  type ResolverJobInput,
} from "../lib/engine/analysis-state-resolver";

const NOW = new Date("2026-07-19T12:00:00.000Z");

function job(overrides: Partial<ResolverJobInput> = {}): ResolverJobInput {
  return {
    id: "job-1", status: "SUCCEEDED", analysisInputHash: "hash-1",
    stagedMergedResult: null, promotedAt: NOW, supersededBy: null,
    startedAt: NOW, finishedAt: NOW, errorMessage: null, ...overrides,
  };
}

function input(overrides: Partial<DeriveAnalysisStateInput> = {}): DeriveAnalysisStateInput {
  return {
    job: job(), chunks: [{ status: "SUCCEEDED", provider: "gemini" }],
    legacyNotesAiAnalyzed: false, requirementsExtracted: 2,
    requirementsPersisted: 2, sourceReferencesCreated: true,
    metadataFieldsPersisted: true, sectionsDetectedButNoRequirements: false,
    ...overrides,
  };
}

describe("canonical analysis state remains fail-closed", () => {
  it("blocks a promoted human-approved fallback from export", () => {
    const result = deriveAnalysisStateDetail(input({
      job: job({ status: "FAILED", stagedMergedResult: JSON.stringify({ analysisSource: "FALLBACK_DRAFT" }), promotedAt: NOW }),
      chunks: [{ status: "FAILED", provider: "gemini" }],
    }));
    assert.equal(result.state, "HUMAN_APPROVED_FALLBACK");
    assert.equal(result.analysisSource, "REGEX_FALLBACK");
    assert.equal(canExportWithAnalysisState(result.state), false);
    assert.equal(canResumeAnalysis(result.state), false);
    assert.match(result.nextAction, /lower confidence/i);
  });

  it("keeps an unapproved fallback resumable but not exportable", () => {
    const result = deriveAnalysisStateDetail(input({
      job: job({ status: "FAILED", stagedMergedResult: JSON.stringify({ analysisSource: "FALLBACK_DRAFT" }), promotedAt: null }),
      chunks: [{ status: "FAILED", provider: "gemini" }],
    }));
    assert.equal(result.state, "REGEX_FALLBACK_UNAPPROVED");
    assert.equal(canExportWithAnalysisState(result.state), false);
    assert.equal(canResumeAnalysis(result.state), true);
  });

  it("blocks a succeeded job that was never canonically promoted", () => {
    const result = deriveAnalysisStateDetail(input({ job: job({ status: "SUCCEEDED", promotedAt: null }) }));
    assert.equal(result.state, "FAILED");
    assert.equal(result.canonicalJobId, null);
    assert.equal(canExportWithAnalysisState(result.state), false);
  });

  it("blocks promoted analysis while any chunk remains incomplete", () => {
    const result = deriveAnalysisStateDetail(input({ chunks: [
      { status: "SUCCEEDED", provider: "gemini" },
      { status: "FAILED", provider: "openrouter" },
    ] }));
    assert.equal(result.state, "PARTIAL_NEEDS_RESUME");
    assert.equal(result.completedChunks, 1);
    assert.equal(result.totalChunks, 2);
    assert.equal(canExportWithAnalysisState(result.state), false);
    assert.equal(canResumeAnalysis(result.state), true);
  });

  it("blocks superseded analysis even when its prior run succeeded", () => {
    const result = deriveAnalysisStateDetail(input({ job: job({ supersededBy: "job-2" }) }));
    assert.equal(result.state, "SUPERSEDED");
    assert.equal(canExportWithAnalysisState(result.state), false);
    assert.equal(canResumeAnalysis(result.state), false);
  });

  it("blocks detected sections when no structured requirements were produced", () => {
    const result = deriveAnalysisStateDetail(input({
      requirementsExtracted: 0, requirementsPersisted: 0, sectionsDetectedButNoRequirements: true,
    }));
    assert.equal(result.state, "SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED");
    assert.equal(canExportWithAnalysisState(result.state), false);
    assert.equal(canResumeAnalysis(result.state), true);
  });

  it("allows only promoted, complete AI success", () => {
    const result = deriveAnalysisStateDetail(input());
    assert.equal(result.state, "AI_SUCCEEDED");
    assert.equal(result.canonicalJobId, "job-1");
    assert.equal(canExportWithAnalysisState(result.state), true);
    assert.equal(canResumeAnalysis(result.state), false);
    assert.equal(analysisStateLabel(result.state), "Analysis Complete");
  });
});
