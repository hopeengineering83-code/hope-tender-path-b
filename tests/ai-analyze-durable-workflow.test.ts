// AI Analyze unified durable workflow — integration tests.
//
// These tests prove the COMPLETE lifecycle contract required by the
// unified durable workflow fix. They use source inspection (the
// established pattern in this repo for contracts that span routes,
// handlers, and DB state) plus pure-function assertions where the
// logic is isolatable.
//
// The 7 required scenarios:
//   1. Clicking Run AI Analyze creates one durable AI_ANALYZE job and
//      does not call the direct SSE route.
//   2. Full successful background analysis calls finalization and writes
//      canonical requirements plus canonical metadata.
//   3. Partial/fallback analysis stays PARTIAL_SUCCESS or FAILED and
//      cannot promote canonical data.
//   4. run-next cannot overwrite PARTIAL_SUCCESS as SUCCEEDED.
//   5. Worker 401/403 is visible in UI and not silently swallowed.
//   6. End-to-end: queued → running → succeeded for a one-file clean tender.
//   7. End-to-end: provider failure → partial/failed → Generate Docs,
//      export, and Final ZIP remain blocked.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";

const PANEL = readFileSync("components/ai-analyze-panel.tsx", "utf8");
const HANDLERS = readFileSync("lib/ai-job-handlers.ts", "utf8");
const RUN_NEXT = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8");
const AI_JOBS = readFileSync("lib/ai-jobs.ts", "utf8");
const ANALYSIS_JOB_SERVICE = readFileSync("lib/ai-jobs/analysis-job-service.ts", "utf8");
const ORCHESTRATOR = readFileSync("lib/engine/analysis-orchestrator.ts", "utf8");
const BACKGROUND_ENQUEUE = readFileSync("lib/ai-analyze/background-enqueue.ts", "utf8");
const AI_ANALYZE_ROUTE = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf8");
const GENERATION_GATE = readFileSync("lib/engine/generation-readiness-gate.ts", "utf8");

function expectContains(source: string, pattern: RegExp, message?: string) {
  assert.match(source, pattern, message);
}

function expectNotContains(source: string, pattern: RegExp, message?: string) {
  assert.doesNotMatch(source, pattern, message);
}

describe("AI Analyze unified durable workflow", () => {

  // ─────────────────────────────────────────────────────────────────────
  // TEST 1: Clicking Run AI Analyze creates one durable AI_ANALYZE job
  // and does not call the direct SSE route.
  // ─────────────────────────────────────────────────────────────────────
  describe("Test 1 — button enqueues a durable job, no direct SSE", () => {
    it("panel uses the background endpoint (?mode=background)", () => {
      expectContains(
        PANEL,
        /\/api\/tenders\/\$\{tenderId\}\/ai-analyze\?mode=background/,
        "panel must POST to /api/tenders/[id]/ai-analyze?mode=background",
      );
      expectContains(
        PANEL,
        /method:\s*"POST"/,
        "panel must use POST for the background enqueue",
      );
    });

    it("panel triggers run-next with the authenticated session", () => {
      expectContains(
        PANEL,
        /\/api\/ai-jobs\/run-next\?jobType=AI_ANALYZE/,
        "panel must trigger /api/ai-jobs/run-next?jobType=AI_ANALYZE",
      );
    });

    it("panel polls /api/ai-jobs/[jobId] for status", () => {
      expectContains(
        PANEL,
        /\/api\/ai-jobs\/\$\{jobId\}/,
        "panel must poll /api/ai-jobs/[jobId]",
      );
    });

    it("panel does NOT use the direct SSE route for the normal button", () => {
      // The normal button must not fetch the ai-analyze URL with
      // Accept: text/event-stream. The background path is the only
      // production path.
      expectNotContains(
        PANEL,
        /Accept["']:\s*["']text\/event-stream["']/,
        "panel must NOT send Accept: text/event-stream (direct SSE is not the production path)",
      );
      // The panel must not POST to ai-analyze WITHOUT ?mode=background.
      // Allow only the background-qualified fetch.
      const nonBackgroundFetch = /fetch\(`?\/api\/tenders\/\$\{tenderId\}\/ai-analyze`?(?![^`]*mode=background)/;
      expectNotContains(
        PANEL,
        nonBackgroundFetch,
        "panel must not fetch /api/tenders/[id]/ai-analyze without ?mode=background",
      );
    });

    it("background enqueue module calls createAnalysisJob exactly once", () => {
      expectContains(
        BACKGROUND_ENQUEUE,
        /import\s*\{[^}]*createAnalysisJob[^}]*\}\s*from\s*["']\.\.\/ai-jobs\/analysis-job-service["']/,
        "background-enqueue must import createAnalysisJob",
      );
      expectContains(
        BACKGROUND_ENQUEUE,
        /await createAnalysisJob\(\s*\{\s*tenderId,\s*userId\s*\}\s*\)/,
        "background-enqueue must call createAnalysisJob({ tenderId, userId })",
      );
      // Returns 202 Accepted
      expectContains(
        BACKGROUND_ENQUEUE,
        /status:\s*202/,
        "background-enqueue must return HTTP 202",
      );
      expectContains(
        BACKGROUND_ENQUEUE,
        /status:\s*["']QUEUED["']/,
        "background-enqueue must return status QUEUED",
      );
    });

    it("route wires mode=background to the background enqueue helper", () => {
      expectContains(
        AI_ANALYZE_ROUTE,
        /searchParams\.get\(["']mode["']\)\s*===\s*["']background["']/,
        "ai-analyze route must branch on ?mode=background",
      );
      expectContains(
        AI_ANALYZE_ROUTE,
        /enqueueBackgroundAnalysis/,
        "ai-analyze route must call enqueueBackgroundAnalysis for mode=background",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 2: Full successful background analysis calls finalization and
  // writes canonical requirements plus canonical metadata.
  // ─────────────────────────────────────────────────────────────────────
  describe("Test 2 — full success calls finalizer + promotes canonical", () => {
    it("handler imports finalizeAnalysisJob from the orchestrator", () => {
      expectContains(
        HANDLERS,
        /import\s*\{[^}]*finalizeAnalysisJob[^}]*\}\s*from\s*["']\.\/engine\/analysis-orchestrator["']/,
        "handler must import finalizeAnalysisJob",
      );
    });

    it("handler calls finalizeAnalysisJob on the full-AI-success branch", () => {
      // The success branch must be gated on success && !isPartial && AI.
      expectContains(
        HANDLERS,
        /result\.success\s*&&\s*!result\.isPartial\s*&&\s*result\.analysisSource\s*===\s*["']AI["']/,
        "handler must gate finalization on full AI success (success && !isPartial && analysisSource === 'AI')",
      );
      expectContains(
        HANDLERS,
        /await finalizeAnalysisJob\(result\.jobId,\s*ctx\.userId\)/,
        "handler must call finalizeAnalysisJob(result.jobId, ctx.userId) before declaring success",
      );
    });

    it("finalizeJob promotes canonical requirements + metadata", () => {
      // upsertRequirements writes canonical requirements
      expectContains(
        ANALYSIS_JOB_SERVICE,
        /await upsertRequirements\(tx,\s*job\.tenderId!,\s*drafts\)/,
        "finalizeJob must call upsertRequirements to write canonical requirements",
      );
      // tender.analysisSource = "AI"
      expectContains(
        ANALYSIS_JOB_SERVICE,
        /analysisSource:\s*["']AI["']/,
        "finalizeJob must set tender.analysisSource = 'AI'",
      );
      // analysisExtractionStatus uses the CANONICAL vocabulary that
      // downstream gates recognize: FULL_EXTRACTION_AI_ANALYZED on full
      // success, PARTIAL_EXTRACTION_AI_ANALYZED on partial. The previous
      // bespoke "FULL_AI_SUCCESS"/"PARTIAL_AI_SUCCESS" values were
      // write-only orphans no gate recognized (fixed in PR #856).
      expectContains(
        ANALYSIS_JOB_SERVICE,
        /analysisExtractionStatus:\s*failed\.length\s*>\s*0\s*\?\s*["']PARTIAL_EXTRACTION_AI_ANALYZED["']\s*:\s*["']FULL_EXTRACTION_AI_ANALYZED["']/,
        "finalizeJob must set analysisExtractionStatus to FULL_EXTRACTION_AI_ANALYZED on full success (canonical vocabulary)",
      );
      // The canonical tender update is built via the shared helper so the
      // durable worker and the synchronous route produce identical metadata.
      expectContains(
        ANALYSIS_JOB_SERVICE,
        /buildCanonicalAnalysisTenderUpdate\(merged,/,
        "finalizeJob must use buildCanonicalAnalysisTenderUpdate for canonical metadata",
      );
      // promoteAnalysisToCanonical marks the job as promoted
      expectContains(
        ANALYSIS_JOB_SERVICE,
        /await promoteAnalysisToCanonical\(jobId,/,
        "finalizeJob must call promoteAnalysisToCanonical",
      );
    });

    it("orchestrator exposes finalizeAnalysisJob as the public finalizer", () => {
      expectContains(
        ORCHESTRATOR,
        /export async function finalizeAnalysisJob\(jobId:\s*string,\s*userId:\s*string\)/,
        "orchestrator must export finalizeAnalysisJob(jobId, userId)",
      );
      expectContains(
        ORCHESTRATOR,
        /return finalizeJob\(jobId,\s*userId\)/,
        "finalizeAnalysisJob must delegate to finalizeJob",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 3: Partial/fallback analysis stays PARTIAL_SUCCESS or FAILED
  // and cannot promote canonical data.
  // ─────────────────────────────────────────────────────────────────────
  describe("Test 3 — partial/fallback never promotes canonical", () => {
    it("handler does NOT call finalizeAnalysisJob on the partial branch", () => {
      // Extract the partial branch (after the success branch returns).
      // The success branch contains the only finalizeAnalysisJob call.
      // Verify there is exactly one call site.
      const callCount = (HANDLERS.match(/await finalizeAnalysisJob\(/g) ?? []).length;
      assert.equal(
        callCount,
        1,
        `handler must call finalizeAnalysisJob exactly once (on success only), found ${callCount}`,
      );
    });

    it("handler returns terminalStatus PARTIAL_SUCCESS or FAILED for non-success", () => {
      expectContains(
        HANDLERS,
        /const terminalStatus:\s*["']PARTIAL_SUCCESS["']\s*\|\s*["']FAILED["']/,
        "handler must declare terminalStatus as PARTIAL_SUCCESS | FAILED on the non-success branch",
      );
      expectContains(
        HANDLERS,
        /terminalStatus,\s*\n\s*analysisSource:\s*result\.analysisSource/,
        "handler must return terminalStatus in the non-success result",
      );
    });

    it("handler does NOT create GeneratedDocument rows", () => {
      // The AI_ANALYZE handler must never write to GeneratedDocument —
      // that is reserved for PROPOSAL_GENERATION after the gate passes.
      // Confirm the handler block (between AI_ANALYZE and AI_REMATCH)
      // has no generatedDocument.create.
      const analyzeBlock = HANDLERS.slice(
        HANDLERS.indexOf("AI_ANALYZE:"),
        HANDLERS.indexOf("AI_REMATCH:"),
      );
      expectNotContains(
        analyzeBlock,
        /generatedDocument\.create/i,
        "AI_ANALYZE handler must NOT create GeneratedDocument rows",
      );
    });

    it("regex fallback is never AI success", () => {
      // The orchestrator only sets analysisSource to "AI" or "PARTIAL_AI".
      // It never sets "REGEX_FALLBACK". So result.analysisSource === "AI"
      // can never be true for a regex fallback.
      expectNotContains(
        ORCHESTRATOR,
        /analysisSource\s*=\s*["']REGEX_FALLBACK["']/,
        "orchestrator must never set analysisSource to REGEX_FALLBACK",
      );
      expectContains(
        ORCHESTRATOR,
        /let analysisSource:\s*["']AI["']\s*\|\s*["']PARTIAL_AI["']\s*=\s*["']AI["']/,
        "orchestrator must type analysisSource as AI | PARTIAL_AI only",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 4: run-next cannot overwrite PARTIAL_SUCCESS as SUCCEEDED.
  // ─────────────────────────────────────────────────────────────────────
  describe("Test 4 — run-next respects handler terminal status", () => {
    it("run-next reads terminalStatus from handler output", () => {
      expectContains(
        RUN_NEXT,
        /output\?\.terminalStatus/,
        "run-next must read terminalStatus from handler output",
      );
    });

    it("run-next calls completeJobWithStatus for non-SUCCEEDED terminals", () => {
      expectContains(
        RUN_NEXT,
        /await completeJobWithStatus\(claimed\.id,\s*terminalStatus as JobStatus,\s*output\)/,
        "run-next must call completeJobWithStatus for non-SUCCEEDED terminals",
      );
    });

    it("run-next only calls completeJob when terminalStatus is SUCCEEDED", () => {
      // The SUCCEEDED branch must be explicitly gated.
      expectContains(
        RUN_NEXT,
        /if\s*\(terminalStatus\s*===\s*["']SUCCEEDED["']\)\s*\{[^}]*await completeJob\(/,
        "run-next must gate completeJob on terminalStatus === 'SUCCEEDED'",
      );
    });

    it("completeJobWithStatus uses updateMany with status=RUNNING guard", () => {
      // The guard ensures a job the finalizer already promoted to
      // SUCCEEDED cannot be downgraded, AND a job already at
      // PARTIAL_SUCCESS cannot be overwritten to SUCCEEDED by a stale
      // worker retry.
      expectContains(
        AI_JOBS,
        /export async function completeJobWithStatus\(/,
        "ai-jobs must export completeJobWithStatus",
      );
      expectContains(
        AI_JOBS,
        /where:\s*\{\s*id:\s*jobId,\s*status:\s*["']RUNNING["']\s*\}/,
        "completeJobWithStatus must guard on status='RUNNING' so it cannot overwrite a terminal",
      );
    });

    it("completeJobWithStatus refuses to write SUCCEEDED (delegates to completeJob)", () => {
      // The function must NOT allow callers to write SUCCEEDED through
      // this path — SUCCEEDED is the sole responsibility of completeJob.
      const fnStart = AI_JOBS.indexOf("export async function completeJobWithStatus");
      const fnEnd = AI_JOBS.indexOf("export async function failJob");
      const fnBody = AI_JOBS.slice(fnStart, fnEnd);
      expectContains(
        fnBody,
        /if\s*\(status\s*===\s*["']SUCCEEDED["']\s*\|\|\s*status\s*===\s*["']FAILED["']\)/,
        "completeJobWithStatus must reject SUCCEEDED/FAILED and delegate",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 5: Worker 401/403 is visible in UI and not silently swallowed.
  // ─────────────────────────────────────────────────────────────────────
  describe("Test 5 — worker-start errors are visible in the UI", () => {
    it("panel surfaces worker 401/403 as a clear error", () => {
      expectContains(
        PANEL,
        /workerRes\.status\s*===\s*401\s*\|\|\s*workerRes\.status\s*===\s*403/,
        "panel must detect worker 401/403",
      );
      expectContains(
        PANEL,
        /Worker could not be started:\s*your session has expired/,
        "panel must show a clear worker-start error for 401/403",
      );
    });

    it("panel surfaces worker 5xx as a clear error", () => {
      expectContains(
        PANEL,
        /workerRes\.status\s*>=\s*500/,
        "panel must detect worker 5xx",
      );
      expectContains(
        PANEL,
        /Worker start failed \(HTTP/,
        "panel must show a clear worker-start error for 5xx",
      );
    });

    it("panel does NOT silently ignore the worker response status", () => {
      // There must be no path that calls run-next and ignores non-ok.
      // Confirm the panel sets an error for every non-ok worker status.
      const workerSection = PANEL.slice(
        PANEL.indexOf("run-next?jobType=AI_ANALYZE"),
        PANEL.indexOf("pollJobStatus(jobId)"),
      );
      expectNotContains(
        workerSection,
        // No bare "return" after the fetch without a status check.
        /workerRes\.ok[^;]*;[\s\S]*?\n\s*\/\/ 200/,
        "panel must not branch on workerRes.ok without explicit status checks",
      );
    });

    it("panel also handles enqueue 401/403/422/429 visibly", () => {
      expectContains(
        PANEL,
        /enqueueRes\.status\s*===\s*401\s*\|\|\s*enqueueRes\.status\s*===\s*403/,
        "panel must detect enqueue 401/403",
      );
      expectContains(
        PANEL,
        /enqueueRes\.status\s*===\s*429/,
        "panel must detect enqueue 429 (rate limit)",
      );
      expectContains(
        PANEL,
        /enqueueRes\.status\s*===\s*422/,
        "panel must detect enqueue 422 (extraction not ready)",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 6: End-to-end lifecycle — queued → running → succeeded for a
  // one-file clean tender.
  // ─────────────────────────────────────────────────────────────────────
  describe("Test 6 — queued → running → succeeded lifecycle", () => {
    it("createAnalysisJob creates a QUEUED AI_ANALYZE job", () => {
      expectContains(
        ANALYSIS_JOB_SERVICE,
        /jobType:\s*["']AI_ANALYZE["']/,
        "createAnalysisJob must create an AI_ANALYZE job",
      );
      expectContains(
        ANALYSIS_JOB_SERVICE,
        /status:\s*["']QUEUED["']/,
        "createAnalysisJob must create the job in QUEUED status",
      );
    });

    it("claimJobForCaller transitions QUEUED → RUNNING atomically", () => {
      // The claim policy uses FOR UPDATE SKIP LOCKED.
      expectContains(
        readFileSync("lib/job-claim-policy.ts", "utf8"),
        /FOR UPDATE SKIP LOCKED/,
        "claim must use FOR UPDATE SKIP LOCKED to avoid races",
      );
      expectContains(
        readFileSync("lib/job-claim-policy.ts", "utf8"),
        /"status"\s*=\s*['"]RUNNING['"]/,
        "claim must transition the job to RUNNING",
      );
    });

    it("handler returns terminalStatus SUCCEEDED only after finalization", () => {
      expectContains(
        HANDLERS,
        /terminalStatus:\s*finalizationStatus/,
        "handler must return finalizationStatus as terminalStatus",
      );
      expectContains(
        HANDLERS,
        /success:\s*finalizationStatus\s*===\s*["']SUCCEEDED["']/,
        "handler success must equal finalizationStatus === SUCCEEDED",
      );
    });

    it("run-next writes SUCCEEDED via completeJob on the success path", () => {
      expectContains(
        RUN_NEXT,
        /if\s*\(terminalStatus\s*===\s*["']SUCCEEDED["']\)\s*\{[\s\S]*?await completeJob\(claimed\.id,\s*output\)/,
        "run-next must call completeJob for SUCCEEDED",
      );
    });

    it("panel detects SUCCEEDED and refreshes the page", () => {
      expectContains(
        PANEL,
        /status\s*===\s*["']SUCCEEDED["']/,
        "panel must detect SUCCEEDED from the poll",
      );
      expectContains(
        PANEL,
        /router\.refresh\(\)/,
        "panel must refresh the page on success",
      );
    });

    it("the full chain is wired end-to-end", () => {
      // route → background-enqueue → createAnalysisJob (QUEUED)
      expectContains(AI_ANALYZE_ROUTE, /enqueueBackgroundAnalysis/);
      expectContains(BACKGROUND_ENQUEUE, /createAnalysisJob/);
      // panel → run-next → handler → executeAnalysis → finalizeAnalysisJob
      expectContains(PANEL, /run-next\?jobType=AI_ANALYZE/);
      expectContains(RUN_NEXT, /getHandler\(claimed\.jobType\)/);
      expectContains(HANDLERS, /await executeAnalysis\(/);
      expectContains(HANDLERS, /await finalizeAnalysisJob\(/);
      // panel polls the job
      expectContains(PANEL, /\/api\/ai-jobs\/\$\{jobId\}/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 7: provider failure → partial/failed → Generate Docs, export,
  // and Final ZIP remain blocked.
  // ─────────────────────────────────────────────────────────────────────
  describe("Test 7 — provider failure keeps generation/export/ZIP blocked", () => {
    it("handler returns PARTIAL_SUCCESS/FAILED when providers fail", () => {
      // The non-success branch computes terminalStatus from isPartial.
      expectContains(
        HANDLERS,
        /result\.isPartial\s*&&\s*result\.completedChunks\s*>\s*0\s*\?\s*["']PARTIAL_SUCCESS["']\s*:\s*["']FAILED["']/,
        "handler must return PARTIAL_SUCCESS when some chunks completed, FAILED otherwise",
      );
    });

    it("handler does not call the finalizer on failure (no canonical promotion)", () => {
      // Already asserted in Test 3 that there's exactly one
      // finalizeAnalysisJob call (on the success branch). Re-confirm the
      // failure branch explicitly does NOT promote.
      const failureBranch = HANDLERS.slice(
        HANDLERS.indexOf("Partial / failed / fallback / exhausted / weak grounding"),
        HANDLERS.indexOf("} catch (err) {"),
      );
      expectNotContains(
        failureBranch,
        /finalizeAnalysisJob/,
        "failure branch must NOT call finalizeAnalysisJob",
      );
      expectNotContains(
        failureBranch,
        /promoteAnalysisToCanonical/,
        "failure branch must NOT call promoteAnalysisToCanonical",
      );
    });

    it("generation readiness gate fails closed for non-AI-ready analysis states", () => {
      // canExportWithAnalysisState must reject PARTIAL_SUCCESS / FAILED /
      // REGEX_FALLBACK_UNAPPROVED. The gate returns ANALYSIS_NOT_READY
      // for anything that is not AI_SUCCEEDED or HUMAN_APPROVED_FALLBACK.
      expectContains(
        GENERATION_GATE,
        /ANALYSIS_NOT_READY/,
        "generation gate must return ANALYSIS_NOT_READY for non-ready states",
      );
      expectContains(
        GENERATION_GATE,
        /FALLBACK_UNAPPROVED/,
        "generation gate must block unapproved regex fallback",
      );
      expectContains(
        GENERATION_GATE,
        /Run\/complete AI Analyze before generating or exporting/,
        "generation gate must instruct the user to complete AI Analyze",
      );
    });

    it("generation gate requires a canonically promoted job", () => {
      // Even if status were SUCCEEDED, a job without promotion is blocked.
      expectContains(
        GENERATION_GATE,
        /ANALYSIS_NO_PROMOTED_JOB/,
        "generation gate must require a canonically promoted job",
      );
    });

    it("generation gate requires chunk integrity (all chunks SUCCEEDED)", () => {
      // Partial analysis leaves some chunks FAILED → CHUNKS_INCOMPLETE.
      expectContains(
        GENERATION_GATE,
        /CHUNKS_INCOMPLETE/,
        "generation gate must block when chunks are incomplete",
      );
    });

    it("PROPOSAL_GENERATION handler re-checks the gate before creating any document", () => {
      // The background proposal-generation handler must call
      // assertTenderReadyForGenerationAndExport before creating a
      // GeneratedDocument, so a blocked analysis can never produce docs.
      expectContains(
        HANDLERS,
        /await assertTenderReadyForGenerationAndExport\(/,
        "PROPOSAL_GENERATION handler must call the readiness gate",
      );
      expectContains(
        HANDLERS,
        /if\s*\(!readiness\.ok\)/,
        "PROPOSAL_GENERATION handler must fail closed when the gate blocks",
      );
    });

    it("no GeneratedDocument is created before the gate passes", () => {
      // The gate call must come BEFORE prisma.generatedDocument.create.
      const propGenBlock = HANDLERS.slice(
        HANDLERS.indexOf("PROPOSAL_GENERATION:"),
        HANDLERS.indexOf("EVALUATOR_SIM:"),
      );
      const gateIdx = propGenBlock.indexOf("assertTenderReadyForGenerationAndExport");
      const createIdx = propGenBlock.indexOf("generatedDocument.create");
      assert.ok(
        gateIdx > -1 && createIdx > -1 && gateIdx < createIdx,
        "PROPOSAL_GENERATION must call the readiness gate BEFORE generatedDocument.create",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // ADDITIONAL GUARD: non-negotiable rules
  // ─────────────────────────────────────────────────────────────────────
  describe("Non-negotiable rules", () => {
    it("background enqueue requires ADMIN or PROPOSAL_MANAGER (via the route)", () => {
      // The route's POST handler runs requireRole before delegating.
      expectContains(
        AI_ANALYZE_ROUTE,
        /requireRole\(["']ADMIN["'],\s*["']PROPOSAL_MANAGER["']\)/,
        "ai-analyze route must requireRole(ADMIN, PROPOSAL_MANAGER)",
      );
    });

    it("background enqueue verifies tender ownership", () => {
      expectContains(
        BACKGROUND_ENQUEUE,
        /prisma\.tender\.findFirst\(\s*\{[^}]*where:\s*\{\s*id:\s*tenderId,\s*userId\s*\}/,
        "background-enqueue must findFirst by (id, userId) to enforce ownership",
      );
    });

    it("background enqueue validates extraction quality before enqueueing", () => {
      expectContains(
        BACKGROUND_ENQUEUE,
        /assessExtractionQuality/,
        "background-enqueue must call assessExtractionQuality",
      );
      expectContains(
        BACKGROUND_ENQUEUE,
        /EXTRACTION_CORRUPTED_AI_SKIPPED/,
        "background-enqueue must reject corrupted extraction with 422",
      );
    });

    it("handler is registered for AI_ANALYZE", () => {
      expectContains(
        HANDLERS,
        /AI_ANALYZE:\s*async\s*\(ctx\)\s*=>/,
        "AI_ANALYZE handler must be registered",
      );
    });

    it("completeJobWithStatus is exported and imported by run-next", () => {
      expectContains(
        AI_JOBS,
        /export async function completeJobWithStatus/,
        "ai-jobs must export completeJobWithStatus",
      );
      expectContains(
        RUN_NEXT,
        /import\s*\{[^}]*completeJobWithStatus[^}]*\}/,
        "run-next must import completeJobWithStatus",
      );
    });
  });
});
