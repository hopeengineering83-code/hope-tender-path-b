import { logger } from "../observability";
import { randomUUID } from "crypto";
import { prisma } from "../prisma";
import { computeTenderMutationLockKey } from "./advisory-lock-key";
import { logAction } from "../audit";
import { analyzeTender, normalizeStrategicRequirements } from "./analysis";
import { analyzeWithAI, isAIEnabled } from "../ai";
import { buildCompliance } from "./compliance";
import { buildDocumentPlan } from "./documents";
import { buildMatches } from "./matching";
import { applyMainEngineBestAvailableSelection } from "./main-engine-selection-policy";
import { applyAIRematchToMainEngine } from "./main-engine-ai-rematch";
import { buildDeterministicFallbackRows, mergeFallbackRows } from "./deterministic-fallback-rows";
import type { MatchPerspective } from "./ai-multi-perspective-matcher";
import { inferSector } from "./proposal-intelligence";
import { classifyTenderRequirement } from "./requirement-categories";
import { REMATCH_TIMEOUT_MS } from "../timeout-config";
import { isDurablyReviewed } from "../vault-review-provenance";
import { loadDurableCompanySupportRecords } from "../prisma-schema-compatibility";

// ─── Vercel function-budget reserves ────────────────────────────────────
// The engine route passes deadlineAt = Date.now() + 50_000 so the whole run
// stays under Vercel Hobby's 60s cap. AI rematch is wrapped by
// withRematchTimeout(REMATCH_TIMEOUT_MS) (default 40s, see timeout-config).
// We must NOT start the rematch unless the remaining budget covers the full
// rematch timeout PLUS buffers for DB persistence and HTTP response
// serialization — otherwise Vercel kills the function mid-rematch and the
// user gets a 504 with no partial result. These reserves are deliberately
// conservative; they are NOT a perf knob.
const DB_PERSISTENCE_BUFFER_MS = 8_000; // prisma $transaction + writeEngineRunAudit
const RESPONSE_SERIALIZATION_BUFFER_MS = 2_000; // NextResponse.json + network egress
const REMATCH_RESERVE_MS =
  REMATCH_TIMEOUT_MS + DB_PERSISTENCE_BUFFER_MS + RESPONSE_SERIALIZATION_BUFFER_MS;

export type EngineRunOptions = {
  safe?: boolean;
  skipAiRematch?: boolean;
  maxChars?: number;
  /**
   * Wall-clock deadline (epoch ms) for the entire engine run. When the deadline
   * is near, AI rematch is skipped and the engine returns partial results
   * instead of being hard-killed by Vercel's 60s function limit. The engine
   * route passes `Date.now() + 50_000` (50s, leaving 10s for DB persistence
   * + response serialization) so the engine never exceeds the 60s Vercel Hobby
   * cap.
   */
  deadlineAt?: number;
};

export function deduplicatePageText(text: string): string {
  const chunks = text.split(/---\s*NEXT DOCUMENT\s*---/i);
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const chunk of chunks) {
    const normalised = chunk.replace(/\s+/g, " ").trim().slice(0, 500);
    if (normalised.length < 50 || !seen.has(normalised)) {
      seen.add(normalised);
      deduped.push(chunk);
    }
  }
  return deduped.join("\n\n--- NEXT DOCUMENT ---\n\n");
}

function chunks<T>(items: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function writeEngineRunAudit(args: {
  userId: string;
  tenderId: string;
  action: "TENDER_ENGINE_RUN_STARTED" | "TENDER_ENGINE_RUN_COMPLETED" | "TENDER_ENGINE_RUN_FAILED" | "TENDER_ENGINE_DOCUMENTS_SUPERSEDED";
  description: string;
  metadata: Record<string, unknown>;
  // Optional transaction client — when provided, the audit write runs INSIDE
  // the transaction so it commits/rolls back atomically with the state change
  // it records. Previously the TENDER_ENGINE_DOCUMENTS_SUPERSEDED audit was
  // written BEFORE the transaction, so a rolled-back supersede left a false
  // audit record claiming documents were superseded when they were still active.
  tx?: { auditLog: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> } } | Parameters<Parameters<typeof prisma["$transaction"]>[0]>[0];
}) {
  // When a transaction client is provided, write the audit row inside the
  // transaction so it commits/rolls back atomically.
  if (args.tx) {
    try {
      await args.tx.auditLog.create({
        data: {
          userId: args.userId ?? null,
          action: args.action,
          entityType: "Tender",
          entityId: args.tenderId,
          description: args.description,
          metadata: JSON.stringify(args.metadata),
        },
      });
    } catch {
      // Never let audit logging crash the main flow
    }
    return;
  }
  await logAction({ userId: args.userId, action: args.action, entityType: "Tender", entityId: args.tenderId, description: args.description, metadata: args.metadata });
}

type MainEngineAIRematchState = {
  aiApplied: boolean;
  expertAssessments: number;
  projectAssessments: number;
  selectedExpertCount: number;
  selectedProjectCount: number;
  warning: string | null;
  expertScoreBreakdowns: Record<string, Partial<Record<MatchPerspective, number>>>;
  projectScoreBreakdowns: Record<string, Partial<Record<MatchPerspective, number>>>;
};

// ─── Progress callback ────────────────────────────────────────────────
// Optional callback so callers (notably the ENGINE_RUN job handler) can
// surface granular step progress to the user. Sync function — does NOT
// block the engine. Caller is responsible for any async fan-out.
// Pre-fix the ENGINE_RUN handler only emitted "engine.start" /
// "engine.complete", so users running in background saw a single
// "Starting engine run for tender X" message for up to 10 minutes,
// then a binary success/fail. This callback lets the handler emit
// real progress through the pipeline.
export type EngineProgressCallback = (stepName: string, message: string) => void;

export async function runTenderEngine(
  tenderId: string,
  userId: string,
  onProgress?: EngineProgressCallback,
  options?: EngineRunOptions,
) {
  const progress = onProgress ?? (() => {});
  progress("engine.load", "Loading tender + files");
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: { files: { select: { id: true, originalFileName: true, mimeType: true, classification: true, extractedText: true } } },
  });
  if (!tender) throw new Error("Tender not found");
  progress("engine.company", "Loading company vault (experts + projects + documents)");

  const companyBase = await prisma.company.findUnique({
    where: { userId },
    include: {
      experts: {
        include: {
          sourceDocument: {
            select: { id: true, companyId: true, extractedText: true, contentSha256: true, contentByteLength: true, integrityStatus: true },
          },
        },
      },
      projects: {
        include: {
          sourceDocument: {
            select: { id: true, companyId: true, extractedText: true, contentSha256: true, contentByteLength: true, integrityStatus: true },
          },
        },
      },
      documents: { select: { id: true, category: true, originalFileName: true, extractedText: true } },
    },
  });
  if (!companyBase) throw new Error("Company profile required before engine run");
  const supportRecords = await loadDurableCompanySupportRecords(prisma, companyBase.id);
  const company = { ...companyBase, ...supportRecords };

  const engineRunId = randomUUID();
  const startedAt = new Date();
  await writeEngineRunAudit({
    userId,
    tenderId,
    action: "TENDER_ENGINE_RUN_STARTED",
    description: `Started tender engine run for "${tender.title}"`,
    metadata: {
      engineRunId,
      startedAt: startedAt.toISOString(),
      tenderFileCount: tender.files.length,
      companyExpertCount: company.experts.length,
      companyProjectCount: company.projects.length,
      destructiveCurrentStateRefresh: false,
      note: "Current-state matching/compliance artifacts are refreshed in place; generated document history is preserved by superseding older documents instead of deleting them.",
    },
  });

  try {
    progress("engine.analyze", "Analyzing tender requirements (extracting structured requirements)");
    let analysis: ReturnType<typeof analyzeTender>;
    let analysisMethod: "AI" | "REGEX_FALLBACK_AI_DISABLED" | "REGEX_FALLBACK_NO_TEXT" | "REGEX_FALLBACK_AI_ERROR" = "REGEX_FALLBACK_AI_DISABLED";
    let analysisFallbackReason: string | null = null;

    if (isAIEnabled()) {
      let tenderText = tender.files
        .map((f) => (f.extractedText ?? "").trim())
        .map((t) => t.replace(/^\[(?:PDF text|OCR text)[^\]]*\]\s*\n+/i, ""))
        .filter((t) => t.length > 100 && !/^\[(?:Scanned PDF|Extraction failed|Image:|Legacy \.doc)/i.test(t))
        .join("\n\n--- NEXT DOCUMENT ---\n\n");

      if (options?.safe || options?.maxChars) {
        tenderText = deduplicatePageText(tenderText);
      }
      // In safe mode, cap text at 50 000 chars if no explicit limit is set.
      // analyzeWithAI on an unbounded large tender can take 60-90 s, hitting
      // Vercel's 60 s function kill. 50 k chars completes in ~20-30 s and
      // still covers enough context for solid requirement extraction.
      const effectiveMaxChars = options?.maxChars ?? (options?.safe ? 50_000 : undefined);
      if (effectiveMaxChars && tenderText.length > effectiveMaxChars) {
        tenderText = tenderText.slice(0, effectiveMaxChars);
      }

      if (tenderText.length > 500) {
        try {
          progress("engine.analyze", `Analyzing ${Math.round(tenderText.length / 1000)}k chars of tender text with AI (structured requirement extraction)`);
          const aiMeta = await analyzeWithAI(tenderText);
          const aiResult = aiMeta.result;
          const rawRequirements = aiResult.requirements.map((req, idx) => ({
            title: req.title,
            description: req.description,
            requirementType: req.requirementType,
            priority: req.priority,
            requiredQuantity: req.requiredQuantity ?? null,
            pageLimit: req.pageLimit ?? null,
            exactFileName: req.exactFileName ?? null,
            exactOrder: idx + 1,
            restrictions: req.restrictions ?? null,
            sectionReference: req.sectionReference ?? null,
          }));
          const strategicRequirements = normalizeStrategicRequirements(rawRequirements);
          analysis = {
            summary: `Senior consultant interpretation: consolidated ${rawRequirements.length} extracted instruction(s) into ${strategicRequirements.length} strategic requirement bundle(s). ${aiResult.summary}`,
            requirements: strategicRequirements,
            exactFileNaming: aiResult.exactFileNaming ?? [],
            exactFileOrder: aiResult.exactFileOrder ?? [],
          };
          analysisMethod = "AI";
        } catch (err) {
          logger.error("[engine] AI analysis failed — falling back to regex:", { detail: err });
          analysisMethod = "REGEX_FALLBACK_AI_ERROR";
          analysisFallbackReason = err instanceof Error ? err.message : String(err);
          analysis = analyzeTender(tender);
        }
      } else {
        analysisMethod = "REGEX_FALLBACK_NO_TEXT";
        analysisFallbackReason = `Extracted tender text is only ${tenderText.length} chars; AI analysis needs at least 500.`;
        analysis = analyzeTender(tender);
      }
    } else {
      analysisMethod = "REGEX_FALLBACK_AI_DISABLED";
      analysisFallbackReason = "GEMINI_API_KEY is not configured.";
      analysis = analyzeTender(tender);
    }

    const reviewedExperts = company.experts.filter((expert) => isDurablyReviewed(expert));
    const reviewedProjects = company.projects.filter((project) => isDurablyReviewed(project));
    const unsupportedReviewedExpertCount = company.experts.filter((expert) => expert.trustLevel === "REVIEWED" && !isDurablyReviewed(expert)).length;
    const unsupportedReviewedProjectCount = company.projects.filter((project) => project.trustLevel === "REVIEWED" && !isDurablyReviewed(project)).length;
    const aiDraftExpertCount = company.experts.filter((e) => e.trustLevel === "AI_DRAFT").length;
    const aiDraftProjectCount = company.projects.filter((p) => p.trustLevel === "AI_DRAFT").length;
    const regexDraftExpertCount = company.experts.filter((e) => !e.trustLevel || e.trustLevel === "REGEX_DRAFT").length;
    const regexDraftProjectCount = company.projects.filter((p) => !p.trustLevel || p.trustLevel === "REGEX_DRAFT").length;

    const knowledge = {
      companyId: company.id,
      experts: [...reviewedExperts, ...company.experts.filter((e) => e.trustLevel !== "REVIEWED")],
      projects: [...reviewedProjects, ...company.projects.filter((p) => p.trustLevel !== "REVIEWED")],
      documents: company.documents,
      legalRecords: company.legalRecords,
      financialRecords: company.financialRecords,
      complianceRecords: company.complianceRecords,
    };

    const knowledgeReadiness = {
      reviewedExperts: reviewedExperts.length,
      reviewedProjects: reviewedProjects.length,
      unsupportedReviewedExperts: unsupportedReviewedExpertCount,
      unsupportedReviewedProjects: unsupportedReviewedProjectCount,
      aiDraftExperts: aiDraftExpertCount,
      aiDraftProjects: aiDraftProjectCount,
      regexDraftExperts: regexDraftExpertCount,
      regexDraftProjects: regexDraftProjectCount,
      hasUsableExperts: reviewedExperts.length > 0,
      hasUsableProjects: reviewedProjects.length > 0,
      hasBlockingExperts: aiDraftExpertCount + regexDraftExpertCount + unsupportedReviewedExpertCount > 0,
      hasBlockingProjects: aiDraftProjectCount + regexDraftProjectCount + unsupportedReviewedProjectCount > 0,
    };

    // PR XX-MATCH-FIX MERGE Fix C — pass the INFERRED sector (from tender
    // body text) to buildMatches() instead of `tender.category` which
    // defaults to "General". inferSector() reads the same healthcare /
    // water / road / urban patterns as proposal-intelligence so the
    // engine matcher's sectorBoost() finally has a meaningful comparison
    // string. Then the existing main-engine policy + AI rematch run
    // on top, getting candidates that are already sector-screened.
    const sectorSignalText = [
      tender.title ?? "",
      tender.description ?? "",
      analysis.summary ?? "",
      ...analysis.requirements.slice(0, 8).map((r) => `${r.title} ${r.description}`),
    ].join("\n");
    const inferredSector = inferSector(sectorSignalText);
    const sectorForMatching = inferredSector !== "General Consultancy / Engineering"
      ? inferredSector
      : (tender.category || null);
    if (inferredSector !== "General Consultancy / Engineering") {
      logger.info(`[run-tender-engine] Inferred tender sector: "${inferredSector}" (used for matching instead of tender.category="${tender.category}")`);
    }

    progress("engine.match", `Running deterministic matching across ${knowledge.experts.length} expert(s) and ${knowledge.projects.length} project(s)`);
    const initialMatching = buildMatches(analysis.requirements, knowledge, sectorForMatching, tender.title);
    let matching = applyMainEngineBestAvailableSelection({
      requirements: analysis.requirements,
      matching: initialMatching,
      expertTrust: new Map(knowledge.experts.map((expert) => [expert.id, expert.trustLevel])),
      projectTrust: new Map(knowledge.projects.map((project) => [project.id, project.trustLevel])),
    });
    progress("engine.match.done", `Deterministic matching done: ${matching.expertMatches.length} expert candidates, ${matching.projectMatches.length} project candidates`);

    let mainEngineAIRematch: MainEngineAIRematchState = {
      aiApplied: false,
      expertAssessments: 0,
      projectAssessments: 0,
      selectedExpertCount: matching.expertMatches.filter((match) => match.isSelected).length,
      selectedProjectCount: matching.projectMatches.filter((match) => match.isSelected).length,
      warning: null,
      expertScoreBreakdowns: {},
      projectScoreBreakdowns: {},
    };

    // ─── Vercel time budget: skip AI rematch when deadline is near ──────
    // The AI rematch is wrapped by withRematchTimeout(REMATCH_TIMEOUT_MS)
    // (default 40s). We must NOT start it unless the remaining budget covers
    // REMATCH_RESERVE_MS (= REMATCH_TIMEOUT_MS + DB_PERSISTENCE_BUFFER_MS +
    // RESPONSE_SERIALIZATION_BUFFER_MS) so Vercel cannot kill the function
    // mid-rematch and leave the user with a 504 + no partial result. When the
    // deadline is near, the engine skips AI rematch, uses deterministic
    // matching, and ALWAYS returns partial=true (see Blocker 2 fix below —
    // the deadline skip itself is a blocker even when no fallback rows are
    // created, so the route reports success=false and the UI surfaces the
    // real state instead of "engine completed").
    const deadlineNear = typeof options?.deadlineAt === "number" &&
      Date.now() + REMATCH_RESERVE_MS >= options.deadlineAt;
    let rematchSkippedForDeadline = false;

    if (!options?.skipAiRematch && !options?.safe && isAIEnabled() && !deadlineNear) {
      progress("engine.ai-rematch", "Running AI 12-perspective rematch (DISCIPLINE_FIT, SCOPE_COVERAGE, EVIDENCE_QUALITY, etc.)");
      const aiRematch = await applyAIRematchToMainEngine({
        tenderTitle: tender.title,
        tenderCategory: tender.category,
        evaluationMethodology: (analysis as { evaluationMethodology?: string | null }).evaluationMethodology ?? null,
        requirements: analysis.requirements,
        matching,
        knowledge,
      });
      matching = aiRematch.matching;
      mainEngineAIRematch = {
        aiApplied: aiRematch.aiApplied,
        expertAssessments: aiRematch.expertAssessments,
        projectAssessments: aiRematch.projectAssessments,
        selectedExpertCount: aiRematch.selectedExpertCount,
        selectedProjectCount: aiRematch.selectedProjectCount,
        warning: aiRematch.warning,
        expertScoreBreakdowns: aiRematch.expertScoreBreakdowns,
        projectScoreBreakdowns: aiRematch.projectScoreBreakdowns,
      };
      if (aiRematch.warning) logger.warn("[run-tender-engine] main-engine AI rematch warning:", { detail: aiRematch.warning });
    } else if (deadlineNear && !options?.skipAiRematch && !options?.safe && isAIEnabled()) {
      rematchSkippedForDeadline = true;
      logger.warn("[run-tender-engine] AI rematch skipped — deadline near, insufficient time for 40s rematch within Vercel function budget.");
      mainEngineAIRematch.warning = "AI rematch skipped — insufficient time remaining in Vercel function budget. Deterministic matching was used; re-run in background mode for AI scoring.";
    }

    const filesWithText = tender.files.filter((f) => typeof f.extractedText === "string" && f.extractedText.length > 200);
    if (filesWithText.length > 0 && analysis.requirements.length > 0) {
      try {
        const { extractRequirementSources } = await import("./requirement-source-extractor");
        const draftWithIds: Array<{ id: string; req: typeof analysis.requirements[number] }> = analysis.requirements.map((req) => ({ id: randomUUID(), req }));
        type Coord = { fileId?: string; pageNumber?: number; sectionHeading?: string; exactQuote?: string; confidence: number };
        const bestByReqId = new Map<string, Coord>();
        for (const file of filesWithText) {
          const found = extractRequirementSources({
            tenderFileId: file.id,
            tenderFileText: file.extractedText ?? "",
            requirements: draftWithIds.map((d) => ({ id: d.id, title: d.req.title, description: d.req.description })),
          });
          for (const f of found) {
            if (f.sourceConfidence === 0) continue;
            const prev = bestByReqId.get(f.requirementId);
            if (!prev || f.sourceConfidence > prev.confidence) {
              bestByReqId.set(f.requirementId, { fileId: f.sourceTenderFileId, pageNumber: f.sourcePageNumber, sectionHeading: f.sourceSectionHeading, exactQuote: f.sourceExactQuote, confidence: f.sourceConfidence });
            }
          }
        }
        for (const { id, req } of draftWithIds) {
          const coord = bestByReqId.get(id);
          if (coord) {
            req.sourceTenderFileId = coord.fileId ?? null;
            req.sourcePageNumber = coord.pageNumber ?? null;
            req.sourceSectionHeading = coord.sectionHeading ?? null;
            req.sourceExactQuote = coord.exactQuote ?? null;
            req.sourceConfidence = coord.confidence;
          }
        }
        logger.info(`[run-tender-engine] requirement source extractor: ${bestByReqId.size}/${analysis.requirements.length} requirements matched to a source paragraph.`);
      } catch (eErr) {
        logger.warn("[run-tender-engine] requirement source extractor failed:", { detail: eErr instanceof Error ? eErr.message : eErr });
      }
    }

    const createdRequirements = analysis.requirements.map((requirement) => ({ id: randomUUID(), requirement }));
    const requirementRows = createdRequirements.map(({ id, requirement }) => {
      // Classify the requirement into a category + mandatory level using the
      // universal requirement-categories module.
      const reqClassification = classifyTenderRequirement(
        `${requirement.title ?? ""} ${requirement.description ?? ""}`,
      );
      return {
      id,
      tenderId,
      title: requirement.title,
      description: requirement.description,
      requirementType: requirement.requirementType,
      priority: requirement.priority,
      requiredQuantity: requirement.requiredQuantity ?? null,
      pageLimit: requirement.pageLimit ?? null,
      exactFileName: requirement.exactFileName ?? null,
      exactOrder: requirement.exactOrder ?? null,
      restrictions: requirement.restrictions ?? null,
      sectionReference: requirement.sectionReference ?? null,
      sourceTenderFileId: requirement.sourceTenderFileId ?? null,
      sourcePageNumber: requirement.sourcePageNumber ?? null,
      sourceSectionHeading: requirement.sourceSectionHeading ?? null,
      sourceExactQuote: requirement.sourceExactQuote ?? null,
      sourceConfidence: typeof requirement.sourceConfidence === "number" ? requirement.sourceConfidence : 0,
      // Universal requirement categorization — stored in sectionReference
      // (reuses existing column; no migration needed). Preserves original
      // sectionReference text if present.
      ...(reqClassification.category !== "unknown"
        ? { sectionReference: `[${reqClassification.category}:${reqClassification.mandatory}]${requirement.sectionReference ? " " + requirement.sectionReference : ""}` }
        : {}),
      };
    });

    progress("engine.compliance", "Building compliance matrix + gap analysis");
    let compliance = buildCompliance(createdRequirements, knowledge, matching);

    // ─── Evidence-matching blocker when AI rematch failed ────────────────
    // PR #1049 rewrote the fallback-rows module to be diagnostics-only.
    // PR #1055 further ensures that when AI rematch fails or is skipped,
    // NO ComplianceMatrix rows are created from tender-source diagnostics.
    // PR #1060 adds the mergeFallbackRows boundary call to make the
    // evidence-provenance boundary explicit in the call site.
    let evidenceMatchingBlocker: { code: string; message: string } | null = null;
    const aiRematchFailed = (!mainEngineAIRematch.aiApplied && mainEngineAIRematch.warning !== null) || rematchSkippedForDeadline;
    const hasSourceGroundedRequirements = createdRequirements.some(
      ({ requirement }) =>
        requirement.sourceTenderFileId &&
        requirement.sourcePageNumber != null &&
        requirement.sourceExactQuote &&
        requirement.sourceExactQuote.trim().length > 0 &&
        (typeof requirement.sourceConfidence === "number" ? requirement.sourceConfidence : 0) > 0,
    );
    if (aiRematchFailed && hasSourceGroundedRequirements) {
      const fallback = buildDeterministicFallbackRows(
        createdRequirements.map(({ id, requirement }) => ({
          id,
          title: requirement.title,
          description: requirement.description,
          requirementType: requirement.requirementType,
          priority: requirement.priority,
          sourceTenderFileId: requirement.sourceTenderFileId ?? null,
          sourcePageNumber: requirement.sourcePageNumber ?? null,
          sourceExactQuote: requirement.sourceExactQuote ?? null,
          sourceConfidence: typeof requirement.sourceConfidence === "number" ? requirement.sourceConfidence : 0,
        })),
      );
      if (fallback.rows.length > 0) {
        // mergeFallbackRows is a no-op (evidence-provenance boundary). We
        // call it to make the boundary explicit in the call site — if the
        // function is ever changed to merge rows, the boundary test in
        // tests/evidence-provenance-boundary.test.ts will fail.
        compliance = mergeFallbackRows(compliance, fallback.rows);
        // When the rematch was skipped for deadline (not provider failure),
        // override the blocker code so the nextAction mapper routes the user
        // to RETRY_ENGINE_SMALLER_BATCH (re-run in background mode) instead of
        // REVIEW_MATCHING_INPUTS. The fallback blocker code is
        // EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED which maps to the wrong
        // nextAction for a deadline skip.
        evidenceMatchingBlocker = {
          code: rematchSkippedForDeadline ? "EVIDENCE_MATCHING_AI_SKIPPED_DEADLINE" : fallback.blockerCode!,
          message: rematchSkippedForDeadline
            ? "AI evidence matching was skipped because the remaining Vercel function time could not cover the full rematch timeout. Deterministic matching was used. Re-run in background mode for AI multi-perspective scoring."
            : fallback.blockerMessage!,
        };
        logger.info(`[run-tender-engine] Set ${evidenceMatchingBlocker.code} blocker for ${fallback.rows.length} source-grounded requirement(s) (diagnostic rows not persisted as compliance evidence — mergeFallbackRows is fail-closed no-op).`);
      }
    } else if (aiRematchFailed) {
      // AI rematch failed but no source-grounded requirements — still set blocker
      evidenceMatchingBlocker = {
        code: "AI_REMATCH_FAILED_ZERO_EVIDENCE",
        message: mainEngineAIRematch.warning ?? "AI multi-perspective rematch failed. Zero Company Vault evidence matched."
      };
      logger.info(`[run-tender-engine] AI rematch failed: zero requirement source matches, zero ComplianceMatrix rows created. Reason: ${mainEngineAIRematch.warning}`);
    }

    // ─── Blocker 2: deadline-skipped rematch is ALWAYS partial ───────────
    // When the engine deliberately skipped the 12-perspective AI rematch
    // because the Vercel function budget could not cover REMATCH_RESERVE_MS,
    // the run MUST be reported as partial regardless of whether the
    // requirement source extractor produced source-grounded requirements
    // (and therefore whether fallback rows were created). Previously, a
    // deadline-skipped run with no source-grounded requirements left
    // evidenceMatchingBlocker = null, so the route reported success=true
    // and downstream callers proceeded as if the 12-perspective rematch
    // had completed. That hid a deliberate skip from the user. The skip
    // itself is the blocker. (When aiRematchFailed is true for a non-deadline
    // reason — provider error/timeout — and there are no source-grounded
    // requirements, we intentionally do NOT synthesize a blocker here: the
    // existing null warning path correctly reflects "no evidentiary state
    // to review", and the route's analysisMethod guard already surfaces
    // REGEX_FALLBACK_AI_ERROR via nextAction RETRY_ENGINE_SMALLER_BATCH.)
    if (rematchSkippedForDeadline && evidenceMatchingBlocker === null) {
      evidenceMatchingBlocker = {
        code: "EVIDENCE_MATCHING_AI_SKIPPED_DEADLINE",
        message: "AI evidence matching was skipped because the remaining Vercel function time could not cover the full rematch timeout. Deterministic matching was used. Re-run in background mode for AI multi-perspective scoring.",
      };
      logger.warn("[run-tender-engine] Deadline-skipped rematch reported as partial even without fallback rows (EVIDENCE_MATCHING_AI_SKIPPED_DEADLINE).");
    }

    const hasDraftKnowledge = aiDraftExpertCount + regexDraftExpertCount + aiDraftProjectCount + regexDraftProjectCount > 0;
    const documentPlan = buildDocumentPlan(createdRequirements);
    const hardGaps = compliance.gaps.filter((gap) => gap.severity === "CRITICAL").length;
    const reviewGaps = compliance.gaps.filter((gap) => gap.severity === "HIGH").length + (hasDraftKnowledge ? 1 : 0);
    const reviewNeeded = hardGaps > 0 || reviewGaps > 0;
    const supportedOrReviewableCount = compliance.matrices.filter((m) => ["SUPPORTED", "EVIDENCE_PENDING_REVIEW", "PARTIAL"].includes(m.supportStatus)).length;
    const readinessScore = Math.max(0, Math.min(100, Math.round((supportedOrReviewableCount / Math.max(compliance.matrices.length, 1)) * 100)));

    const activeGeneratedDocuments = await prisma.generatedDocument.findMany({
      where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
      select: { id: true, name: true, documentType: true, exactFileName: true, exactOrder: true, generationStatus: true, validationStatus: true, reviewStatus: true, reviewedBy: true, reviewedAt: true, createdAt: true, updatedAt: true, _count: { select: { reviews: true, comments: true } } },
    });
    const existingCounts = await Promise.all([
      prisma.tenderRequirement.count({ where: { tenderId } }),
      prisma.tenderExpertMatch.count({ where: { tenderId } }),
      prisma.tenderProjectMatch.count({ where: { tenderId } }),
      prisma.complianceMatrix.count({ where: { tenderId } }),
      prisma.complianceGap.count({ where: { tenderId } }),
      prisma.generatedDocument.count({ where: { tenderId, generationStatus: { not: "SUPERSEDED" } } }),
    ]);

    // NOTE: The TENDER_ENGINE_DOCUMENTS_SUPERSEDED audit is now written INSIDE
    // the transaction below (passing tx) so it commits/rolls back atomically
    // with the actual supersede. Previously it was written here (before the
    // transaction), so a rolled-back supersede left a false audit record
    // claiming documents were superseded when they were still active.

    progress("engine.persist", `Persisting ${requirementRows.length} requirement(s), ${matching.expertMatches.length} expert match(es), ${matching.projectMatches.length} project match(es) to DB`);

    // Pre-compute all row arrays before entering the transaction
    const expertMatchRows = matching.expertMatches.map((match) => ({ tenderId, expertId: match.expertId, score: match.score, rationale: match.rationale, isSelected: match.isSelected }));
    const projectMatchRows = matching.projectMatches.map((match) => ({ tenderId, projectId: match.projectId, score: match.score, rationale: match.rationale, isSelected: match.isSelected }));

    try {
      const { writeScoreBreakdown, deterministicScoreBreakdown } = await import("./score-breakdown-writer");
      const tenderTextForScoring = [tender.title, tender.description ?? "", analysis.summary ?? ""].join("\n").slice(0, 8_000);
      const evalText = (tender as { evaluationMethodology?: string | null }).evaluationMethodology ?? "";

      for (const m of matching.expertMatches) {
        const expert = knowledge.experts.find((e) => e.id === m.expertId);
        if (!expert) continue;
        const aiPerspectives = mainEngineAIRematch.expertScoreBreakdowns[m.expertId];
        const candidateText = [expert.fullName ?? "", expert.title ?? "", expert.profile ?? "", expert.disciplines ?? "", expert.sectors ?? ""].join(" ");
        const perspectives = aiPerspectives ?? deterministicScoreBreakdown({ candidateText, tenderText: tenderTextForScoring, evaluationText: evalText });
        await writeScoreBreakdown({ tenderId, entityType: "EXPERT", entityId: expert.id, perspectives, source: aiPerspectives ? "AI_REMATCH" : "ENGINE_MATCH" });
      }

      for (const m of matching.projectMatches) {
        const project = knowledge.projects.find((p) => p.id === m.projectId);
        if (!project) continue;
        const aiPerspectives = mainEngineAIRematch.projectScoreBreakdowns[m.projectId];
        const candidateText = [project.name ?? "", project.clientName ?? "", project.summary ?? "", project.sector ?? "", project.country ?? ""].join(" ");
        const perspectives = aiPerspectives ?? deterministicScoreBreakdown({ candidateText, tenderText: tenderTextForScoring, evaluationText: evalText });
        await writeScoreBreakdown({ tenderId, entityType: "PROJECT", entityId: project.id, perspectives, source: aiPerspectives ? "AI_REMATCH" : "ENGINE_MATCH" });
      }
    } catch (sErr) {
      logger.warn("[run-tender-engine] score breakdown write failed:", { detail: sErr instanceof Error ? sErr.message : sErr });
    }

    const matrixRows = compliance.matrices.map((matrix) => ({ tenderId, requirementId: matrix.requirementId, evidenceType: matrix.evidenceType, evidenceSource: matrix.evidenceSource, evidenceReference: matrix.evidenceReference ?? null, supportLevel: matrix.supportStatus, notes: [matrix.evidenceSummary, matrix.notes].filter(Boolean).join(" | ") || null }));
    const gapRows = compliance.gaps.map((gap) => ({ tenderId, requirementId: gap.requirementId ?? null, severity: gap.severity, title: gap.title, description: gap.description, mitigationPlan: gap.mitigationPlan ?? null }));
    if (hasDraftKnowledge) {
      gapRows.push({ tenderId, requirementId: null, severity: "HIGH", title: "Draft company knowledge requires review", description: `The company knowledge base contains ${aiDraftExpertCount} AI_DRAFT expert(s), ${regexDraftExpertCount} REGEX_DRAFT expert(s), ${aiDraftProjectCount} AI_DRAFT project(s), and ${regexDraftProjectCount} REGEX_DRAFT project(s). Draft records are not used as final submission evidence until marked REVIEWED.`, mitigationPlan: "Open Company Knowledge Review, verify source evidence, correct fields, and mark valid expert/project records as REVIEWED before final generation." });
    }
    const documentRows = documentPlan.documents.map((document) => ({ tenderId, name: document.name, documentType: document.documentType, exactFileName: document.exactFileName ?? null, exactOrder: typeof document.exactOrder === "number" ? document.exactOrder : null, contentSummary: document.contentSummary }));

    // ─── Atomic supersede + create in one transaction ──────────────────────
    // Previously: supersede ran OUTSIDE the transaction (line 390), then create
    // ran INSIDE the transaction (line 443). If the transaction failed, the
    // prior active documents were already SUPERSEDED — the tender had ZERO
    // active documents. Now: supersede + create are in the SAME transaction,
    // so a failure rolls back the supersede too (prior docs stay active).
    //
    // The transaction also acquires a pg_advisory_xact_lock to serialize
    // concurrent engine runs for the same tender — prevents two runs from
    // both superseding + both creating, which would violate the partial
    // unique index on (tenderId, exactFileName) WHERE non-SUPERSEDED.
    await prisma.$transaction(async (tx) => {
      // Serialize concurrent engine runs for this tender.
      // The lock is transaction-scoped (released on commit/rollback).
      const tenderMutationLock = computeTenderMutationLockKey(tenderId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${tenderMutationLock})`;

      // Supersede active documents INSIDE the transaction.
      if (activeGeneratedDocuments.length > 0) {
        await tx.generatedDocument.updateMany({
          where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
          data: {
            generationStatus: "SUPERSEDED",
            validationStatus: "SUPERSEDED",
            reviewStatus: "SUPERSEDED",
            reviewNotes: `Superseded by tender engine run ${engineRunId}. Review/comment history preserved on this historical document record.`,
            updatedAt: new Date(),
          },
        });
        // Write the supersede audit INSIDE the transaction so it commits/rolls
        // back atomically with the supersede. Previously this was written before
        // the transaction — a rolled-back supersede left a false audit record.
        await writeEngineRunAudit({
          userId,
          tenderId,
          action: "TENDER_ENGINE_DOCUMENTS_SUPERSEDED",
          description: `Superseded ${activeGeneratedDocuments.length} generated document(s) before engine rerun for "${tender.title}"`,
          metadata: {
            engineRunId,
            supersededAt: new Date().toISOString(),
            preservedGeneratedDocuments: activeGeneratedDocuments.map((doc) => ({
              id: doc.id,
              name: doc.name,
              documentType: doc.documentType,
              exactFileName: doc.exactFileName,
              exactOrder: doc.exactOrder,
              generationStatus: doc.generationStatus,
              validationStatus: doc.validationStatus,
              reviewStatus: doc.reviewStatus,
              reviewedBy: doc.reviewedBy,
              reviewedAt: doc.reviewedAt?.toISOString() ?? null,
              reviewCount: doc._count.reviews,
              commentCount: doc._count.comments,
              createdAt: doc.createdAt.toISOString(),
              updatedAt: doc.updatedAt.toISOString(),
            })),
          },
          tx,
        });
      }

      await tx.tenderExpertMatch.deleteMany({ where: { tenderId } });
      await tx.tenderProjectMatch.deleteMany({ where: { tenderId } });
      await tx.complianceGap.deleteMany({ where: { tenderId } });
      await tx.complianceMatrix.deleteMany({ where: { tenderId } });
      await tx.tenderRequirement.deleteMany({ where: { tenderId } });
      for (const batch of chunks(requirementRows, 100)) await tx.tenderRequirement.createMany({ data: batch });
      for (const batch of chunks(expertMatchRows, 100)) await tx.tenderExpertMatch.createMany({ data: batch, skipDuplicates: true });
      for (const batch of chunks(projectMatchRows, 100)) await tx.tenderProjectMatch.createMany({ data: batch, skipDuplicates: true });
      for (const batch of chunks(matrixRows, 100)) await tx.complianceMatrix.createMany({ data: batch });
      for (const batch of chunks(gapRows, 100)) await tx.complianceGap.createMany({ data: batch });
      // GeneratedDocument rows represent actual output artifacts only.
      // The submission plan lives in BuildPlan; the engine must not create
      // placeholder GeneratedDocument rows before the transactional generation
      // gate authorizes real bytes. documentRows remains an in-memory preview
      // for diagnostics and Build Plan construction.
      await tx.tender.update({
        where: { id: tenderId },
        data: {
          analysisSummary: analysis.summary,
          exactFileNaming: JSON.stringify(analysis.exactFileNaming),
          exactFileOrder: JSON.stringify(analysis.exactFileOrder),
          evaluationMethodology: (analysis as { evaluationMethodology?: string | null }).evaluationMethodology ?? null,
          readinessScore,
          status: reviewNeeded ? "COMPLIANCE_REVIEW" : "MATCHED",
          stage: reviewNeeded ? "COMPLIANCE" : "MATCHING",
          notes: [
            `Engine run ID: ${engineRunId}`,
            activeGeneratedDocuments.length > 0 ? `${activeGeneratedDocuments.length} previous generated document(s) were superseded and preserved for audit/review history.` : null,
            "Senior consultant mode: broad-fit matching uses capability families, sector/service equivalence, and professional judgment instead of exact wording only.",
            "Main engine selection: reviewed best-available evidence below 90% can be selected when no selected safe evidence exists for a required class; draft knowledge remains excluded from final evidence.",
            mainEngineAIRematch.aiApplied ? `Main engine AI multi-perspective scoring applied automatically: ${mainEngineAIRematch.expertAssessments} expert assessment(s), ${mainEngineAIRematch.projectAssessments} project assessment(s), ${mainEngineAIRematch.selectedExpertCount} selected expert(s), ${mainEngineAIRematch.selectedProjectCount} selected project(s).` : null,
            mainEngineAIRematch.warning ? `Main engine AI multi-perspective scoring fallback: ${mainEngineAIRematch.warning}` : null,
            analysisMethod === "AI" ? "Analysis source: AI (chunked multi-call when tender > 60K chars)." : `Analysis source: regex fallback (${analysisMethod}). ${analysisFallbackReason ?? ""}`.trim(),
            hardGaps > 0 ? `${hardGaps} hard evidence gap(s) remain.` : null,
            reviewGaps > 0 ? `${reviewGaps} senior review item(s) remain; these are not automatic fatal blockers.` : null,
            knowledgeReadiness.hasBlockingExperts ? `${knowledgeReadiness.aiDraftExperts + knowledgeReadiness.regexDraftExperts} expert record(s) are draft and excluded from final evidence until REVIEWED.` : null,
            knowledgeReadiness.hasBlockingProjects ? `${knowledgeReadiness.aiDraftProjects + knowledgeReadiness.regexDraftProjects} project record(s) are draft and excluded from final evidence until REVIEWED.` : null,
            !knowledgeReadiness.hasUsableExperts ? "No REVIEWED experts found — review extracted CV records before final generation." : null,
            !knowledgeReadiness.hasUsableProjects ? "No REVIEWED projects found — review extracted project records before final generation." : null,
            knowledgeReadiness.reviewedExperts > 0 ? `${knowledgeReadiness.reviewedExperts} REVIEWED expert(s) available for final generation.` : null,
            knowledgeReadiness.reviewedProjects > 0 ? `${knowledgeReadiness.reviewedProjects} REVIEWED project(s) available for final generation.` : null,
          ].filter(Boolean).join("\n") || null,
        },
      });
    }, { timeout: 60000 });

    await writeEngineRunAudit({
      userId,
      tenderId,
      action: "TENDER_ENGINE_RUN_COMPLETED",
      description: `Completed tender engine run for "${tender.title}"`,
      metadata: {
        engineRunId,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        analysisMethod,
        analysisFallbackReason,
        previousStateCounts: { requirements: existingCounts[0], expertMatches: existingCounts[1], projectMatches: existingCounts[2], complianceRows: existingCounts[3], gaps: existingCounts[4], activeGeneratedDocuments: existingCounts[5] },
        newStateCounts: { requirements: requirementRows.length, expertMatches: expertMatchRows.length, projectMatches: projectMatchRows.length, complianceRows: matrixRows.length, gaps: gapRows.length, generatedDocuments: 0, plannedDocuments: documentRows.length, supersededGeneratedDocuments: activeGeneratedDocuments.length },
        readinessScore,
        hardGapCount: hardGaps,
        reviewGapCount: reviewGaps,
        reviewNeeded,
        knowledgeReadiness,
        mainEngineAIRematch,
      },
    });

    const tenderResult = await prisma.tender.findUnique({
      where: { id: tenderId },
      include: {
        files: { select: { id: true, originalFileName: true, mimeType: true, size: true, classification: true, extractedText: true, createdAt: true } },
        requirements: true,
        expertMatches: { orderBy: { score: "desc" }, include: { expert: true } },
        projectMatches: { orderBy: { score: "desc" }, include: { project: true } },
        complianceGaps: { orderBy: { createdAt: "desc" } },
        complianceMatrix: { orderBy: { createdAt: "asc" } },
        generatedDocuments: { where: { generationStatus: { not: "SUPERSEDED" } }, orderBy: { exactOrder: "asc" }, select: { id: true, name: true, documentType: true, generationStatus: true, validationStatus: true, reviewStatus: true, exactFileName: true, exactOrder: true, contentSummary: true } },
      },
    });

    // ─── Engine response honesty ──────────────────────────────────────────
    // The engine must NOT return a misleading success if AI matching failed.
    // Return partial:true + blockers[] + nextAction when AI matching failed
    // but deterministic extraction succeeded. The UI uses these fields to
    // surface the real state instead of a misleading "engine completed" green.
    const partial = evidenceMatchingBlocker !== null;
    const blockers = evidenceMatchingBlocker ? [evidenceMatchingBlocker.message] : [];
    // nextAction per blocker code:
    //   EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED (provider error/timeout +
    //     source-grounded requirements → fallback rows created) → review the
    //     matching inputs before re-running.
    //   EVIDENCE_MATCHING_AI_SKIPPED_DEADLINE (Vercel budget could not cover
    //     REMATCH_RESERVE_MS) → re-run in background mode (smaller batch /
    //     escapes the 60s cap) so the 12-perspective rematch can complete.
    //   REGEX_FALLBACK_AI_ERROR (analysis fell back to regex on AI error, no
    //     evidence blocker) → retry with a smaller tender / batch.
    const nextAction = evidenceMatchingBlocker
      ? (evidenceMatchingBlocker.code === "EVIDENCE_MATCHING_AI_SKIPPED_DEADLINE"
        ? "RETRY_ENGINE_SMALLER_BATCH"
        : "REVIEW_MATCHING_INPUTS")
      : analysisMethod === "REGEX_FALLBACK_AI_ERROR"
        ? "RETRY_ENGINE_SMALLER_BATCH"
        : null;
    return Object.assign(tenderResult ?? {}, {
      partial,
      blockers,
      nextAction,
      analysisMethod,
      evidenceMatchingBlocker,
    });
  } catch (error) {
    await writeEngineRunAudit({ userId, tenderId, action: "TENDER_ENGINE_RUN_FAILED", description: `Tender engine run failed for "${tender.title}"`, metadata: { engineRunId, startedAt: startedAt.toISOString(), failedAt: new Date().toISOString(), durationMs: Date.now() - startedAt.getTime(), error: error instanceof Error ? error.message : String(error) } });
    try {
      await prisma.tender.update({ where: { id: tenderId }, data: { status: "ERROR", notes: `Engine run failed at ${new Date().toISOString()}: ${error instanceof Error ? error.message : String(error)}` } });
    } catch {
      // best-effort — don't mask the original error
    }
    throw error;
  }
}
