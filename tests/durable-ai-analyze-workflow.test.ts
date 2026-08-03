// Durable AI Analyze workflow — unified lifecycle contract.
//
// These tests lock in the unified durable workflow described in the task:
//   1. The visible "Run AI Analyze" button enqueues ONE durable AI_ANALYZE job
//      and never uses the direct SSE route for normal production analysis.
//   2. Full background success finalizes (promotes canonical requirements +
//      canonical tender metadata) before declaring SUCCEEDED.
//   3. Partial / fallback runs stay PARTIAL_SUCCESS or FAILED and cannot promote.
//   4. run-next respects the handler's terminal status (never blindly SUCCEEDED).
//   5. Worker 401/403/500 is surfaced in the UI, never silently swallowed.
//   6. Lifecycle queued → running → succeeded for a clean tender.
//   7. Provider failure → partial/failed → generation/export/Final ZIP blocked.
//
// The handler/worker decision logic is exported as pure functions and exercised
// behaviourally; the route/component wiring is asserted at the source level
// (the same convention the rest of this suite uses for session+DB-bound code).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  isFullAiSuccess,
  resolveAnalyzeTerminalStatus,
  isTerminalHandlerResult,
  type AnalyzeExecOutcome,
} from "../lib/ai-job-handlers";

const FULL: AnalyzeExecOutcome = { success: true, isPartial: false, completedChunks: 3 };
const PARTIAL: AnalyzeExecOutcome = { success: false, isPartial: true, completedChunks: 2 };
const FALLBACK_NO_PROGRESS: AnalyzeExecOutcome = { success: false, isPartial: true, completedChunks: 0, errorMessage: "AI providers exhausted" };
const ERRORED_FULL_SHAPE: AnalyzeExecOutcome = { success: true, isPartial: false, completedChunks: 1, errorMessage: "boom" };

// ── Test 2 + 6: full success promotes and reaches SUCCEEDED ──────────────────
describe("full AI success is the only path to SUCCEEDED", () => {
  it("isFullAiSuccess is true only for success && !isPartial && no error", () => {
    assert.equal(isFullAiSuccess(FULL), true);
    assert.equal(isFullAiSuccess(PARTIAL), false);
    assert.equal(isFullAiSuccess(FALLBACK_NO_PROGRESS), false);
    // success flag set but an error string present must NOT count as full success
    assert.equal(isFullAiSuccess(ERRORED_FULL_SHAPE), false);
  });

  it("SUCCEEDED requires the finalizer to confirm promotion", () => {
    assert.equal(resolveAnalyzeTerminalStatus(FULL, { status: "SUCCEEDED" }), "SUCCEEDED");
  });

  it("the AI_ANALYZE handler calls finalizeAnalysisJob ONLY inside the full-success branch", () => {
    // AI_ANALYZE's implementation lives in ai-job-handlers-legacy.ts — see
    // lib/ai-job-handlers.ts's header comment: it now only re-exports the
    // legacy handlers and locally overrides EXTRACT_TEXT's getHandler branch.
    const src = readFileSync("lib/ai-job-handlers-legacy.ts", "utf8");
    assert.match(src, /if \(isFullAiSuccess\(result\)\) \{[\s\S]*?finalizeAnalysisJob\(result\.jobId, ctx\.userId\)/);
    // finalizeAnalysisJob must appear exactly once — partial path must not finalize.
    assert.equal((src.match(/finalizeAnalysisJob\(/g) ?? []).length, 1);
  });

  it("finalizeJob writes canonical requirements AND canonical tender metadata", () => {
    const src = readFileSync("lib/ai-jobs/analysis-job-service.ts", "utf8");
    assert.match(src, /upsertRequirements\(/);
    assert.match(src, /buildCanonicalAnalysisTenderUpdate\(/);
    assert.match(src, /status:\s*failed\.length > 0 \? "PARTIAL_SUCCESS" : "SUCCEEDED"/);
  });
});

// ── Test 3: partial / fallback never promotes, never SUCCEEDED ───────────────
describe("partial / fallback analysis cannot promote or reach SUCCEEDED", () => {
  it("resolveAnalyzeTerminalStatus never returns SUCCEEDED without a finalizer SUCCEEDED", () => {
    assert.equal(resolveAnalyzeTerminalStatus(PARTIAL, null), "PARTIAL_SUCCESS");
    assert.equal(resolveAnalyzeTerminalStatus(FALLBACK_NO_PROGRESS, null), "FAILED");
    // Even a "full shape" result, if the finalizer refuses (weak grounding),
    // must NOT become SUCCEEDED.
    assert.equal(resolveAnalyzeTerminalStatus(FULL, { status: "FAILED", code: "PROMOTION_BLOCKED_WEAK_GROUNDING" }), "FAILED");
    assert.equal(resolveAnalyzeTerminalStatus(FULL, { status: "PARTIAL_SUCCESS" }), "PARTIAL_SUCCESS");
  });

  it("executeAnalysis NEVER writes SUCCEEDED itself (promotion is the gate)", () => {
    const src = readFileSync("lib/engine/analysis-orchestrator.ts", "utf8");
    // The premature `status: ... ? "PARTIAL_SUCCESS" : "SUCCEEDED"` write must be gone.
    assert.doesNotMatch(src, /status:\s*analysisMeta\.isPartial \? "PARTIAL_SUCCESS" : "SUCCEEDED"/);
    // Full success leaves the job RUNNING for the finalizer.
    assert.match(src, /fullAiSuccess\s*[\s\S]*?"RUNNING"/);
    assert.doesNotMatch(src, /status:\s*"SUCCEEDED"/);
  });

  // Retargeted from the deleted lib/ai-jobs/worker.ts (no production importer)
  // to the handler the durable queue actually runs. The property is the same:
  // the recovery path must go through finalizeAnalysisJob rather than deciding
  // a terminal status itself and skipping canonical promotion.
  it("the live handler recovery path also finalizes instead of blindly completing", () => {
    const src = readFileSync("lib/ai-job-handlers-legacy.ts", "utf8");
    assert.match(src, /finalizeAnalysisJob\(result\.jobId, ctx\.userId\)/);
    assert.doesNotMatch(src, /const finalStatus = result\.isPartial \? "PARTIAL_SUCCESS" : "SUCCEEDED"/);
  });
});

// ── Test 4: run-next respects terminal status ────────────────────────────────
describe("run-next respects the handler terminal status", () => {
  it("isTerminalHandlerResult detects the terminal-result contract", () => {
    assert.equal(isTerminalHandlerResult({ terminalStatus: "PARTIAL_SUCCESS", output: {} }), true);
    assert.equal(isTerminalHandlerResult({ terminalStatus: "FAILED", output: {} }), true);
    assert.equal(isTerminalHandlerResult({ requirementCount: 3 }), false);
    assert.equal(isTerminalHandlerResult(null), false);
  });

  it("run-next does NOT call completeJob when the handler returned a terminal status", () => {
    const src = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8");
    assert.match(src, /isTerminalHandlerResult\(result\)/);
    // completeJob must live in the ELSE branch only.
    assert.match(src, /} else \{\s*\n\s*await completeJob\(claimed\.id, result\)/);
  });

  it("AI_ANALYZE is a one-job-per-invocation type (worker breaks after it)", () => {
    const src = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8");
    const match = src.match(/if \(\[([^\]]+)\]\.includes\(claimed\.jobType\)\) break;/);
    assert.ok(match, "run-next must have the single-job-per-tick break list");
    assert.match(match![1], /"AI_ANALYZE"/);
  });
});

// ── Test 1 + 5: panel uses durable background + surfaces worker errors ───────
describe("AIAnalyzePanel uses the durable background workflow", () => {
  const src = readFileSync("components/ai-analyze-panel.tsx", "utf8");

  it("AI Analyze enqueues via the background endpoint (Gap 2: button removed, function retained)", () => {
    assert.match(src, /ai-analyze\?mode=background/);
    assert.match(src, /function handleBackgroundAnalyze/);
  });

  it("does NOT use the direct SSE route for normal analysis", () => {
    assert.doesNotMatch(src, /text\/event-stream/);
    assert.doesNotMatch(src, /getReader\(\)/);
  });

  it("polls the durable job status endpoint", () => {
    assert.match(src, /\/api\/ai-jobs\/\$\{jobId\}/);
    assert.match(src, /run-next\?jobType=AI_ANALYZE/);
  });

  it("surfaces worker 401 / 403 / 500 instead of swallowing them", () => {
    assert.match(src, /workerRes\.status === 401/);
    assert.match(src, /workerRes\.status === 403/);
    assert.match(src, /workerRes\.status >= 500/);
    assert.match(src, /setWorkerError\(/);
    // and renders the worker error
    assert.match(src, /\{workerError &&/);
  });
});

// ── Test 6: background endpoint returns 202 QUEUED via createAnalysisJob ──────
describe("background endpoint lifecycle: queued → running → succeeded", () => {
  const route = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf8");

  it("mode=background enqueues with createAnalysisJob and returns 202 QUEUED", () => {
    assert.match(route, /searchParams\.get\("mode"\) === "background"/);
    assert.match(route, /createAnalysisJob\(\{ tenderId: id, userId \}\)/);
    assert.match(route, /status:\s*"QUEUED"[\s\S]*?\{ status: 202 \}/);
  });

  it("requires ADMIN/PROPOSAL_MANAGER and verifies tender ownership before enqueue", () => {
    assert.match(route, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    // ownership: tender scoped to userId
    assert.match(route, /prisma\.tender\.findFirst\(\{\s*\n?\s*where: \{ id, userId \}/);
  });

  it("validates extraction quality before enqueueing", () => {
    assert.match(route, /assessExtractionQuality\(/);
    assert.match(route, /EXTRACTION_NOT_READY|EXTRACTION_CORRUPTED_AI_SKIPPED/);
  });

  it("createAnalysisJob creates a QUEUED job; claim policy promotes it to RUNNING", () => {
    const svc = readFileSync("lib/ai-jobs/analysis-job-service.ts", "utf8");
    assert.match(svc, /status:\s*"QUEUED"/);
    const claim = readFileSync("lib/job-claim-policy.ts", "utf8");
    assert.match(claim, /SET "status" = 'RUNNING'/);
  });
});

// ── Resume + auto-retry-when-available (permanent fix) ───────────────────────
describe("durable resume — a stopped run continues where it left off", () => {
  const svc = readFileSync("lib/ai-jobs/analysis-job-service.ts", "utf8");
  const orch = readFileSync("lib/engine/analysis-orchestrator.ts", "utf8");

  it("createAnalysisJob re-arms a PARTIAL_SUCCESS/FAILED job to QUEUED so run-next can re-claim it", () => {
    // claimJobForCaller only claims QUEUED rows; without re-arming, a partial
    // job is un-runnable and Resume does nothing.
    // PR #1038 refactored createAnalysisJob to use a $transaction with a
    // re-check inside (closing a race window). The variable was renamed from
    // `job` to `existing`, and the PARTIAL_SUCCESS/FAILED re-arm is now the
    // fall-through after the QUEUED/RUNNING early-return and the nonRetryable
    // check. The safety property is preserved: PARTIAL_SUCCESS/FAILED jobs
    // are re-armed to QUEUED with cleared terminal stamps.
    assert.match(svc, /status: \{ in: \["QUEUED", "RUNNING", "PARTIAL_SUCCESS", "FAILED"\] \}/);
    // Verify the re-arm update resets to QUEUED with cleared stamps
    assert.match(svc, /data: \{ status: "QUEUED", startedAt: null, finishedAt: null, errorMessage: null \}/);
    // Verify the nonRetryable guard exists (PR #1038 addition — prevents
    // infinite retry loops on permanently-failed jobs)
    assert.match(svc, /nonRetryable/);
    // Verify the transaction wraps the find-or-create (race-condition fix)
    assert.match(svc, /\$transaction/);
  });

  it("executeAnalysis resumes from the durable checkpoints (last SUCCEEDED chunk)", () => {
    assert.match(orch, /getCompletedChunkResults\(tenderId, userId, contentHash\)/);
    assert.match(orch, /durableCompleted\.length > previousChunkResults\.length/);
  });

  it("executeAnalysis records the provider-cooldown expiry for auto-retry timing", () => {
    assert.match(orch, /getMinCooldownExpiryMs\(\)/);
    assert.match(orch, /providerRetryAfterMs/);
  });
});

describe("auto-retry-when-available resumes via the durable path", () => {
  it("panel schedules auto-retry from the cooldown signal (Gap 2: Retry now button removed)", () => {
    const panel = readFileSync("components/ai-analyze-panel.tsx", "utf8");
    assert.match(panel, /function scheduleAutoRetry/);
    assert.match(panel, /function cancelAutoRetry/);
    assert.match(panel, /job\.output\?\.providerRetryAfterMs/);
    assert.match(panel, /scheduleAutoRetry\(Math\.max\(providerRetryAfterMs, 5_000\)/);
    // the auto-retry calls the durable handler (so it resumes), not SSE
    assert.match(panel, /void handleBackgroundAnalyze\(\)/);
    assert.match(panel, /resumes from the last completed chunk/);
  });
});

// ── Test 7: provider failure keeps generation/export/Final ZIP blocked ───────
describe("provider failure → partial/failed → downstream stays blocked", () => {
  it("finalizeJob caps extraction status to PARTIAL / REGEX_FALLBACK on incomplete analysis", () => {
    const svc = readFileSync("lib/ai-jobs/analysis-job-service.ts", "utf8");
    assert.match(svc, /analysisExtractionStatus:\s*"REGEX_FALLBACK_UNAPPROVED"/);
    assert.match(svc, /"PARTIAL_EXTRACTION_AI_ANALYZED"\s*:\s*"FULL_EXTRACTION_AI_ANALYZED"/);
  });

  it("finalizeJob blocks promotion when mandatory requirements lack source grounding", () => {
    const svc = readFileSync("lib/ai-jobs/analysis-job-service.ts", "utf8");
    assert.match(svc, /PROMOTION_BLOCKED_WEAK_GROUNDING/);
  });

  it("the generation/export gate fails closed on an unapproved/incomplete analysis state", () => {
    // The central gate evaluates a resolved analysisState and fails closed on
    // REGEX_FALLBACK_UNAPPROVED (and the other non-approved states), so a
    // PARTIAL/FAILED analysis keeps Generate Docs, export, and Final ZIP blocked.
    const gate = readFileSync("lib/engine/generation-readiness-gate.ts", "utf8");
    assert.match(gate, /analysisState/);
    assert.match(gate, /REGEX_FALLBACK_UNAPPROVED/);
  });

  it("a partial result never creates GeneratedDocument rows (no generation in the handler)", () => {
    const handlers = readFileSync("lib/ai-job-handlers-legacy.ts", "utf8");
    // The AI_ANALYZE handler must not create generated documents.
    const analyzeBlock = handlers.slice(handlers.indexOf("AI_ANALYZE:"), handlers.indexOf("PROPOSAL_GENERATION:"));
    assert.doesNotMatch(analyzeBlock, /generatedDocument\.create/);
  });
});
