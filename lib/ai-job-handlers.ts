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
import { checkEnginePostconditions } from "./engine/engine-postconditions";
import { runTenderEngine } from "./engine/run-tender-engine";
import { executeAnalysis } from "./engine/analysis-orchestrator";
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

export interface JobContext {
  jobId: string;
  userId: string;
  tenderId: string | null;
  input: Record<string, unknown>;
}

export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown>>;

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

      clearInterval(heartbeat);
      await recordStep(ctx.jobId, { stepName: "analyze.complete", message: `Analysis complete — ${result.requirementCount} requirements extracted`, status: "SUCCEEDED" });
      return {
        analysisSource: result.analysisSource,
        requirementCount: result.requirementCount,
        isPartial: result.isPartial,
        success: result.success,
        totalChunks: result.totalChunks,
        completedChunks: result.completedChunks,
      };
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
          expertMatches: { where: { isSelected: true }, include: { expert: true } },
          projectMatches: { where: { isSelected: true }, include: { project: true } },
          complianceMatrix: { include: { requirement: { select: { title: true, description: true } } } },
        },
      }),
      prisma.company.findUnique({ where: { userId: ctx.userId } }),
    ]);
    if (!tender) throw new Error(`PROPOSAL_GENERATION: tender ${ctx.tenderId} not found`);

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

    await recordStep(ctx.jobId, { stepName: "proposal.generate", message: `Generating proposal sections${sectionFilter ? ` (filtered: ${sectionFilter.join(", ")})` : " (full)"}`, status: "RUNNING" });
    const markdown = await generateProposalSectionsParallel(input, sectionFilter);

    // Persist into GeneratedDocument so the user can fetch it later via
    // the existing tender detail page (which already lists generated docs).
    const doc = await prisma.generatedDocument.create({
      data: {
        tenderId: ctx.tenderId,
        name: `Technical Proposal (background) ${new Date().toISOString().slice(0, 19).replace("T", " ")}`,
        documentType: "QUICK_DRAFT",
        format: "MARKDOWN",
        fileContent: markdown,
        generationStatus: "GENERATED",
        validationStatus: "PENDING",
        reviewStatus: "NOT_EXPORTABLE",
      },
    });

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

    const proposalMarkdown = typeof ctx.input?.proposalMarkdown === "string"
      ? (ctx.input.proposalMarkdown as string)
      : tender.generatedDocuments[0]?.fileContent ?? "";
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
