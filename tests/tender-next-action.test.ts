import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { hasAnyResumableAiAnalyzeCheckpoint, hasResumableAiAnalyzeCheckpoint, resolveTenderNextAction } from "../lib/tender-next-action";

const base = {
  hasFiles: true,
  extraction: { averageScore: 95, pageCoveragePercent: 100 },
  resumableAnalysisAvailable: false,
  aiAnalysis: { exists: true, trusted: true, status: "FULL_EXTRACTION_AI_ANALYZED", regexFallback: false, partial: false },
  metadata: { trusted: true, missingFields: [], contaminated: false, placeholderCount: 0 },
  requirements: { rawCount: 6, trustedTracedCount: 6, mandatoryCount: 2, mandatoryTracedCount: 2 },
  submissionPlanBuilt: true,
  documents: { current: true, hasGeneratedDocuments: true, stale: false },
  exportBlockersCount: 0,
};

describe("resolveTenderNextAction", () => {
  it("weak extraction shows Fix Extraction First before AI Analyze", () => {
    const decision = resolveTenderNextAction({
      ...base,
      extraction: { averageScore: 90, pageCoveragePercent: 31, partial: true },
      resumableAnalysisAvailable: true,
      aiAnalysis: { exists: false },
    });
    assert.equal(decision.primary, "FIX_EXTRACTION");
    assert.match(decision.label, /Fix Extraction First/);
    assert.match(decision.reason, /Run OCR \/ re-extract before AI Analyze/);
  });

  it("resumable analysis shows Resume AI Analyze when extraction is ready", () => {
    const decision = resolveTenderNextAction({
      ...base,
      resumableAnalysisAvailable: true,
      aiAnalysis: { exists: false },
    });
    assert.equal(decision.primary, "RESUME_AI_ANALYZE");
    assert.match(decision.label, /Resume AI Analyze/);
  });

  it("regex fallback weak extraction does not show final-approved wording", () => {
    const decision = resolveTenderNextAction({
      ...base,
      aiAnalysis: { exists: true, trusted: false, status: "REGEX_FALLBACK_FROM_WEAK_EXTRACTION", regexFallback: true },
      requirements: { rawCount: 13, trustedTracedCount: 0, mandatoryCount: 6, mandatoryTracedCount: 0 },
    });
    assert.equal(decision.primary, "REVIEW_REQUIREMENTS");
    assert.match(decision.reason, /draft-only/);
    assert.doesNotMatch(decision.reason, /approved as sufficient/i);
  });

  it("raw vs trusted requirements are displayed separately", () => {
    const decision = resolveTenderNextAction({
      ...base,
      requirements: { rawCount: 13, trustedTracedCount: 1, mandatoryCount: 6, mandatoryTracedCount: 0 },
    });
    assert.equal(decision.primary, "REVIEW_REQUIREMENTS");
    assert.deepEqual(decision.rawVsTrustedRequirements, {
      raw: 13,
      trusted: 1,
      mandatory: 6,
      mandatoryTraced: 0,
    });
  });

  it("stale or missing documents are not treated as export ready", () => {
    const decision = resolveTenderNextAction({
      ...base,
      documents: { current: false, hasGeneratedDocuments: true, stale: true },
    });
    assert.equal(decision.primary, "GENERATE_DOCUMENTS");
    assert.match(decision.label, /stale/i);
    assert.notEqual(decision.tone, "green");
  });
});

describe("hasResumableAiAnalyzeCheckpoint", () => {
  it("treats PARTIAL_SUCCESS jobs as resumable", () => {
    assert.equal(hasResumableAiAnalyzeCheckpoint({ status: "PARTIAL_SUCCESS", succeededChunkCount: 0 }), true);
  });

  it("treats FAILED jobs as resumable only when a successful chunk checkpoint exists", () => {
    assert.equal(hasResumableAiAnalyzeCheckpoint({ status: "FAILED", succeededChunkCount: 2 }), true);
    assert.equal(hasResumableAiAnalyzeCheckpoint({ status: "FAILED", succeededChunkCount: 0 }), false);
    assert.equal(hasResumableAiAnalyzeCheckpoint({ status: "FAILED", succeededChunkCount: null }), false);
  });

  it("does not let a newest non-checkpointed FAILED job mask an older resumable job", () => {
    assert.equal(hasAnyResumableAiAnalyzeCheckpoint([
      { status: "FAILED", succeededChunkCount: 0 },
      { status: "PARTIAL_SUCCESS", succeededChunkCount: 0 },
    ]), true);
    assert.equal(hasAnyResumableAiAnalyzeCheckpoint([
      { status: "FAILED", succeededChunkCount: 0 },
      { status: "FAILED", succeededChunkCount: 3 },
    ]), true);
    assert.equal(hasAnyResumableAiAnalyzeCheckpoint([
      { status: "FAILED", succeededChunkCount: 0 },
      { status: "FAILED", succeededChunkCount: null },
    ]), false);
  });
});

describe("visible wording contract", () => {
  it("analysis panel uses draft-only regex fallback wording", () => {
    const source = readFileSync(resolve(process.cwd(), "components/analysis-quality-panel.tsx"), "utf8");
    assert.match(source, /Approved for draft review only/);
    assert.doesNotMatch(source, /approved it as sufficient/i);
  });

  it("next action panel exposes Fix Extraction First and raw/trusted requirement split", () => {
    const source = readFileSync(resolve(process.cwd(), "components/next-action-panel.tsx"), "utf8");
    assert.match(source, /Fix Extraction First/);
    assert.match(source, /Raw fallback requirements/);
    assert.match(source, /Trusted traced requirements/);
  });

  it("next action panel treats failed checkpointed analysis jobs as resumable", () => {
    const source = readFileSync(resolve(process.cwd(), "components/next-action-panel.tsx"), "utf8");
    assert.match(source, /status:\s*\{\s*in:\s*\["PARTIAL_SUCCESS",\s*"FAILED"\]\s*\}/);
    assert.match(source, /take:\s*5/);
    assert.match(source, /analyzeChunks:\s*\{\s*where:\s*\{\s*status:\s*"SUCCEEDED"\s*\}/);
    assert.match(source, /hasAnyResumableAiAnalyzeCheckpoint/);
  });

  it("untrusted sector warning is visible in the analysis quality panel", () => {
    const source = readFileSync(resolve(process.cwd(), "components/analysis-quality-panel.tsx"), "utf8");
    assert.match(source, /Sector inferred from untrusted analysis/);
  });
});
