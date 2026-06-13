// Source-read tests for the resolveResumeState helper and its application in
// both non-streaming AI Analyze handlers in tender-detail.tsx.
// Verifies that continueJobId is correctly cleared on full completion.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf-8");

const TENDER_DETAIL = "app/dashboard/tenders/[id]/tender-detail.tsx";

describe("resolveResumeState helper", () => {
  it("resolveResumeState helper exists in tender-detail.tsx", () => {
    const src = read(TENDER_DETAIL);
    assert.ok(
      src.includes("function resolveResumeState("),
      "tender-detail.tsx must define a resolveResumeState function",
    );
  });

  it("resolveResumeState checks chunks.isPartial and jobId before keeping resume state", () => {
    const src = read(TENDER_DETAIL);
    assert.ok(
      src.includes("data.chunks?.isPartial && data.jobId"),
      "resolveResumeState must check chunks.isPartial && jobId",
    );
    assert.ok(
      src.includes("{ keep: true, jobId: data.jobId }"),
      "resolveResumeState must return { keep: true, jobId } when partial",
    );
    assert.ok(
      src.includes("{ keep: false, jobId: null }"),
      "resolveResumeState must return { keep: false, jobId: null } on full completion",
    );
  });
});

describe("handleContinueAnalysis uses resolveResumeState (non-streaming)", () => {
  it("handleContinueAnalysis uses resolveResumeState instead of bare if (data.jobId)", () => {
    const src = read(TENDER_DETAIL);
    // Find the handleContinueAnalysis function
    const fnStart = src.indexOf("async function handleContinueAnalysis()");
    assert.ok(fnStart !== -1, "handleContinueAnalysis function must exist");
    const fnBlock = src.slice(fnStart, fnStart + 1500);
    assert.ok(
      fnBlock.includes("resolveResumeState(data)"),
      "handleContinueAnalysis must use resolveResumeState(data)",
    );
    // Should NOT use the bare pattern
    assert.ok(
      !fnBlock.includes("if (data.jobId) setContinueJobId(data.jobId)"),
      "handleContinueAnalysis must not use bare if (data.jobId) setContinueJobId(data.jobId)",
    );
  });

  it("handleContinueAnalysis clears latestPartialAnalysisJob when not keeping resume", () => {
    const src = read(TENDER_DETAIL);
    const fnStart = src.indexOf("async function handleContinueAnalysis()");
    const fnBlock = src.slice(fnStart, fnStart + 1500);
    assert.ok(
      fnBlock.includes("latestPartialAnalysisJob: null"),
      "handleContinueAnalysis must clear latestPartialAnalysisJob when resumeResolution.keep is false",
    );
  });
});

describe("handleAIAnalyze uses resolveResumeState (non-streaming)", () => {
  it("handleAIAnalyze (non-streaming) uses resolveResumeState instead of bare if (data.jobId)", () => {
    const src = read(TENDER_DETAIL);
    // Find handleAIAnalyze (non-streaming path — before handleAnalyzeStreaming)
    const fnStart = src.indexOf("async function handleAIAnalyze()");
    assert.ok(fnStart !== -1, "handleAIAnalyze function must exist");
    const fnEnd = src.indexOf("async function handleAnalyzeStreaming()", fnStart);
    const fnBlock = src.slice(fnStart, fnEnd);
    assert.ok(
      fnBlock.includes("resolveResumeState(data)"),
      "handleAIAnalyze (non-streaming) must use resolveResumeState(data)",
    );
    assert.ok(
      !fnBlock.includes("if (data.jobId) setContinueJobId(data.jobId)"),
      "handleAIAnalyze must not use bare if (data.jobId) setContinueJobId(data.jobId)",
    );
  });

  it("handleAIAnalyze clears latestPartialAnalysisJob when not keeping resume", () => {
    const src = read(TENDER_DETAIL);
    const fnStart = src.indexOf("async function handleAIAnalyze()");
    const fnEnd = src.indexOf("async function handleAnalyzeStreaming()", fnStart);
    const fnBlock = src.slice(fnStart, fnEnd);
    assert.ok(
      fnBlock.includes("latestPartialAnalysisJob: null"),
      "handleAIAnalyze must clear latestPartialAnalysisJob when resumeResolution.keep is false",
    );
  });
});

describe("streaming path already handles resume state correctly", () => {
  it("streaming path clears continueJobId when status !== AI_ANALYSIS_PARTIAL", () => {
    const src = read(TENDER_DETAIL);
    assert.ok(
      src.includes('event.status !== "AI_ANALYSIS_PARTIAL"'),
      "streaming path must clear state when status is not AI_ANALYSIS_PARTIAL",
    );
    // After the check, it should clear setContinueJobId(null) and latestPartialAnalysisJob
    const checkIdx = src.indexOf('event.status !== "AI_ANALYSIS_PARTIAL"');
    const nearBlock = src.slice(checkIdx, checkIdx + 200);
    assert.ok(
      nearBlock.includes("setContinueJobId(null)"),
      "streaming path must call setContinueJobId(null) when not partial",
    );
  });

  it("streaming path clears latestPartialAnalysisJob on full completion", () => {
    const src = read(TENDER_DETAIL);
    const checkIdx = src.indexOf('event.status !== "AI_ANALYSIS_PARTIAL"');
    const nearBlock = src.slice(checkIdx, checkIdx + 300);
    assert.ok(
      nearBlock.includes("latestPartialAnalysisJob: null"),
      "streaming path must clear latestPartialAnalysisJob on full completion",
    );
  });
});
