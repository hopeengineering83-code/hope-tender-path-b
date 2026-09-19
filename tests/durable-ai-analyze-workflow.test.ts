import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  isFullAiSuccess,
  resolveAnalyzeTerminalStatus,
  isTerminalHandlerResult,
  type AnalyzeExecOutcome,
} from "../lib/ai-job-handlers";
import { describeAIAnalyzeWorkflowState } from "../lib/engine/workflow-panel-presentation";

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

describe("AI Analyze is a MANUAL user action via the manual-ai-analyze route", () => {
  const manualRoute = read("app/api/tenders/[id]/manual-ai-analyze/route.ts");
  const workflow = read("components/workflow-step-links.tsx");
  const panel = read("components/ai-analyze-panel.tsx");

  it("the manual route creates an AI_ANALYZE job with manualRequested=true and autoContinue=false", () => {
    // FIX 1: After the atomic-manual-authority refactor, the manual route
    // passes a `manualAuthority` parameter into createAnalysisJob() (which
    // persists manualRequested=true, source, actorUserId, authorizedAt, and
    // autoContinue=false atomically in the same transaction). The route no
    // longer patches these in a separate updateMany — that race window is
    // closed. The contract is therefore verified in analysis-job-service.ts
    // (where the atomic write happens) AND in the route (which forwards the
    // manual authority).
    const service = read("lib/ai-jobs/analysis-job-service.ts");
    assert.match(manualRoute, /createAnalysisJob/);
    assert.match(manualRoute, /manualAuthority:/);
    assert.match(manualRoute, /source: "manual-ai-analyze"/);
    assert.match(manualRoute, /actorUserId: actor\.id/);
    assert.match(manualRoute, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    // The atomic contract is verified in the service.
    assert.match(service, /manualRequested: true/);
    assert.match(service, /autoContinue: false/);
    assert.match(service, /source: "manual-ai-analyze"/);
    // The race-window updateMany patch must NOT exist in the route.
    assert.doesNotMatch(manualRoute, /prisma\.aiJob\.updateMany/);
  });

  it("the workflow step links are navigation-only — no AI Analyze mutation", () => {
    assert.doesNotMatch(workflow, /method:\s*"POST"|run-next\?jobType/);
  });

  it("the analysis panel has a MANUAL Run AI Analyze button and is non-SSE", () => {
    // The panel now contains a visible "Run AI Analyze" button that calls
    // the manual-ai-analyze endpoint. This is the MANUAL workflow design.
    assert.match(panel, /Run AI Analyze/);
    assert.match(panel, /manual-ai-analyze/);
    // No SSE streaming — status is polled via GET /api/ai-jobs/:id.
    assert.doesNotMatch(panel, /text\/event-stream|getReader\(\)/);
    // The panel polls job status via /api/ai-jobs/${jobId} (state variable).
    assert.match(panel, /\/api\/ai-jobs\/\$\{jobId\}/);
    // The shared current-revision presenter owns the completed-stage wording.
    assert.equal(
      describeAIAnalyzeWorkflowState({
        analysisCurrent: true,
        engineRunning: false,
        engineComplete: false,
        engineFailed: false,
        canRunEngine: true,
        activeJob: null,
      }),
      "AI Analyze complete. Run Engine to continue.",
    );
    assert.match(panel, /Check provider diagnostics/);
  });
});

describe("durable resume and fail-closed downstream gates", () => {
  it("re-arms retryable partial/failed jobs and preserves non-retryable failures", () => {
    const service = read("lib/ai-jobs/analysis-job-service.ts");
    assert.match(service, /status: \{ in: \["QUEUED", "RUNNING", "PARTIAL_SUCCESS", "FAILED"\] \}/);
    // FIX 1: the re-arm now also refreshes the manual authority + canonical
    // snapshot in the same transaction. The data block must include the
    // core re-arm fields plus the input JSON with manualRequested.
    assert.match(service, /status: "QUEUED",\s*startedAt: null,\s*finishedAt: null,\s*errorMessage: null,/);
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
    assert.match(service, /stageFallbackDraft\(jobId/);
    assert.match(service, /code:\s*"HUMAN_APPROVAL_REQUIRED_FALLBACK"/);
    assert.match(service, /providerAttempts:\s*error\.providerAttempts/);
    assert.match(service, /failureDetails:\s*error\.failureDetails/);
    assert.match(service, /PROMOTION_BLOCKED_WEAK_GROUNDING/);
    assert.match(gate, /REGEX_FALLBACK_UNAPPROVED/);
  });

  it("AI Analyze itself never creates generated documents", () => {
    const handlers = read("lib/ai-job-handlers-legacy.ts");
    const analyzeBlock = handlers.slice(handlers.indexOf("AI_ANALYZE:"), handlers.indexOf("PROPOSAL_GENERATION:"));
    assert.doesNotMatch(analyzeBlock, /generatedDocument\.create/);
  });
});
