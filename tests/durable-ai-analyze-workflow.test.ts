import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  isFullAiSuccess,
  resolveAnalyzeTerminalStatus,
  isTerminalHandlerResult,
  type AnalyzeExecOutcome,
} from "../lib/ai-job-handlers";

const read = (path: string) => readFileSync(path, "utf8");
const FULL: AnalyzeExecOutcome = { success: true, isPartial: false, completedChunks: 3 };
const PARTIAL: AnalyzeExecOutcome = { success: false, isPartial: true, completedChunks: 2 };
const FAILED: AnalyzeExecOutcome = { success: false, isPartial: true, completedChunks: 0, errorMessage: "AI providers exhausted" };

describe("full AI success is the only path to SUCCEEDED", () => {
  it("requires complete success without an error", () => {
    assert.equal(isFullAiSuccess(FULL), true);
    assert.equal(isFullAiSuccess(PARTIAL), false);
    assert.equal(isFullAiSuccess(FAILED), false);
    assert.equal(isFullAiSuccess({ ...FULL, errorMessage: "boom" }), false);
  });

  it("requires the finalizer to confirm canonical promotion", () => {
    assert.equal(resolveAnalyzeTerminalStatus(FULL, { status: "SUCCEEDED" }), "SUCCEEDED");
    assert.equal(resolveAnalyzeTerminalStatus(FULL, { status: "FAILED", code: "PROMOTION_BLOCKED_WEAK_GROUNDING" }), "FAILED");
    assert.equal(resolveAnalyzeTerminalStatus(PARTIAL, null), "PARTIAL_SUCCESS");
    assert.equal(resolveAnalyzeTerminalStatus(FAILED, null), "FAILED");
  });

  it("promotes requirements and canonical Tender Details only in finalization", () => {
    const service = read("lib/ai-jobs/analysis-job-service.ts");
    const handlers = read("lib/ai-job-handlers-legacy.ts");
    assert.match(service, /upsertRequirements\(/);
    assert.match(service, /buildCanonicalAnalysisTenderUpdate\(/);
    assert.match(handlers, /if \(isFullAiSuccess\(result\)\) \{[\s\S]*?finalizeAnalysisJob/);
    assert.equal((handlers.match(/finalizeAnalysisJob\(/g) ?? []).length, 1);
  });
});

describe("run-next preserves durable terminal truth", () => {
  it("recognizes terminal handler results", () => {
    assert.equal(isTerminalHandlerResult({ terminalStatus: "PARTIAL_SUCCESS", output: {} }), true);
    assert.equal(isTerminalHandlerResult({ terminalStatus: "FAILED", output: {} }), true);
    assert.equal(isTerminalHandlerResult({ requirementCount: 3 }), false);
  });

  it("does not blindly complete a handler-owned terminal result", () => {
    const route = read("app/api/ai-jobs/run-next/route.ts");
    assert.match(route, /isTerminalHandlerResult\(result\)/);
    assert.match(route, /} else \{\s*\n\s*await completeJob\(claimed\.id, result\)/);
  });
});

describe("AI Analyze has one explicit durable owner", () => {
  const route = read("app/api/tenders/[id]/manual-ai-analyze/route.ts");
  const owner = read("components/workflow-step-links.tsx");
  const panel = read("components/ai-analyze-panel.tsx");

  it("queues through the role- and tenant-scoped manual route", () => {
    assert.match(route, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.match(route, /where: \{ id: tenderId, userId: actor\.id \}/);
    assert.match(route, /createAnalysisJob/);
    assert.match(route, /manualRequested:\s*true/);
    assert.match(route, /autoContinue:\s*false/);
    assert.match(route, /status:\s*202/);
  });

  it("is invoked only from WorkflowStepLinks", () => {
    assert.match(owner, /manual-ai-analyze/);
    assert.match(owner, /run-next\?jobType=\$\{jobType\}/);
    assert.match(owner, /"AI Analyze"/);
  });

  it("keeps the analysis panel status-only and non-SSE", () => {
    assert.doesNotMatch(panel, /method:\s*"POST"/);
    assert.doesNotMatch(panel, /manual-ai-analyze|ai-analyze\?mode=background/);
    assert.doesNotMatch(panel, /text\/event-stream|getReader\(\)/);
    assert.match(panel, /\/api\/ai-jobs\/\$\{initialContinueJobId\}/);
    assert.match(panel, /AI Analyze completed/);
    assert.match(panel, /Check provider diagnostics/);
  });
});

describe("durable resume and fail-closed downstream gates", () => {
  it("re-arms retryable partial/failed jobs and preserves non-retryable failures", () => {
    const service = read("lib/ai-jobs/analysis-job-service.ts");
    assert.match(service, /status: \{ in: \["QUEUED", "RUNNING", "PARTIAL_SUCCESS", "FAILED"\] \}/);
    assert.match(service, /data: \{ status: "QUEUED", startedAt: null, finishedAt: null, errorMessage: null \}/);
    assert.match(service, /nonRetryable/);
    assert.match(service, /\$transaction/);
  });

  it("resumes from durable completed chunk checkpoints", () => {
    const orchestrator = read("lib/engine/analysis-orchestrator.ts");
    assert.match(orchestrator, /getCompletedChunkResults\(tenderId, userId, contentHash\)/);
    assert.match(orchestrator, /durableCompleted\.length > previousChunkResults\.length/);
  });

  it("partial or fallback analysis cannot unlock generation", () => {
    const service = read("lib/ai-jobs/analysis-job-service.ts");
    const gate = read("lib/engine/generation-readiness-gate.ts");
    assert.match(service, /analysisExtractionStatus:\s*"REGEX_FALLBACK_UNAPPROVED"/);
    assert.match(service, /PROMOTION_BLOCKED_WEAK_GROUNDING/);
    assert.match(gate, /REGEX_FALLBACK_UNAPPROVED/);
  });

  it("AI Analyze itself never creates generated documents", () => {
    const handlers = read("lib/ai-job-handlers-legacy.ts");
    const analyzeBlock = handlers.slice(handlers.indexOf("AI_ANALYZE:"), handlers.indexOf("PROPOSAL_GENERATION:"));
    assert.doesNotMatch(analyzeBlock, /generatedDocument\.create/);
  });
});
