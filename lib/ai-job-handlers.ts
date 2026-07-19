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
//   AI_REMATCH              — escape 60s cap on standalone rematch (many candidates × 12 perspectives)
//   PROPOSAL_GENERATION     — escape 60s cap on full-proposal generation
//   EVALUATOR_SIM           — async 4-persona evaluator panel simulation
//   COPILOT_DEEP_ANALYSIS   — async tender copilot Q&A (frees the request for follow-up actions)
//   PROFILE_FACT_EXTRACTION — async pure-regex fact harvest from company/project/tender prose

import { recordStep, type JobType } from "./ai-jobs";
import { verifiedIntegrityDataFromBase64 } from "./engine/persisted-byte-integrity";
import { withTransactionalGenerationGate } from "./engine/transactional-generation-gate";
import { isStrictBase64 } from "./engine/generated-file-integrity";
import { checkEnginePostconditions } from "./engine/engine-postconditions";
import { runTenderEngine } from "./engine/run-tender-engine";
import { executeAnalysis, finalizeAnalysisJob } from "./engine/analysis-orchestrator";
import { prisma } from "./prisma";
import {
  aiRematchExperts,
  aiRematchProjects,
  formatAssessmentRationale,
  type ExpertCandidateInput,
  type ProjectCandidateInput,
} from "./engine/ai-multi-perspective-matcher";
import { simulateEvaluatorPanel } from "./engine/evaluator-simulator";
import { answerTenderCopilotQuestion, type TenderCopilotContext } from "./engine/tender-ai-copilot";
import { extractCompanyFacts } from "./engine/company-fact-extractor";
import { generateProposalSectionsParallel, type AIBidWriterInput } from "./ai";
import { assertTenderReadyForGenerationAndExport } from "./engine/generation-readiness-gate";
import { getStorageAdapter } from "./storage";
import { extractTextFromBuffer } from "./extract-text";
import { assessExtractionQuality, assessExtractionQualityPerPage } from "./extraction-quality";
import { autoFillTenderMetadata } from "./engine/auto-fill-tender-metadata";
import { enrichMetadataWithSourceEvidence } from "./engine/metadata-source-enrichment";
import { buildCandidatesFromMetadata } from "./engine/candidate-pipeline";

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
    // Heartbeat every 25 s so the stuck-job checker (90 s threshold) never
    // fires on a legitimately slow but progressing AI call (e.g. analyzeWithAI
    // on a large tender). If Vercel kills the function at 60 s, the last
    // heartbeat is at most 25 s old → recovery fires at ~115 s, not 90 s.
    const heartbeat = setInterval(() => {
      void recordStep(ctx.jobId, { stepName: "engine.heartbeat", message: "Engine running — waiting for AI response", status: "RUNNING" }).catch(() => {});
    }, 25_000);
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
      await recordStep(ctx.jobId, { stepName: "engine.failed", message: err instanceof Error ? err.message : String(err), status: "FAILED" });
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
      const result = await executeAnalysis(ctx.tenderId, ctx.userId, {
        force: ctx.input?.force === true,
        deadlineMs: 55_000,
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

  // ─── AI_REMATCH — 12-perspective rematch of pre-filtered candidates ──
  // Async standalone version of /api/tenders/[id]/ai-rematch. The route
  // is the interactive path; this handler is for queued/background runs.
  // input.applySelections — when true, persists the union of AI + manual
  // selections back to TenderExpertMatch/TenderProjectMatch.
  AI_REMATCH: async (ctx) => {
    if (!ctx.tenderId) throw new Error("AI_REMATCH requires tenderId on the job");
    const applySelections = ctx.input?.applySelections === true;
    await recordStep(ctx.jobId, { stepName: "rematch.start", message: `Loading tender + matches`, status: "RUNNING" });

    const tender = await prisma.tender.findFirst({
      where: { id: ctx.tenderId, userId: ctx.userId },
      include: {
        requirements: { select: { id: true, title: true, description: true, requirementType: true, priority: true, requiredQuantity: true, exactFileName: true, exactOrder: true, restrictions: true } },
        expertMatches: { orderBy: { score: "desc" }, take: 20, include: { expert: { select: { id: true, fullName: true, title: true, yearsExperience: true, disciplines: true, sectors: true, certifications: true, profile: true, trustLevel: true } } } },
        projectMatches: { orderBy: { score: "desc" }, take: 20, include: { project: { select: { id: true, name: true, clientName: true, country: true, sector: true, serviceAreas: true, summary: true, contractValue: true, currency: true, startDate: true, endDate: true, trustLevel: true } } } },
      },
    });
    if (!tender) throw new Error(`AI_REMATCH: tender ${ctx.tenderId} not found or not owned by user`);

    const expertCandidates: ExpertCandidateInput[] = tender.expertMatches.map((m) => ({
      id: m.expert.id, fullName: m.expert.fullName, title: m.expert.title, yearsExperience: m.expert.yearsExperience,
      disciplines: safeJsonArray(m.expert.disciplines), sectors: safeJsonArray(m.expert.sectors),
      certifications: safeJsonArray(m.expert.certifications), profile: m.expert.profile, trustLevel: m.expert.trustLevel,
    }));
    const projectCandidates: ProjectCandidateInput[] = tender.projectMatches.map((m) => ({
      id: m.project.id, name: m.project.name, clientName: m.project.clientName, country: m.project.country, sector: m.project.sector,
      serviceAreas: safeJsonArray(m.project.serviceAreas), summary: m.project.summary, contractValue: m.project.contractValue,
      currency: m.project.currency, startDate: m.project.startDate, endDate: m.project.endDate, trustLevel: m.project.trustLevel,
    }));

    const requirementsText = tender.requirements
      .map((r) => `[${r.priority}] ${r.requirementType}: ${r.title}: ${r.description}`)
      .join("\n");

    await recordStep(ctx.jobId, { stepName: "rematch.ai", message: `Scoring ${expertCandidates.length} expert(s) and ${projectCandidates.length} project(s) across 12 perspectives`, status: "RUNNING" });
    const [expertBatch, projectBatch] = await Promise.all([
      expertCandidates.length > 0
        ? aiRematchExperts({ tenderTitle: tender.title, tenderRequirementsText: requirementsText, evaluationMethodology: tender.evaluationMethodology ?? "", candidates: expertCandidates })
        : Promise.resolve(null),
      projectCandidates.length > 0
        ? aiRematchProjects({ tenderTitle: tender.title, tenderRequirementsText: requirementsText, tenderCategory: tender.category, candidates: projectCandidates })
        : Promise.resolve(null),
    ]);

    let expertsUpdated = 0;
    let projectsUpdated = 0;
    if (expertBatch) {
      for (const assessment of expertBatch.assessments) {
        const match = tender.expertMatches.find((m) => m.expert.id === assessment.candidateId);
        if (!match) continue;
        await prisma.tenderExpertMatch.update({
          where: { id: match.id },
          data: {
            score: assessment.overallScore,
            rationale: formatAssessmentRationale(assessment),
            ...(applySelections ? { isSelected: assessment.recommendSelection || match.isSelected } : {}),
          },
        });
        expertsUpdated += 1;
      }
    }
    if (projectBatch) {
      for (const assessment of projectBatch.assessments) {
        const match = tender.projectMatches.find((m) => m.project.id === assessment.candidateId);
        if (!match) continue;
        await prisma.tenderProjectMatch.update({
          where: { id: match.id },
          data: {
            score: assessment.overallScore,
            rationale: formatAssessmentRationale(assessment),
            ...(applySelections ? { isSelected: assessment.recommendSelection || match.isSelected } : {}),
          },
        });
        projectsUpdated += 1;
      }
    }

    await recordStep(ctx.jobId, { stepName: "rematch.complete", message: `Updated ${expertsUpdated} expert(s) and ${projectsUpdated} project(s)`, status: "SUCCEEDED" });
    return { expertsUpdated, projectsUpdated, applySelections, aiUsed: Boolean(expertBatch || projectBatch) };
  },

  // ─── PROPOSAL_GENERATION — async proposal generation ─────────────────
  // Wraps generateProposalSectionsParallel. The interactive path is
  // /api/tenders/[id]/ai-proposal (which 3-chunks for in-browser
  // generation); this handler runs the full pipeline server-side in
  // the worker's 60s budget so the user can close the tab.
  // input.sectionFilter — optional ProposalSectionId[] to limit scope.
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

    await recordStep(ctx.jobId, { stepName: "proposal.load", message: "Loading tender + company context", status: "RUNNING" });

    const [tender, company] = await Promise.all([
      prisma.tender.findFirst({
        where: { id: ctx.tenderId, userId: ctx.userId },
        include: {
          requirements: true,
          expertMatches: { where: { isSelected: true, expert: { is: { trustLevel: "REVIEWED", deletedAt: null } } }, include: { expert: true } },
          projectMatches: { where: { isSelected: true, project: { is: { trustLevel: "REVIEWED", deletedAt: null } } }, include: { project: true } },
          complianceMatrix: { include: { requirement: { select: { title: true, description: true } } } },
        },
      }),
      prisma.company.findUnique({ where: { userId: ctx.userId } }),
    ]);
    if (!tender) throw new Error(`PROPOSAL_GENERATION: tender ${ctx.tenderId} not found`);
    if (!company) throw new Error("PROPOSAL_GENERATION: Company Vault not found");

    const input: AIBidWriterInput = {
      tenderTitle: tender.title,
      clientName: tender.clientName ?? "the procuring entity",
      tenderText: tender.requirements.map((r) => `${r.title}: ${r.description}`).join("\n\n").slice(0, 24_000),
      analysisSummary: tender.analysisSummary ?? "",
      evaluationMethodology: tender.evaluationMethodology ?? "",
      submissionNotes: tender.submissionMethod ?? "",
      requirements: tender.requirements.map((r) => `${r.title}: ${r.description}`).join("\n"),
      companyProfile: company?.profileSummary ?? "",
      experts: tender.expertMatches.map((m) => `${m.expert.fullName} (${m.expert.title}) — ${m.expert.yearsExperience} yrs`).join("\n"),
      projects: tender.projectMatches.map((m) => `${m.project.name} — ${m.project.clientName ?? "client"} — ${m.project.sector ?? ""}`).join("\n"),
      compliance: tender.complianceMatrix.map((c) => `${c.requirement?.title ?? "Requirement"}: ${c.supportLevel} (${c.evidenceType})`).join("\n"),
      differentiators: "",
    };

    const rawFilter = ctx.input?.sectionFilter;
    const sectionFilter = Array.isArray(rawFilter) && rawFilter.length > 0
      ? (rawFilter as string[]).filter((s): s is "cover-and-summary" | "company-and-experience" | "technical-approach" | "additional-and-declaration" =>
          ["cover-and-summary", "company-and-experience", "technical-approach", "additional-and-declaration"].includes(s))
      : undefined;

    const needsReviewedExperts = !sectionFilter || sectionFilter.includes("technical-approach");
    const needsReviewedProjects = !sectionFilter || sectionFilter.includes("company-and-experience");
    if (needsReviewedExperts && tender.expertMatches.length === 0) {
      await recordStep(ctx.jobId, {
        stepName: "proposal.evidence",
        message: "Blocked: no REVIEWED selected expert evidence is available.",
        status: "FAILED",
      });
      throw new Error("NO_REVIEWED_EXPERT_EVIDENCE");
    }
    if (needsReviewedProjects && tender.projectMatches.length === 0) {
      await recordStep(ctx.jobId, {
        stepName: "proposal.evidence",
        message: "Blocked: no REVIEWED selected project evidence is available.",
        status: "FAILED",
      });
      throw new Error("NO_REVIEWED_PROJECT_EVIDENCE");
    }

    await recordStep(ctx.jobId, { stepName: "proposal.generate", message: `Generating proposal sections${sectionFilter ? ` (filtered: ${sectionFilter.join(", ")})` : " (full)"}`, status: "RUNNING" });
    const sectionResult = await generateProposalSectionsParallel(input, sectionFilter);
    const markdown = sectionResult.markdown;
    // Fail closed on ANY deterministic fallback. Mixed AI/fallback output is
    // not an authoritative proposal and must be rejected before readiness
    // recheck, byte encoding, transaction entry, database insert, or storage.
    if (sectionResult.anyFallback) {
      const fallbackSectionIds = sectionResult.sections
        .filter((section) => section.source === "fallback")
        .map((section) => section.id);
      await recordStep(ctx.jobId, {
        stepName: "proposal.fallback",
        message: `Blocked non-authoritative proposal output: deterministic fallback used by ${fallbackSectionIds.length} section(s) (${fallbackSectionIds.join(", ") || "unknown"}). Zero documents and zero bytes persisted.`,
        status: "FAILED",
      });
      throw new Error(sectionResult.allFallback
        ? "AI_PROPOSAL_ALL_SECTIONS_FALLBACK"
        : "AI_PROPOSAL_MIXED_FALLBACK_BLOCKED");
    }
    if (!markdown || markdown.trim().length < 50) {
    await recordStep(ctx.jobId, {
      stepName: "proposal.output",
      message: "AI proposal output was empty or insufficient; no document was persisted.",
      status: "FAILED",
    });
    throw new Error("AI_PROPOSAL_OUTPUT_INSUFFICIENT");
  }

  const postGenerationReadiness = await assertTenderReadyForGenerationAndExport({
    prisma,
    tenderId: ctx.tenderId,
    userId: ctx.userId,
    purpose: "background-proposal-generation",
  });
  if (!postGenerationReadiness.ok) {
    await recordStep(ctx.jobId, {
      stepName: "proposal.post-gate",
      message: `Readiness changed while AI generation was running: ${postGenerationReadiness.blockerCode}`,
      status: "FAILED",
    });
    throw new Error(`PROPOSAL_GENERATION readiness changed (${postGenerationReadiness.blockerCode})`);
  }
    const backgroundFileName = `Technical-Proposal-Background-${ctx.jobId}.md`;
    const backgroundFileContent = Buffer.from(markdown, "utf8").toString("base64");
    const backgroundIntegrity = verifiedIntegrityDataFromBase64({
      fileContent: backgroundFileContent,
      filename: backgroundFileName,
      claimedMimeType: "text/markdown",
    });

    // Persist into GeneratedDocument so the user can fetch it later via
    // the existing tender detail page (which already lists generated docs).
    const doc = await prisma.$transaction(async (tx) =>
      withTransactionalGenerationGate({
        prisma,
        tx,
        tenderId: ctx.tenderId!,
        userId: ctx.userId,
        purpose: "background-proposal-generation",
        write: async (lockedTx) => {
          const doc = await lockedTx.generatedDocument.create({
      data: {
        tenderId: ctx.tenderId!,
        name: `Technical Proposal (background) ${new Date().toISOString().slice(0, 19).replace("T", " ")}`,
        documentType: "QUICK_DRAFT",
        format: "MARKDOWN",
        exactFileName: backgroundFileName,
        fileContent: backgroundFileContent,
        ...backgroundIntegrity,
        generationStatus: "GENERATED",
        validationStatus: "PENDING",
        reviewStatus: "NOT_EXPORTABLE",
      },
    })
          return doc;
        },
      }),
    );;

    await recordStep(ctx.jobId, { stepName: "proposal.complete", message: `Saved ${markdown.length} chars to GeneratedDocument ${doc.id}`, status: "SUCCEEDED" });
    return { generatedDocumentId: doc.id, markdownChars: markdown.length, sectionsGenerated: sectionFilter ?? "all" };
  },

  // ─── EVALUATOR_SIM — async 4-persona panel evaluation ────────────────
  // input: { proposalMarkdown?: string } — when omitted, uses the most
  // recent GeneratedDocument for the tender.
  EVALUATOR_SIM: async (ctx) => {
    if (!ctx.tenderId) throw new Error("EVALUATOR_SIM requires tenderId on the job");
    await recordStep(ctx.jobId, { stepName: "evaluator.load", message: "Loading tender + proposal markdown", status: "RUNNING" });

    const tender = await prisma.tender.findFirst({
      where: { id: ctx.tenderId, userId: ctx.userId },
      include: { generatedDocuments: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!tender) throw new Error(`EVALUATOR_SIM: tender ${ctx.tenderId} not found`);

    const storedProposal = tender.generatedDocuments[0]?.fileContent ?? "";
    const proposalMarkdown = typeof ctx.input?.proposalMarkdown === "string"
      ? (ctx.input.proposalMarkdown as string)
      : storedProposal && isStrictBase64(storedProposal)
        ? Buffer.from(storedProposal, "base64").toString("utf8")
        : storedProposal;
    if (!proposalMarkdown) {
      throw new Error("EVALUATOR_SIM: no proposal markdown found (input.proposalMarkdown empty and no GeneratedDocument exists). Generate a proposal first.");
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

  // ─── EXTRACT_TEXT — background text extraction for a TenderFile ──────
  // Moves long-running extraction (especially OCR on scanned PDFs) out of
  // the upload-request response cycle. The upload route enqueues this job
  // and returns immediately; the worker reads the file from storage, runs
  // extractTextFromBuffer, updates the TenderFile row, and runs the
  // candidate pipeline + metadata enrichment so the canonical resolver can
  // ground the metadata.
  //
  // Input: { tenderFileId: string }
  // Output: { fileId, fileName, textLength, extractionScore, totalPages, ocrOutcome }
  EXTRACT_TEXT: async (ctx) => {
    const tenderFileId = ctx.input?.tenderFileId as string | undefined;
    if (!tenderFileId) throw new Error("EXTRACT_TEXT requires tenderFileId in the job input");

    await recordStep(ctx.jobId, { stepName: "extract.load", message: `Loading TenderFile ${tenderFileId}`, status: "RUNNING" });

    const file = await prisma.tenderFile.findUnique({
      where: { id: tenderFileId },
      select: {
        id: true,
        tenderId: true,
        originalFileName: true,
        mimeType: true,
        storagePath: true,
        fileContent: true,
        size: true,
        deletionStatus: true,
      },
    });
    if (!file) throw new Error(`EXTRACT_TEXT: TenderFile ${tenderFileId} not found`);
    if (file.deletionStatus !== "ACTIVE") {
      throw new Error(`EXTRACT_TEXT: TenderFile ${tenderFileId} is not ACTIVE (status: ${file.deletionStatus})`);
    }

    await recordStep(ctx.jobId, { stepName: "extract.storage-read", message: `Reading file from storage: ${file.originalFileName}`, status: "RUNNING" });

    let buffer: Buffer;
    try {
      buffer = await getStorageAdapter().getFile({
        storagePath: file.storagePath || undefined,
        fileContent: file.fileContent,
        fileName: file.originalFileName,
      });
    } catch (retrieveErr) {
      const msg = retrieveErr instanceof Error ? retrieveErr.message : String(retrieveErr);
      await recordStep(ctx.jobId, { stepName: "extract.storage-failed", message: `Storage retrieval failed: ${msg.slice(0, 200)}`, status: "FAILED" });
      throw new Error(`EXTRACT_TEXT: storage retrieval failed for ${tenderFileId}: ${msg}`);
    }

    await recordStep(ctx.jobId, { stepName: "extract.run", message: `Running extractTextFromBuffer (${buffer.length} bytes)`, status: "RUNNING" });
    const extractedText = await extractTextFromBuffer(buffer, file.mimeType, file.originalFileName);

    // Assess quality
    const quality = assessExtractionQuality(extractedText, file.originalFileName);
    const perPage = assessExtractionQualityPerPage(extractedText);

    // Determine OCR outcome (mirrors repair-extraction route)
    let ocrOutcome: string = "OCR_NOT_ATTEMPTED";
    if (extractedText.startsWith("[PDF text extracted via Claude vision OCR")) {
      ocrOutcome = "OCR_ATTEMPTED_SUCCEEDED";
    } else if (extractedText.startsWith("[OCR_TIMEOUT")) {
      ocrOutcome = "OCR_TIMEOUT";
    } else if (extractedText.startsWith("[OCR_AUTH_FAILED")) {
      ocrOutcome = "OCR_AUTH_FAILED";
    } else if (extractedText.startsWith("[OCR_RATE_LIMITED")) {
      ocrOutcome = "OCR_RATE_LIMITED";
    } else if (extractedText.startsWith("[Scanned PDF")) {
      ocrOutcome = "OCR_ATTEMPTED_FAILED";
    } else if (extractedText.startsWith("[Extraction failed")) {
      ocrOutcome = "OCR_OUTPUT_INSUFFICIENT";
    }

    await recordStep(ctx.jobId, {
      stepName: "extract.persist",
      message: `Persisting: score=${quality.score}, pages=${perPage.totalDetectedPages}, ocrOutcome=${ocrOutcome}`,
      status: "RUNNING",
    });

    // Atomic update — all extraction fields in one transaction
    await prisma.tenderFile.update({
      where: { id: tenderFileId },
      data: {
        extractedText: extractedText || null,
        totalPages: perPage.totalDetectedPages > 0 ? perPage.totalDetectedPages : null,
        extractedPages: perPage.totalDetectedPages > 0 ? perPage.totalDetectedPages : null,
        ocrPages: extractedText.startsWith("[PDF text extracted via Claude vision OCR") ? perPage.totalDetectedPages : null,
        failedPages: 0,
        extractionScore: quality.score,
        extractionMethod: extractedText.startsWith("[PDF text extracted via Claude vision OCR") ? "ocr" : "text",
        pageStatusJson: JSON.stringify(perPage.pages ?? []),
      },
    });

    // Run metadata inference + enrichment + candidate pipeline so the
    // canonical resolver can ground the metadata immediately (no need to
    // wait for AI Analyze). This mirrors the upload-first flow.
    try {
      const tender = await prisma.tender.findUnique({
        where: { id: file.tenderId },
        select: {
          id: true,
          title: true,
          reference: true,
          clientName: true,
          category: true,
          country: true,
          deadline: true,
          submissionMethod: true,
          submissionAddress: true,
          submissionEmails: true,
          submissionEmailSubject: true,
          clientContactName: true,
          clientContactTitle: true,
          clientContactEmail: true,
          clientContactPhone: true,
          preBidMeetingDate: true,
          preBidMeetingLocation: true,
          validityDays: true,
          pageLimit: true,
          bidBondAmount: true,
          bidBondCurrency: true,
          numberOfCopiesRequired: true,
          mandatorySiteVisit: true,
          evaluationMethodology: true,
          contactDetailsSourceJson: true,
          files: {
            where: { deletionStatus: "ACTIVE" },
            select: {
              id: true,
              originalFileName: true,
              extractedText: true,
              totalPages: true,
              contentHash: true,
              deletionStatus: true,
            },
          },
        },
      });
      if (tender) {
        // Use every active tender file so fill-empty inference and grounding
        // operate on the same complete source set as engine preflight. Replace
        // the just-extracted row with the in-memory text to avoid a stale read.
        const enrichmentFiles = tender.files.map((activeFile) => activeFile.id === file.id
          ? {
              ...activeFile,
              fileName: activeFile.originalFileName,
              extractedText,
              totalPages: perPage.totalDetectedPages > 0 ? perPage.totalDetectedPages : null,
            }
          : {
              ...activeFile,
              fileName: activeFile.originalFileName,
            });

        // Fill empty metadata through the same authority used by engine preflight.
        // The previous code computed an inferred draft and discarded it, so a
        // successful background extraction never populated newly discovered facts.
        const autoFill = await autoFillTenderMetadata({
          ...tender,
          files: enrichmentFiles,
        }, prisma);

        // Re-read after auto-fill so evidence and candidate classification use
        // the effective stored values rather than the stale pre-extraction row.
        const effectiveTender = await prisma.tender.findUnique({
          where: { id: tender.id },
          select: {
            id: true,
            title: true,
            reference: true,
            clientName: true,
            deadline: true,
            submissionMethod: true,
            submissionAddress: true,
            submissionEmails: true,
            submissionEmailSubject: true,
            contactDetailsSourceJson: true,
          },
        });
        if (!effectiveTender) throw new Error("Tender disappeared during extraction enrichment");

        // Enrich source evidence (locates each critical field value in the
        // extracted text and produces source-evidence columns).
        const enrichment = enrichMetadataWithSourceEvidence({
          title: effectiveTender.title,
          reference: effectiveTender.reference,
          clientName: effectiveTender.clientName,
          deadline: effectiveTender.deadline,
          submissionMethod: effectiveTender.submissionMethod,
          submissionAddress: effectiveTender.submissionAddress,
          submissionEmails: effectiveTender.submissionEmails,
          submissionEmailSubject: effectiveTender.submissionEmailSubject,
          existingContactDetailsSourceJson: effectiveTender.contactDetailsSourceJson ?? null,
        }, enrichmentFiles);

        // Build candidate pipeline (Gap 3 integration).
        const candidatePipeline = buildCandidatesFromMetadata({
          values: {
            title: effectiveTender.title,
            reference: effectiveTender.reference,
            clientName: effectiveTender.clientName,
            deadline: effectiveTender.deadline,
            submissionMethod: effectiveTender.submissionMethod,
            submissionAddress: effectiveTender.submissionAddress,
            submissionEmailSubject: effectiveTender.submissionEmailSubject,
          },
          files: enrichmentFiles,
          candidateType: "regex",
          extractionSourcePrefix: "extract-text-job",
        });

        // Apply the enrichment + any candidate-promoted evidence columns.
        // We do NOT apply candidate scalarPatch here because that could
        // overwrite user edits made between upload and job execution.
        // Only the evidence columns are safe to write.
        const patch: Record<string, unknown> = { ...enrichment };
        if (Object.keys(patch).length > 0) {
          await prisma.tender.update({ where: { id: tender.id }, data: patch });
        }

        await recordStep(ctx.jobId, {
          stepName: "extract.enriched",
          message: `Tender detail enrichment applied (${Object.keys(patch).length} evidence cols; ${autoFill.filled.length} metadata fields filled). Candidates: ${candidatePipeline.summary.autoConfirmed}AC + ${candidatePipeline.summary.grounded}G + ${candidatePipeline.summary.rejected}R + ${candidatePipeline.summary.needsReview}NR`,
          status: "RUNNING",
        });
      }
    } catch (enrichErr) {
      // Best-effort, non-fatal. The extraction itself succeeded; only the
      // metadata enrichment failed. The user can run AI Analyze or
      // repair-metadata to recover.
      const msg = enrichErr instanceof Error ? enrichErr.message : String(enrichErr);
      await recordStep(ctx.jobId, { stepName: "extract.enrich-failed", message: `Tender detail enrichment failed (non-fatal): ${msg.slice(0, 200)}`, status: "RUNNING" });
    }

    await recordStep(ctx.jobId, {
      stepName: "extract.complete",
      message: `Extraction complete. Score: ${quality.score}, Pages: ${perPage.totalDetectedPages}, OCR: ${ocrOutcome}, TextLength: ${extractedText.length}`,
      status: "SUCCEEDED",
    });

    return {
      fileId: tenderFileId,
      fileName: file.originalFileName,
      textLength: extractedText.length,
      extractionScore: quality.score,
      totalPages: perPage.totalDetectedPages,
      ocrOutcome,
    };
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
