// AI job handlers — maps JobType to the actual workflow function.
//
// Each handler:
//   • Receives the job's input + the tenderId/userId from the AiJob row
//   • Records step progress via recordStep()
//   • Throws on failure (the worker catches and marks job FAILED)
//   • Returns a serialisable output that's stored in AiJob.output
//
// The worker (/api/ai-jobs/run-next) claims the next QUEUED job, looks
// up the handler for its jobType, executes it, and marks the job
// SUCCEEDED or FAILED based on the result.
//
// Why each handler exists:
//   ENGINE_RUN              — escape 60s cap on full engine pipeline (large tenders)
//   PROPOSAL_GENERATION     — escape 60s cap on full-proposal generation
//   EVALUATOR_SIM           — async 4-persona evaluator panel simulation
//   COPILOT_DEEP_ANALYSIS   — async tender copilot Q&A (frees the request for follow-up actions)
//   PROFILE_FACT_EXTRACTION — async pure-regex fact harvest from company/project/tender prose

import { recordStep, type JobType } from "./ai-jobs";
import { resolveProposalNarrativeText } from "./engine/proposal-narrative-resolver";
import { checkEnginePostconditions } from "./engine/engine-postconditions";
import { runTenderEngine } from "./engine/run-tender-engine";
import { executeAnalysis, finalizeAnalysisJob } from "./engine/analysis-orchestrator";
import { prisma } from "./prisma";
import { simulateEvaluatorPanel } from "./engine/evaluator-simulator";
import { answerTenderCopilotQuestion, type TenderCopilotContext } from "./engine/tender-ai-copilot";
import { extractCompanyFacts } from "./engine/company-fact-extractor";
import { generateTenderDocuments } from "./engine/generate-elite";
import { applyActiveUploadedLetterheadToTenderDocuments } from "./engine/apply-active-letterhead";
import { assertTenderReadyForGenerationAndExport } from "./engine/generation-readiness-gate";
import { ingestCompanyVault } from "./company-vault-ingestion";
import { reextractAllCompanyDocuments, type ReextractAllResult } from "./company-vault-reextraction";
import { cleanupSupportDocImportedRecords } from "./company-support-doc-cleanup";
import { reconcileAutomaticRequirementCoverage } from "./engine/reconcile-automatic-requirement-coverage";
import { classifyStageRetry } from "./engine/stage-retry-policy";
import { recordSafeStageEvent } from "./engine/stage-observability";
import { logAction } from "./audit";
import { logger } from "./observability";

export interface JobContext {
  jobId: string;
  userId: string;
  tenderId: string | null;
  input: Record<string, unknown>;
}

/**
 * Terminal-status result contract.
 *
 * Most handlers return a plain output object and let the worker
 * (`/api/ai-jobs/run-next`) call `completeJob()`, which writes SUCCEEDED.
 *
 * The AI_ANALYZE handler is different: it drives the job to its own terminal
 * state (SUCCEEDED only after canonical promotion via finalizeAnalysisJob;
 * PARTIAL_SUCCESS / FAILED otherwise). When a handler returns this shape the
 * worker MUST respect `terminalStatus` and MUST NOT call `completeJob()` —
 * blindly completing would corrupt a PARTIAL_SUCCESS/FAILED analysis into a
 * SUCCEEDED state and falsely unlock generation/export.
 */
export type JobHandlerTerminalResult = {
  terminalStatus: "SUCCEEDED" | "PARTIAL_SUCCESS" | "FAILED" | "SUPERSEDED";
  output: Record<string, unknown>;
  code?: string;
  retryable?: boolean;
  correlationId?: string;
};

export type JobHandlerResult = Record<string, unknown> | JobHandlerTerminalResult;

export function isTerminalHandlerResult(value: unknown): value is JobHandlerTerminalResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      "terminalStatus" in (value as Record<string, unknown>) &&
      typeof (value as JobHandlerTerminalResult).terminalStatus === "string",
  );
}

export type JobHandler = (ctx: JobContext) => Promise<JobHandlerResult>;

// ─── AI_ANALYZE terminal-status decision (pure, unit-tested) ─────────────────
// Centralises the rules that the AI_ANALYZE handler uses so they can be
// verified without a database:
//   • Full AI success (success && !isPartial && no error) is the ONLY case that
//     may finalize and reach SUCCEEDED — and only if the finalizer actually
//     promoted canonical data (returns SUCCEEDED).
//   • Partial / fallback / provider-exhausted / error runs NEVER finalize and
//     NEVER become SUCCEEDED. They preserve PARTIAL_SUCCESS (any progress) or
//     FAILED (no progress).
export type AnalyzeExecOutcome = {
  success: boolean;
  isPartial: boolean;
  errorMessage?: string;
  completedChunks: number;
};

export type AnalyzeFinalizeOutcome = {
  // finalizeJob() infers a widened `string` status across its return branches,
  // so accept string here; the resolver compares against the canonical literals.
  status: string;
  code?: string;
};

export function isFullAiSuccess(exec: AnalyzeExecOutcome): boolean {
  return exec.success === true && exec.isPartial === false && !exec.errorMessage;
}

export function resolveAnalyzeTerminalStatus(
  exec: AnalyzeExecOutcome,
  finalize: AnalyzeFinalizeOutcome | null,
): "SUCCEEDED" | "PARTIAL_SUCCESS" | "FAILED" {
  if (isFullAiSuccess(exec)) {
    // Promotion is the gate for SUCCEEDED. If the finalizer refused (weak
    // grounding → FAILED, superseded → PARTIAL_SUCCESS), honour its decision.
    if (finalize?.status === "SUCCEEDED") return "SUCCEEDED";
    if (finalize?.status === "PARTIAL_SUCCESS") return "PARTIAL_SUCCESS";
    return "FAILED";
  }
  // Not a full AI success — never promote, never SUCCEEDED. Mirror exactly what
  // executeAnalysis persisted to the job row: any completed chunk → preserve
  // PARTIAL_SUCCESS; nothing completed → FAILED. This keeps the worker's
  // reported status identical to the durable job status.
  if (exec.completedChunks > 0) return "PARTIAL_SUCCESS";
  return "FAILED";
}

function safeJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

const handlers: Partial<Record<JobType, JobHandler>> = {
  // ─── ENGINE_RUN — runs the full tender engine in the background ──────
  // The engine pipeline (analyze → match → AI rematch → write) can
  // exceed 60s on Vercel Hobby for large tenders. Wrapping it in a job
  // means the API route returns immediately with a jobId; the worker
  // (a separate 60s function invocation) runs the engine; the frontend
  // polls /api/ai-jobs/[id] for status.
  ENGINE_RUN: async (ctx) => {
    if (!ctx.tenderId) throw new Error("ENGINE_RUN requires tenderId on the job");
    await recordStep(ctx.jobId, { stepName: "engine.start", message: `Starting engine run for tender ${ctx.tenderId}`, status: "RUNNING" });
    // Heartbeat every 10 s so the stuck-job checker (180 s threshold) never
    // fires on a legitimately slow but progressing AI call. If Vercel kills
    // the function at 60 s, the last heartbeat is at most 10 s old → recovery
    // fires at ~190 s, giving the next worker invocation plenty of time to
    // resume the job.
    const heartbeat = setInterval(() => {
      void recordStep(ctx.jobId, { stepName: "engine.heartbeat", message: "Engine running — waiting for AI response", status: "RUNNING" }).catch(() => {});
    }, 10_000);
    try {
      // Surface granular pipeline progress to the user via recordStep.
      // The engine emits steps at each major milestone (load → company
      // → analyze → match → ai-rematch → compliance → persist). Fire
      // each one as its own step so the frontend poll sees the latest
      // message every 3 seconds. Errors inside recordStep are swallowed
      // (best-effort UX — they shouldn't fail the actual engine run).
      const safeMode = ctx.input?.safe === true;
      const skipAiRematch = ctx.input?.skipAiRematch === true;
      const maxChars = typeof ctx.input?.maxChars === "number" ? ctx.input.maxChars : undefined;

      const result = await runTenderEngine(
        ctx.tenderId,
        ctx.userId,
        (stepName: string, message: string) => {
          // Fire and forget — don't await inside the engine hot path.
          void recordStep(ctx.jobId, { stepName, message, status: "RUNNING" }).catch(() => {});
        },
        { safe: safeMode, skipAiRematch, maxChars },
      );
      clearInterval(heartbeat);
      const postconditions = await checkEnginePostconditions(ctx.tenderId);
      if (!postconditions.ok) {
        await recordStep(ctx.jobId, { stepName: "POSTCONDITION_VALIDATE", message: `Postcondition check failed: ${postconditions.blockers.join(", ")}`, status: "FAILED" });
        return { code: "ENGINE_COMPLETED_WITH_BLOCKERS", blockers: postconditions.blockers, counts: postconditions.counts, failedStage: "POSTCONDITION_VALIDATE", nextAction: "REVIEW_MATCHING_INPUTS" };
      }
      await recordStep(ctx.jobId, { stepName: "engine.complete", message: "Engine run finished successfully", status: "SUCCEEDED" });
      return { result: result as unknown as Record<string, unknown> };
    } catch (err) {
      clearInterval(heartbeat);
      const errorMsg = err instanceof Error ? err.message : String(err);
      // If the error looks like a Vercel function timeout or network interruption,
      // mark the job as retryable so the next worker invocation can resume it.
      // The Engine's internal stages (load → analyze → match → persist) are
      // idempotent — re-running them on the same tender revision produces the
      // same results. The AI rematch stage uses content-hash deduplication.
      const isTransient = /timeout|timed out|ECONNRESET|fetch failed|network|aborted|socket hang up|FUNCTION_INVOCATION_TIMEOUT/i.test(errorMsg);
      if (isTransient) {
        await recordStep(ctx.jobId, {
          stepName: "engine.transient-error",
          message: `Engine interrupted by transient error (will resume on next worker invocation): ${errorMsg.slice(0, 200)}`,
          status: "RUNNING",
        });
        // Return a retryable result — the job stays RUNNING and the next
        // worker invocation (cron or browser poll) will resume it.
        return {
          code: "ENGINE_TRANSIENT_RETRY",
          message: "Engine interrupted by transient error — will resume on next worker invocation",
          retryable: true,
        };
      }
      await recordStep(ctx.jobId, { stepName: "engine.failed", message: errorMsg, status: "FAILED" });
      throw err;
    }
  },

  // ─── AI_ANALYZE — chunk-based tender analysis with provider fallback ──
  // Async standalone version of /api/tenders/[id]/ai-analyze. Escapes the 60s
  // cap for large tenders by running in the worker's budget. Uses the
  // AnalysisOrchestrator for deterministic content hashing, checkpoint resume,
  // and consistent analysisSource state machine (AI vs PARTIAL_AI).
  AI_ANALYZE: async (ctx) => {
    if (!ctx.tenderId) throw new Error("AI_ANALYZE requires tenderId on the job");
    await recordStep(ctx.jobId, { stepName: "analyze.start", message: "Starting tender analysis", status: "RUNNING" });

    const heartbeat = setInterval(() => {
      void recordStep(ctx.jobId, { stepName: "analyze.heartbeat", message: "Analysis running — waiting for AI response", status: "RUNNING" }).catch(() => {});
    }, 25_000);

    try {
      // BLOCKER 2: Pass existingJobId (ctx.jobId) to executeAnalysis() so it
      // loads THIS job instead of calling createAnalysisJob(). The worker
      // must never create new AI_ANALYZE jobs — only the manual route has
      // that authority. executeAnalysis() verifies the existing job's manual
      // authority (manualRequested/source/actorUserId) from its input.
      const result = await executeAnalysis(ctx.tenderId, ctx.userId, {
        force: ctx.input?.force === true,
        deadlineMs: 55_000,
        existingJobId: ctx.jobId,
        onProgress: async (event) => {
          const msg = event.message || event.status || event.phase;
          void recordStep(ctx.jobId, { stepName: `analyze.${event.phase}`, message: msg, status: "RUNNING" }).catch(() => {});
        },
      });

      const baseOutput: Record<string, unknown> = {
        analysisSource: result.analysisSource,
        requirementCount: result.requirementCount,
        isPartial: result.isPartial,
        success: result.success,
        totalChunks: result.totalChunks,
        completedChunks: result.completedChunks,
        jobId: result.jobId,
      };

      // ── Full AI success: ONLY now may we promote canonical data ──────────
      // executeAnalysis deliberately leaves the job RUNNING (it never marks
      // SUCCEEDED itself, because it has not promoted anything). The finalizer
      // is the single place that writes canonical requirements + canonical
      // tender metadata and then sets SUCCEEDED. We declare success only after
      // it confirms the promotion.
      if (isFullAiSuccess(result)) {
        const finalize = await finalizeAnalysisJob(result.jobId, ctx.userId);
        clearInterval(heartbeat);
        const finalizeCode = "code" in finalize ? (finalize as { code?: string }).code ?? null : null;
        const finalizeRetryable = "retryable" in finalize ? (finalize as { retryable?: boolean }).retryable : undefined;
        const finalizeCorrelationId = "correlationId" in finalize ? (finalize as { correlationId?: string }).correlationId : undefined;
        const terminalStatus = resolveAnalyzeTerminalStatus(result, finalize);
        await recordStep(ctx.jobId, {
          stepName: terminalStatus === "SUCCEEDED" ? "analyze.complete" : "analyze.finalize_blocked",
          message: terminalStatus === "SUCCEEDED"
            ? `Analysis complete — ${result.requirementCount} requirements promoted to canonical`
            : `Analysis NOT promoted (${finalizeCode ?? finalize.status}). Generation/export stay blocked.`,
          status: terminalStatus === "FAILED" ? "FAILED" : "SUCCEEDED",
        });
        return {
          terminalStatus,
          output: {
            ...baseOutput,
            finalizeStatus: finalize.status,
            finalizeCode,
            ...(finalizeRetryable !== undefined ? { retryable: finalizeRetryable } : {}),
            ...(finalizeCorrelationId ? { correlationId: finalizeCorrelationId } : {}),
          },
          ...(finalizeCode ? { code: finalizeCode } : {}),
          ...(finalizeRetryable !== undefined ? { retryable: finalizeRetryable } : {}),
          ...(finalizeCorrelationId ? { correlationId: finalizeCorrelationId } : {}),
        };
      }

      // ── Partial / fallback / provider-exhausted / source-grounding gaps ──
      // Do NOT finalize, do NOT overwrite with SUCCEEDED, do NOT create or
      // unlock GeneratedDocument rows. executeAnalysis already persisted the
      // PARTIAL_SUCCESS/FAILED state; we surface it as the worker's terminal
      // status so run-next never blindly completes it as SUCCEEDED.
      clearInterval(heartbeat);
      const terminalStatus = resolveAnalyzeTerminalStatus(result, null);
      await recordStep(ctx.jobId, {
        stepName: "analyze.partial",
        message: `Analysis ${terminalStatus === "FAILED" ? "failed" : "partial"} — ${result.completedChunks}/${result.totalChunks} chunks; canonical data NOT promoted.`,
        status: terminalStatus === "FAILED" ? "FAILED" : "RUNNING",
      });
      return { terminalStatus, output: { ...baseOutput, errorMessage: result.errorMessage ?? null } };
    } catch (err) {
      clearInterval(heartbeat);
      await recordStep(ctx.jobId, { stepName: "analyze.failed", message: err instanceof Error ? err.message : String(err), status: "FAILED" });
      throw err;
    }
  },

  // ─── PROPOSAL_GENERATION — async proposal generation ─────────────────
  // Calls the SAME canonical document-generation pipeline as the interactive
  // /api/tenders/[id]/generate route (generateTenderDocuments), so the
  // unattended path produces real, byte-verified DOCX documents with active
  // letterhead branding — not throwaway Markdown. Previously this handler
  // called generateProposalSectionsParallel directly and persisted raw
  // Markdown labeled QUICK_DRAFT/NOT_EXPORTABLE: a second, weaker generation
  // authority that could never produce a Final-ZIP-eligible document. That
  // duplication is removed; there is now one canonical implementation.
  // generateTenderDocuments enforces its own evidence-specific ZERO_REVIEWED_*
  // guards (requirement-type aware, stricter than the readiness gate below),
  // so failures surface with the same blocker codes regardless of caller.
  PROPOSAL_GENERATION: async (ctx) => {
    if (!ctx.tenderId) throw new Error("PROPOSAL_GENERATION requires tenderId on the job");

    // Central readiness gate — the background path must not be able to create a
    // GeneratedDocument unless the tender is demonstrably ready. Fail-closed:
    // a blocked gate creates ZERO GeneratedDocument rows.
    const readiness = await assertTenderReadyForGenerationAndExport({
      prisma,
      tenderId: ctx.tenderId,
      userId: ctx.userId,
      purpose: "background-proposal-generation",
    });
    if (!readiness.ok) {
      await recordStep(ctx.jobId, { stepName: "proposal.gate", message: `Blocked by readiness gate: ${readiness.blockerCode} — ${readiness.blockerDetail}`, status: "FAILED" });
      throw new Error(`PROPOSAL_GENERATION blocked by readiness gate (${readiness.blockerCode}): ${readiness.blockerDetail}`);
    }

    // Concurrency guard — mirrors the interactive /generate route's guard.
    // Without this, an unattended retry/re-continuation could race a
    // GENERATING/QUEUED run already in flight for the same tender and create
    // duplicate or corrupted GeneratedDocument rows.
    const alreadyGenerating = await prisma.generatedDocument.count({
      where: { tenderId: ctx.tenderId, generationStatus: { in: ["GENERATING", "QUEUED"] } },
    });
    if (alreadyGenerating > 0) {
      await recordStep(ctx.jobId, { stepName: "proposal.gate", message: "Blocked: another generation run is already in progress for this tender.", status: "FAILED" });
      throw new Error("GENERATION_IN_PROGRESS");
    }

    await recordStep(ctx.jobId, { stepName: "proposal.generate", message: "Generating real DOCX proposal package via the canonical generation pipeline", status: "RUNNING" });
    // Heartbeat every 10s so the progress-stall stuck-job checker (180s
    // threshold, see isProgressStuckOnlyType in lib/ai-jobs.ts) never fires
    // on a legitimately slow but progressing multi-section AI generation —
    // mirrors ENGINE_RUN's heartbeat above.
    const heartbeat = setInterval(() => {
      void recordStep(ctx.jobId, { stepName: "proposal.heartbeat", message: "Generation running — waiting for AI section responses", status: "RUNNING" }).catch(() => {});
    }, 10_000);
    try {
      await generateTenderDocuments(ctx.tenderId, ctx.userId);
    } finally {
      clearInterval(heartbeat);
    }

    await recordStep(ctx.jobId, { stepName: "proposal.letterhead", message: "Applying active Company Vault letterhead branding", status: "RUNNING" });
    const letterheadAppliedCount = await applyActiveUploadedLetterheadToTenderDocuments(ctx.tenderId, ctx.userId);

    await prisma.tender.update({ where: { id: ctx.tenderId }, data: { stage: "GENERATION" } }).catch(() => {});

    const generated = await prisma.generatedDocument.findMany({
      where: { tenderId: ctx.tenderId, generationStatus: { not: "SUPERSEDED" } },
      select: { id: true, documentType: true, format: true },
      orderBy: { exactOrder: "asc" },
    });

    await recordStep(ctx.jobId, {
      stepName: "proposal.complete",
      message: `Generated ${generated.length} document(s) (${generated.map((d) => d.documentType).join(", ") || "none"}); letterhead applied to ${letterheadAppliedCount} file(s)`,
      status: "SUCCEEDED",
    });
    return {
      generatedDocumentIds: generated.map((d) => d.id),
      documentTypes: generated.map((d) => d.documentType),
      letterheadAppliedCount,
    };
  },

  // ─── EVALUATOR_SIM — async 4-persona panel evaluation ────────────────
  // input: { proposalMarkdown?: string } — when omitted, uses the most
  // recent GeneratedDocument for the tender.
  EVALUATOR_SIM: async (ctx) => {
    if (!ctx.tenderId) throw new Error("EVALUATOR_SIM requires tenderId on the job");
    await recordStep(ctx.jobId, { stepName: "evaluator.load", message: "Loading tender + proposal narrative", status: "RUNNING" });

    const tender = await prisma.tender.findFirst({
      where: { id: ctx.tenderId, userId: ctx.userId },
      select: {
        title: true,
        evaluationMethodology: true,
        generatedDocuments: {
          where: { documentType: { in: ["TECHNICAL_PROPOSAL", "QUICK_DRAFT"] }, generationStatus: { not: "SUPERSEDED" } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { fileContent: true, format: true, contentMimeType: true, exactFileName: true, name: true },
        },
      },
    });
    if (!tender) throw new Error(`EVALUATOR_SIM: tender ${ctx.tenderId} not found`);

    const proposalMarkdown = await resolveProposalNarrativeText(
      tender.generatedDocuments[0],
      typeof ctx.input?.proposalMarkdown === "string" ? ctx.input.proposalMarkdown as string : null,
    );
    if (!proposalMarkdown) {
      throw new Error("EVALUATOR_SIM: no proposal narrative found (input.proposalMarkdown empty and no GeneratedDocument exists). Generate a proposal first.");
    }

    await recordStep(ctx.jobId, { stepName: "evaluator.run", message: "Running 4-persona evaluator panel (TECHNICAL, COMPLIANCE, END_USER, COMMERCIAL)", status: "RUNNING" });
    const simulation = await simulateEvaluatorPanel({
      tenderTitle: tender.title,
      proposalMarkdown,
      evaluationCriteria: tender.evaluationMethodology ?? "",
    });

    if (!simulation) {
      await recordStep(ctx.jobId, { stepName: "evaluator.timeout", message: "Evaluator panel returned null (timeout or all personas failed)", status: "FAILED" });
      return { simulation: null, warning: "Simulator returned null — see worker logs." };
    }

    await recordStep(ctx.jobId, { stepName: "evaluator.complete", message: `Panel verdict: ${simulation.verdict}, predicted score: ${simulation.predictedOverallScore}`, status: "SUCCEEDED" });
    return { simulation: simulation as unknown as Record<string, unknown> };
  },

  // ─── COPILOT_DEEP_ANALYSIS — async tender copilot Q&A ────────────────
  // input.question — REQUIRED — the user's question.
  COPILOT_DEEP_ANALYSIS: async (ctx) => {
    if (!ctx.tenderId) throw new Error("COPILOT_DEEP_ANALYSIS requires tenderId on the job");
    const question = typeof ctx.input?.question === "string" ? ctx.input.question.trim() : "";
    if (question.length < 3) throw new Error("COPILOT_DEEP_ANALYSIS requires input.question (min 3 chars)");
    await recordStep(ctx.jobId, { stepName: "copilot.load", message: "Building tender context", status: "RUNNING" });

    const tender = await prisma.tender.findFirst({
      where: { id: ctx.tenderId, userId: ctx.userId },
      include: {
        requirements: true,
        complianceGaps: { where: { isResolved: false } },
        expertMatches: { where: { isSelected: true }, include: { expert: { select: { fullName: true, title: true } } } },
        projectMatches: { where: { isSelected: true }, include: { project: { select: { name: true, clientName: true } } } },
        generatedDocuments: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });
    if (!tender) throw new Error(`COPILOT_DEEP_ANALYSIS: tender ${ctx.tenderId} not found`);

    const context: TenderCopilotContext = {
      tenderTitle: tender.title,
      tenderSummary: tender.analysisSummary ?? "",
      requirements: tender.requirements.map((r) => `${r.title}: ${r.description}`),
      complianceGaps: tender.complianceGaps.map((g) => `[${g.severity}] ${g.description}`),
      selectedExperts: tender.expertMatches.map((m) => `${m.expert.fullName} (${m.expert.title})`),
      selectedProjects: tender.projectMatches.map((m) => `${m.project.name} — ${m.project.clientName ?? "client"}`),
      generatedDocuments: tender.generatedDocuments.map((d) => `${d.documentType}: ${d.name}`),
      controls: [],
      recentAudit: [],
    };

    await recordStep(ctx.jobId, { stepName: "copilot.run", message: `Answering: "${question.slice(0, 80)}${question.length > 80 ? "…" : ""}"`, status: "RUNNING" });
    const response = await answerTenderCopilotQuestion({ question, context });

    await recordStep(ctx.jobId, { stepName: "copilot.complete", message: `Copilot confidence: ${response.confidence}`, status: "SUCCEEDED" });
    return { response: response as unknown as Record<string, unknown> };
  },

  // ─── PROFILE_FACT_EXTRACTION — async pure-regex fact harvest ─────────
  // Reads Company.profileSummary and extracts structured facts
  // (foundingYear, headcount, licenseGrade, GM, TIN, VAT, etc.). Only
  // fills empty Company columns — never overwrites user edits.
  PROFILE_FACT_EXTRACTION: async (ctx) => {
    await recordStep(ctx.jobId, { stepName: "facts.load", message: "Loading company profile summary", status: "RUNNING" });
    const company = await prisma.company.findUnique({ where: { userId: ctx.userId } });
    if (!company) throw new Error("PROFILE_FACT_EXTRACTION: no Company row for this user");
    if (!company.profileSummary || company.profileSummary.length < 20) {
      throw new Error("PROFILE_FACT_EXTRACTION: company.profileSummary is empty or too short — upload an AI-Ready Summary first");
    }

    await recordStep(ctx.jobId, { stepName: "facts.extract", message: "Running pure-regex extractor", status: "RUNNING" });
    const facts = extractCompanyFacts(company.profileSummary);

    // Build update object — only set fields that are currently empty
    // (fill-empty-only — never overwrite user edits).
    type CompanyUpdate = Record<string, string | number | null>;
    const updates: CompanyUpdate = {};
    const currentRow = company as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(facts)) {
      if (value === undefined || value === null) continue;
      const existing = currentRow[key];
      if (existing && String(existing).trim().length > 0) continue;
      if (Array.isArray(value)) {
        // serviceLines / sectors are stored as JSON strings — only set if currently empty
        if (existing && String(existing).length > 2) continue;
        updates[key] = JSON.stringify(value);
      } else {
        updates[key] = value as string | number;
      }
    }

    if (Object.keys(updates).length === 0) {
      await recordStep(ctx.jobId, { stepName: "facts.complete", message: "No empty fields to fill — company already populated", status: "SUCCEEDED" });
      return { fieldsExtracted: Object.keys(facts).length, fieldsUpdated: 0, factsFound: facts as unknown as Record<string, unknown> };
    }

    await prisma.company.update({ where: { id: company.id }, data: updates });
    await recordStep(ctx.jobId, { stepName: "facts.complete", message: `Filled ${Object.keys(updates).length} empty field(s): ${Object.keys(updates).join(", ")}`, status: "SUCCEEDED" });
    return { fieldsExtracted: Object.keys(facts).length, fieldsUpdated: Object.keys(updates).length, factsFound: facts as unknown as Record<string, unknown> };
  },

  // ─── VAULT_INGEST — background Company Vault re-extraction + re-ingestion ─
  // Moves ingestCompanyVault (deterministic regex extraction + an optional
  // full AI extraction pass over every usable company document) out of the
  // upload-request response cycle. Optionally also moves the OCR/text
  // re-extraction loop (reextractAllCompanyDocuments) out of the same cycle
  // when input.reExtractAll is true — this covers every synchronous caller
  // of ingestCompanyVault: a company-document upload (secure-upload-handler),
  // bulk "Re-extract & Re-import All" (reimport route, reExtractAll: true),
  // single-document re-extraction (documents/[id] route), and the standalone
  // knowledge-repair reprocess action.
  //
  // Input: { companyId: string; reExtractAll?: boolean }
  // Output: CompanyVaultIngestionResult, plus docsReextracted/failedFiles
  // when reExtractAll was requested.
  VAULT_INGEST: async (ctx) => {
    const companyId = ctx.input?.companyId as string | undefined;
    if (!companyId) throw new Error("VAULT_INGEST requires companyId in the job input");
    const reExtractAll = ctx.input?.reExtractAll === true;

    const company = await prisma.company.findFirst({ where: { id: companyId, userId: ctx.userId }, select: { id: true } });
    if (!company) throw new Error(`VAULT_INGEST: Company ${companyId} not found or not owned by this user`);

    const retryCount = (ctx.input?.retryCount as number | undefined) ?? 0;
    await recordStep(ctx.jobId, { stepName: "vault.start", message: `Starting Company Vault ${reExtractAll ? "re-extraction + " : ""}ingestion for ${companyId}`, status: "RUNNING" });
    recordSafeStageEvent({
      jobType: "VAULT_INGEST", jobId: ctx.jobId, stage: "vault.start",
      packageRevision: null, sourceRevision: null, durationMs: 0, queueAgeMs: 0,
      retryCount, providerClass: null, modelClass: null, blockerCode: null, artifactIntegrityStatus: null,
    });

    const startedAt = Date.now();
    let reextraction: ReextractAllResult | undefined;
    let supportAudit: Awaited<ReturnType<typeof cleanupSupportDocImportedRecords>> | undefined;
    let result: Awaited<ReturnType<typeof ingestCompanyVault>>;
    try {
      if (reExtractAll) {
        // Mid-batch checkpoint/resume: a prior attempt at THIS job may have
        // been interrupted partway through (e.g. a Vercel function kill)
        // and re-armed by rearmDurableStageJob. Read any already-processed
        // document IDs it persisted to AiJob.output before restarting, so
        // the retry resumes from the next unprocessed document instead of
        // re-running the whole vault's re-extraction from scratch.
        const existingJob = await prisma.aiJob.findUnique({ where: { id: ctx.jobId }, select: { output: true } });
        let checkpoint: string[] = [];
        try {
          const parsed = existingJob?.output ? JSON.parse(existingJob.output) as { vaultIngestCheckpoint?: { processedDocumentIds?: string[] } } : null;
          checkpoint = Array.isArray(parsed?.vaultIngestCheckpoint?.processedDocumentIds) ? parsed!.vaultIngestCheckpoint!.processedDocumentIds! : [];
        } catch {
          checkpoint = [];
        }
        const processed = new Set(checkpoint);
        if (processed.size > 0) {
          await recordStep(ctx.jobId, {
            stepName: "vault.resume",
            message: `Resuming re-extraction — skipping ${processed.size} document(s) already processed by a prior attempt.`,
            status: "RUNNING",
          });
        }

        reextraction = await reextractAllCompanyDocuments(companyId, {
          skipDocumentIds: processed,
          onDocumentDone: async (documentId) => {
            processed.add(documentId);
            await prisma.aiJob.update({
              where: { id: ctx.jobId },
              data: { output: JSON.stringify({ vaultIngestCheckpoint: { processedDocumentIds: [...processed] } }) },
            }).catch(() => {});
          },
        });
        // Documents with no recoverable bytes are called out separately: they
        // are not a transient failure that another run could clear, so the
        // message has to name re-upload as the only remedy rather than let
        // them disappear into a "0 re-extracted" with no stated cause.
        const unrecoverable = reextraction.unrecoverable;
        await recordStep(ctx.jobId, {
          stepName: "vault.reextract",
          message: unrecoverable.length > 0
            ? `Re-extracted ${reextraction.reextracted} document(s); ${reextraction.failedFiles.length} failed, of which ${unrecoverable.length} have no stored bytes left and must be uploaded again: ${unrecoverable.map((doc) => doc.name).join(", ")}.`
            : `Re-extracted ${reextraction.reextracted} document(s); ${reextraction.failedFiles.length} failed.`,
          status: "RUNNING",
        });
      }
      result = await ingestCompanyVault(companyId);
      if (reExtractAll) {
        supportAudit = await cleanupSupportDocImportedRecords(companyId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const decision = classifyStageRetry(message, retryCount);
      recordSafeStageEvent({
        jobType: "VAULT_INGEST", jobId: ctx.jobId, stage: "vault.failed",
        packageRevision: null, sourceRevision: null, durationMs: Date.now() - startedAt, queueAgeMs: 0,
        retryCount, providerClass: null, modelClass: null, blockerCode: decision.blockerCode, artifactIntegrityStatus: null,
      });
      await recordStep(ctx.jobId, { stepName: "vault.failed", message: message.slice(0, 500), status: "FAILED" });
      throw error;
    }

    recordSafeStageEvent({
      jobType: "VAULT_INGEST", jobId: ctx.jobId, stage: "vault.complete",
      packageRevision: null, sourceRevision: null, durationMs: Date.now() - startedAt, queueAgeMs: 0,
      retryCount, providerClass: null, modelClass: null, blockerCode: null, artifactIntegrityStatus: null,
    });
    await recordStep(ctx.jobId, {
      stepName: "vault.complete",
      message: `Ingestion complete: ${result.docsProcessed} document(s) processed, ${result.expertsCreated} expert(s) and ${result.projectsCreated} project(s) created.`,
      status: "SUCCEEDED",
    });

    // ── Event-driven requirement-coverage reconciliation ────────────────
    // Vault uploads and re-extraction are the only source-revision events
    // that previously did NOT trigger requirement-coverage reconciliation
    // for the company's tenders. The Engine run reconciles, and the
    // tender-source invalidation hook (`invalidateTenderForSourceRevision`)
    // reconciles on the next Engine pass — but a tender whose only change
    // is "the company just uploaded a new Expert CV that satisfies one of
    // its mandatory EXPERT requirements" had to wait for the next Engine
    // run, or for a user to open the Requirements and Evidence panel and
    // click "Request recovery". That violates the "durable, revision-
    // bound, event-driven — not dependent on opening the panel" contract.
    //
    // Reconciliation is bounded: one call per tender, only for tenders in
    // an active (non-final) state, and the same revision-bound transaction
    // the Engine uses. Failures are logged but never block the VAULT_INGEST
    // job — the existing fail-closed authority (canUseVaultRecord,
    // release gates, export readiness) is unchanged.
    try {
      const activeTenders = await prisma.tender.findMany({
        where: {
          userId: ctx.userId,
          // Skip tenders in a final state — their requirement coverage is
          // already locked in the export package and re-reconciliation is
          // not meaningful.
          status: { notIn: ["ARCHIVED", "WITHDRAWN", "NO_BID"] },
        },
        select: { id: true },
      });
      let reconciledCount = 0;
      let reconcileFailures = 0;
      for (const tender of activeTenders) {
        try {
          const coverage = await reconcileAutomaticRequirementCoverage(
            prisma,
            tender.id,
            ctx.userId,
          );
          if (coverage.ok) {
            reconciledCount += 1;
          }
        } catch (error) {
          reconcileFailures += 1;
          logger.warn("[job-handler] VAULT_INGEST per-tender coverage reconciliation failed", {
            jobId: ctx.jobId,
            tenderId: tender.id,
            errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
          });
        }
      }
      await recordStep(ctx.jobId, {
        stepName: "vault.coverage-reconciled",
        message: `Event-driven requirement coverage reconciled for ${reconciledCount} tender(s); ${reconcileFailures} failure(s).`,
        status: "SUCCEEDED",
      });
    } catch (error) {
      logger.warn("[job-handler] VAULT_INGEST coverage reconciliation sweep failed", {
        jobId: ctx.jobId,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    }

    // Admin-triggered reprocess/reimport actions get a human-readable audit
    // entry with the real outcome (only known now that the job has actually
    // run). Routine per-upload ingestion does not pass auditAction and stays
    // silent here, matching its prior behavior (the upload itself is already
    // logged as COMPANY_DOCUMENT_UPLOAD by the caller).
    const auditAction = ctx.input?.auditAction as string | undefined;
    if (auditAction === "COMPANY_KNOWLEDGE_REPAIR" || auditAction === "COMPANY_KNOWLEDGE_REPROCESS") {
      const sourceVerification = result.sourceVerification;
      await logAction({
        userId: ctx.userId,
        action: auditAction,
        entityType: "Company",
        entityId: companyId,
        description: reExtractAll
          ? `Company Vault reimport completed: ${result.expertsCreated} experts and ${result.projectsCreated} projects created; ${sourceVerification.expertsVerified} experts and ${sourceVerification.projectsVerified} projects machine source-verified; uncertain mixed-document records were preserved for review.`
          : "Company Vault sources were reprocessed through the canonical ingestion and source-verification path.",
        metadata: {
          docsReextracted: reextraction?.reextracted ?? 0,
          docsFailed: reextraction?.failedFiles.length ?? 0,
          docsUnrecoverable: reextraction?.unrecoverable.length ?? 0,
          expertsCreated: result.expertsCreated,
          projectsCreated: result.projectsCreated,
          expertsUpdated: result.expertsUpdated,
          projectsUpdated: result.projectsUpdated,
          aiUsed: result.aiUsed,
          sourceVerification,
          supportAudit,
        },
      }).catch((error) => {
        logger.warn("[job-handler] VAULT_INGEST audit persistence failed", {
          errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
        });
      });
    }

    return {
      ...result,
      ...(reextraction
        ? {
            docsReextracted: reextraction.reextracted,
            reextractionFailedFiles: reextraction.failedFiles,
            reextractionUnrecoverableFiles: reextraction.unrecoverable,
          }
        : {}),
      ...(supportAudit ? { supportAudit } : {}),
    } as unknown as Record<string, unknown>;
  },

  // ─── AUTO_FINALIZE — durable auto-finalize continuation ───────────────
  // Replaces the request-bound inline call that previously ran inside
  // run-next after PROPOSAL_GENERATION succeeded. Moving to a durable job
  // means: (1) the 60s Vercel Hobby limit no longer risks cutting off the
  // safe-repair + canonical-validation sweep on large tenders; (2) a
  // transient failure is automatically retried by the durable-stage
  // retry policy (rearmDurableStageJob) instead of falling back to
  // "manual retry"; (3) the job is idempotent — re-running on the same
  // tender is safe because repaired documents carry a machine: marker.
  AUTO_FINALIZE: async (ctx) => {
    const tenderId = ctx.input?.tenderId as string | undefined;
    if (!tenderId) throw new Error("AUTO_FINALIZE requires tenderId in the job input");

    await recordStep(ctx.jobId, { stepName: "auto-finalize.start", message: `Starting durable auto-finalize for tender ${tenderId}`, status: "RUNNING" });

    const { runAutoFinalizeAfterGeneration } = await import("./ai-jobs/auto-finalize-continuation-service");
    const result = await runAutoFinalizeAfterGeneration(tenderId, ctx.userId, ctx.jobId);

    const summary = `forms reused ${result.formReuse.reused}/${result.formReuse.reused + result.formReuse.stillMissing}, source repair ${result.sourceRepair.repaired}/${result.sourceRepair.checked}, export repair ${result.exportRepair.repaired} repaired, validation ${result.validation.validated}/${result.validation.failed}/${result.validation.pending}, PDF ${result.pdfFinalization.finalized}/${result.pdfFinalization.skipped}/${result.pdfFinalization.failed}, PDF validation ${result.pdfValidation.validated}/${result.pdfValidation.failed}/${result.pdfValidation.pending}, package ${result.packageReconciliation.requiredTotal - result.packageReconciliation.missing}/${result.packageReconciliation.requiredTotal}${result.warning ? `, warning: ${result.warning}` : ""}`;

    // A run that left blockers behind must not be recorded SUCCEEDED. It used
    // to be, unconditionally, so a tender with unresolved source grounding,
    // unvalidated documents, or an unfinalizable required PDF looked finished
    // while the export gate still refused it.
    //
    // The blocker text is written to be classified NON_RETRYABLE by
    // lib/engine/stage-retry-policy.ts: these states do not change on their
    // own, so re-running burns the retry budget instead of fixing anything.
    // Failing terminally persists the precise reason on AiJob.errorMessage,
    // which is what the tender UI reads. Transient stage failures still throw
    // from inside the service above and keep their durable retry.
    if (!result.ok) {
      await recordStep(ctx.jobId, {
        stepName: "auto-finalize.complete",
        message: `Auto-finalize did not converge (${summary})`,
        status: "FAILED",
      });
      throw new Error(`AUTO_FINALIZE_NOT_CONVERGED — ${result.blockers.join("; ")}`);
    }

    await recordStep(ctx.jobId, {
      stepName: "auto-finalize.complete",
      message: `Auto-finalize complete: ${summary}`,
      status: "SUCCEEDED",
    });

    return result as unknown as Record<string, unknown>;
  },
};

export function getHandler(jobType: JobType): JobHandler | null {
  return handlers[jobType] ?? null;
}

/**
 * List the job types this build can execute. Anything not in this list
 * will be marked FAILED by the worker with a "no handler registered"
 * error so the queue doesn't hang on orphan job types.
 */
export function supportedJobTypes(): JobType[] {
  return Object.keys(handlers) as JobType[];
}
