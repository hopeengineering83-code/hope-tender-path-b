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
import { canUseVaultRecord } from "../vault-review-provenance";
import { loadDurableCompanySupportRecords } from "../prisma-schema-compatibility";
import { selectCanonicalTenderFiles } from "../tender/canonical-source-files";

const DB_PERSISTENCE_BUFFER_MS = 8_000;
const RESPONSE_SERIALIZATION_BUFFER_MS = 2_000;
const REMATCH_RESERVE_MS = REMATCH_TIMEOUT_MS + DB_PERSISTENCE_BUFFER_MS + RESPONSE_SERIALIZATION_BUFFER_MS;

export type EngineRunOptions = {
  safe?: boolean;
  skipAiRematch?: boolean;
  maxChars?: number;
  deadlineAt?: number;
};

export function deduplicatePageText(text: string): string {
  const parts = text.split(/---\s*NEXT DOCUMENT\s*---/i);
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const part of parts) {
    const key = part.replace(/\s+/g, " ").trim().slice(0, 500);
    if (key.length < 50 || !seen.has(key)) {
      seen.add(key);
      deduped.push(part);
    }
  }
  return deduped.join("\n\n--- NEXT DOCUMENT ---\n\n");
}

function chunks<T>(items: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function writeEngineRunAudit(args: {
  userId: string;
  tenderId: string;
  action: "TENDER_ENGINE_RUN_STARTED" | "TENDER_ENGINE_RUN_COMPLETED" | "TENDER_ENGINE_RUN_FAILED" | "TENDER_ENGINE_DOCUMENTS_SUPERSEDED";
  description: string;
  metadata: Record<string, unknown>;
  tx?: { auditLog: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> } } | Parameters<Parameters<typeof prisma["$transaction"]>[0]>[0];
}) {
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
      // Audit failure must not corrupt the engine transaction.
    }
    return;
  }
  await logAction({
    userId: args.userId,
    action: args.action,
    entityType: "Tender",
    entityId: args.tenderId,
    description: args.description,
    metadata: args.metadata,
  });
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

export type EngineProgressCallback = (stepName: string, message: string) => void;

export async function runTenderEngine(
  tenderId: string,
  userId: string,
  onProgress?: EngineProgressCallback,
  options?: EngineRunOptions,
) {
  const progress = onProgress ?? (() => {});
  progress("engine.load", "Loading tender, canonical files, and promoted analysis");

  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      files: {
        select: {
          id: true,
          fileName: true,
          originalFileName: true,
          mimeType: true,
          classification: true,
          extractedText: true,
          deletionStatus: true,
          contentSha256: true,
          integrityStatus: true,
          extractionScore: true,
          extractionMethod: true,
          totalPages: true,
          extractedPages: true,
          failedPages: true,
          createdAt: true,
        },
      },
      requirements: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!tender) throw new Error("Tender not found");

  const canonicalFiles = selectCanonicalTenderFiles(tender.files);
  if (canonicalFiles.length === 0) throw new Error("No canonical active tender source is available");

  progress("engine.company", "Loading source-verified Company Vault evidence");
  const companyBase = await prisma.company.findUnique({
    where: { userId },
    include: {
      experts: {
        where: { deletedAt: null },
        include: {
          sourceDocument: {
            select: { id: true, companyId: true, extractedText: true, contentSha256: true, contentByteLength: true, integrityStatus: true },
          },
        },
      },
      projects: {
        where: { deletedAt: null },
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
      canonicalTenderFileCount: canonicalFiles.length,
      excludedDuplicateSourceCount: Math.max(0, tender.files.length - canonicalFiles.length),
      companyExpertCount: company.experts.length,
      companyProjectCount: company.projects.length,
      destructiveCurrentStateRefresh: false,
    },
  });

  try {
    progress("engine.analyze", "Loading current-revision manual AI Analyze output");
    let analysis: ReturnType<typeof analyzeTender>;
    let analysisMethod: "AI" | "REGEX_FALLBACK_AI_DISABLED" | "REGEX_FALLBACK_NO_TEXT" | "REGEX_FALLBACK_AI_ERROR" = "REGEX_FALLBACK_AI_DISABLED";
    let analysisFallbackReason: string | null = null;

    const promotedRequirements = tender.requirements.filter((requirement) =>
      Boolean(
        requirement.sourceTenderFileId
        && requirement.sourcePageNumber != null
        && requirement.sourceExactQuote
        && requirement.sourceExactQuote.trim().length > 0,
      ),
    );
    const canReusePromotedAnalysis = tender.analysisExtractionStatus === "FULL_EXTRACTION_AI_ANALYZED"
      && promotedRequirements.length > 0;

    if (canReusePromotedAnalysis) {
      analysis = {
        summary: tender.analysisSummary
          || `Reused ${promotedRequirements.length} grounded requirement(s) promoted by the current manual AI Analyze job.`,
        requirements: tender.requirements.map((requirement) => ({
          title: requirement.title,
          description: requirement.description,
          requirementType: requirement.requirementType,
          priority: requirement.priority,
          requiredQuantity: requirement.requiredQuantity,
          pageLimit: requirement.pageLimit,
          exactFileName: requirement.exactFileName,
          exactOrder: requirement.exactOrder,
          restrictions: requirement.restrictions,
          sectionReference: requirement.sectionReference,
          sourceTenderFileId: requirement.sourceTenderFileId,
          sourcePageNumber: requirement.sourcePageNumber,
          sourceSectionHeading: requirement.sourceSectionHeading,
          sourceExactQuote: requirement.sourceExactQuote,
          sourceConfidence: requirement.sourceConfidence,
          sourceExtractionMethod: requirement.sourceExtractionMethod,
        })),
        exactFileNaming: parseStringArray(tender.exactFileNaming),
        exactFileOrder: parseStringArray(tender.exactFileOrder),
      };
      analysisMethod = "AI";
      progress("engine.analyze", `Reused ${promotedRequirements.length} grounded requirement(s); no duplicate AI extraction call was made`);
    } else if (isAIEnabled()) {
      let tenderText = canonicalFiles
        .map((file) => (file.extractedText ?? "").trim())
        .map((text) => text.replace(/^\[(?:PDF text|OCR text)[^\]]*\]\s*\n+/i, ""))
        .filter((text) => text.length > 100 && !/^\[(?:Scanned PDF|Extraction failed|Image:|Legacy \.doc)/i.test(text))
        .join("\n\n--- NEXT DOCUMENT ---\n\n");
      tenderText = deduplicatePageText(tenderText);
      const effectiveMaxChars = options?.maxChars ?? 50_000;
      if (tenderText.length > effectiveMaxChars) tenderText = tenderText.slice(0, effectiveMaxChars);

      if (tenderText.length > 500) {
        try {
          progress("engine.analyze", `No reusable promoted analysis found; analyzing ${Math.round(tenderText.length / 1000)}k canonical characters`);
          const aiMeta = await analyzeWithAI(tenderText);
          const aiResult = aiMeta.result;
          const rawRequirements = aiResult.requirements.map((requirement, index) => ({
            title: requirement.title,
            description: requirement.description,
            requirementType: requirement.requirementType,
            priority: requirement.priority,
            requiredQuantity: requirement.requiredQuantity ?? null,
            pageLimit: requirement.pageLimit ?? null,
            exactFileName: requirement.exactFileName ?? null,
            exactOrder: index + 1,
            restrictions: requirement.restrictions ?? null,
            sectionReference: requirement.sectionReference ?? null,
          }));
          const strategicRequirements = normalizeStrategicRequirements(rawRequirements);
          analysis = {
            summary: `Consolidated ${rawRequirements.length} extracted instruction(s) into ${strategicRequirements.length} strategic requirement bundle(s). ${aiResult.summary}`,
            requirements: strategicRequirements,
            exactFileNaming: aiResult.exactFileNaming ?? [],
            exactFileOrder: aiResult.exactFileOrder ?? [],
          };
          analysisMethod = "AI";
        } catch (error) {
          logger.error("[engine] AI analysis failed; falling back to deterministic extraction", { detail: error });
          analysisMethod = "REGEX_FALLBACK_AI_ERROR";
          analysisFallbackReason = error instanceof Error ? error.message : String(error);
          analysis = analyzeTender({ ...tender, files: canonicalFiles });
        }
      } else {
        analysisMethod = "REGEX_FALLBACK_NO_TEXT";
        analysisFallbackReason = `Canonical extracted text is only ${tenderText.length} characters.`;
        analysis = analyzeTender({ ...tender, files: canonicalFiles });
      }
    } else {
      analysisMethod = "REGEX_FALLBACK_AI_DISABLED";
      analysisFallbackReason = "No AI provider is configured.";
      analysis = analyzeTender({ ...tender, files: canonicalFiles });
    }

    const reviewedExperts = company.experts.filter((expert) => canUseVaultRecord(expert, "GENERATION"));
    const reviewedProjects = company.projects.filter((project) => canUseVaultRecord(project, "GENERATION"));
    const unsupportedReviewedExpertCount = company.experts.filter((expert) =>
      (expert.trustLevel === "REVIEWED" || expert.trustLevel === "SOURCE_VERIFIED")
      && !canUseVaultRecord(expert, "GENERATION"),
    ).length;
    const unsupportedReviewedProjectCount = company.projects.filter((project) =>
      (project.trustLevel === "REVIEWED" || project.trustLevel === "SOURCE_VERIFIED")
      && !canUseVaultRecord(project, "GENERATION"),
    ).length;
    const aiDraftExpertCount = company.experts.filter((expert) => expert.trustLevel === "AI_DRAFT").length;
    const aiDraftProjectCount = company.projects.filter((project) => project.trustLevel === "AI_DRAFT").length;
    const regexDraftExpertCount = company.experts.filter((expert) => !expert.trustLevel || expert.trustLevel === "REGEX_DRAFT").length;
    const regexDraftProjectCount = company.projects.filter((project) => !project.trustLevel || project.trustLevel === "REGEX_DRAFT").length;

    const knowledge = {
      companyId: company.id,
      experts: [...reviewedExperts, ...company.experts.filter((expert) => !reviewedExperts.includes(expert))],
      projects: [...reviewedProjects, ...company.projects.filter((project) => !reviewedProjects.includes(project))],
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

    const sectorSignalText = [
      tender.title ?? "",
      tender.description ?? "",
      analysis.summary ?? "",
      ...analysis.requirements.slice(0, 8).map((requirement) => `${requirement.title} ${requirement.description}`),
    ].join("\n");
    const inferredSector = inferSector(sectorSignalText);
    const sectorForMatching = inferredSector !== "General Consultancy / Engineering"
      ? inferredSector
      : (tender.category || null);

    progress("engine.match", `Running deterministic matching across ${knowledge.experts.length} expert(s) and ${knowledge.projects.length} project(s)`);
    const initialMatching = buildMatches(analysis.requirements, knowledge, sectorForMatching, tender.title);
    let matching = applyMainEngineBestAvailableSelection({
      requirements: analysis.requirements,
      matching: initialMatching,
      expertTrust: new Map(knowledge.experts.map((expert) => [expert.id, expert.trustLevel])),
      projectTrust: new Map(knowledge.projects.map((project) => [project.id, project.trustLevel])),
    });
    progress("engine.match.done", `Deterministic matching selected ${matching.expertMatches.filter((match) => match.isSelected).length} expert(s) and ${matching.projectMatches.filter((match) => match.isSelected).length} project(s)`);

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

    const deadlineNear = typeof options?.deadlineAt === "number"
      && Date.now() + REMATCH_RESERVE_MS >= options.deadlineAt;
    let rematchSkippedForDeadline = false;

    if (!options?.skipAiRematch && !options?.safe && isAIEnabled() && !deadlineNear) {
      progress("engine.ai-rematch", "Running bounded AI multi-perspective reranking");
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
    } else if (deadlineNear && !options?.skipAiRematch && !options?.safe && isAIEnabled()) {
      rematchSkippedForDeadline = true;
      mainEngineAIRematch.warning = "AI reranking skipped to preserve the Vercel function deadline; deterministic source-verified matching was retained.";
      logger.warn("[run-tender-engine] AI reranking skipped near runtime deadline; deterministic matching retained");
    }

    const validCanonicalFileIds = new Set(canonicalFiles.map((file) => file.id));
    const requirementsNeedingSourceExtraction = analysis.requirements.filter((requirement) =>
      !requirement.sourceTenderFileId
      || !validCanonicalFileIds.has(requirement.sourceTenderFileId)
      || requirement.sourcePageNumber == null
      || !requirement.sourceExactQuote
      || requirement.sourceExactQuote.trim().length === 0,
    );
    const filesWithText = canonicalFiles.filter((file) => typeof file.extractedText === "string" && file.extractedText.length > 200);

    if (filesWithText.length > 0 && requirementsNeedingSourceExtraction.length > 0) {
      try {
        const { extractRequirementSources } = await import("./requirement-source-extractor");
        const draftWithIds = requirementsNeedingSourceExtraction.map((requirement) => ({ id: randomUUID(), requirement }));
        type Coordinate = { fileId?: string; pageNumber?: number; sectionHeading?: string; exactQuote?: string; confidence: number };
        const bestByRequirementId = new Map<string, Coordinate>();

        for (const file of filesWithText) {
          const found = extractRequirementSources({
            tenderFileId: file.id,
            tenderFileText: file.extractedText ?? "",
            requirements: draftWithIds.map((item) => ({
              id: item.id,
              title: item.requirement.title,
              description: item.requirement.description,
            })),
          });
          for (const coordinate of found) {
            if (coordinate.sourceConfidence <= 0) continue;
            const previous = bestByRequirementId.get(coordinate.requirementId);
            if (!previous || coordinate.sourceConfidence > previous.confidence) {
              bestByRequirementId.set(coordinate.requirementId, {
                fileId: coordinate.sourceTenderFileId,
                pageNumber: coordinate.sourcePageNumber,
                sectionHeading: coordinate.sourceSectionHeading,
                exactQuote: coordinate.sourceExactQuote,
                confidence: coordinate.sourceConfidence,
              });
            }
          }
        }

        for (const item of draftWithIds) {
          const coordinate = bestByRequirementId.get(item.id);
          if (!coordinate) continue;
          item.requirement.sourceTenderFileId = coordinate.fileId ?? null;
          item.requirement.sourcePageNumber = coordinate.pageNumber ?? null;
          item.requirement.sourceSectionHeading = coordinate.sectionHeading ?? null;
          item.requirement.sourceExactQuote = coordinate.exactQuote ?? null;
          item.requirement.sourceConfidence = coordinate.confidence;
        }
        logger.info(`[run-tender-engine] source extractor repaired ${bestByRequirementId.size}/${requirementsNeedingSourceExtraction.length} missing requirement coordinate(s)`);
      } catch (error) {
        logger.warn("[run-tender-engine] requirement source extraction failed", { detail: error instanceof Error ? error.message : error });
      }
    }

    const createdRequirements = analysis.requirements.map((requirement) => ({ id: randomUUID(), requirement }));
    const requirementRows = createdRequirements.map(({ id, requirement }) => {
      const classification = classifyTenderRequirement(`${requirement.title ?? ""} ${requirement.description ?? ""}`);
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
        sectionReference: classification.category !== "unknown"
          ? `[${classification.category}:${classification.mandatory}]${requirement.sectionReference ? ` ${requirement.sectionReference}` : ""}`
          : requirement.sectionReference ?? null,
        sourceTenderFileId: requirement.sourceTenderFileId ?? null,
        sourcePageNumber: requirement.sourcePageNumber ?? null,
        sourceSectionHeading: requirement.sourceSectionHeading ?? null,
        sourceExactQuote: requirement.sourceExactQuote ?? null,
        sourceConfidence: typeof requirement.sourceConfidence === "number" ? requirement.sourceConfidence : 0,
      };
    });

    progress("engine.compliance", "Building compliance matrix and gap analysis");
    let compliance = buildCompliance(createdRequirements, knowledge, matching);
    let evidenceMatchingBlocker: { code: string; message: string } | null = null;

    const aiRematchFailed = (!mainEngineAIRematch.aiApplied && mainEngineAIRematch.warning !== null) || rematchSkippedForDeadline;
    const hasSourceGroundedRequirements = createdRequirements.some(({ requirement }) =>
      Boolean(
        requirement.sourceTenderFileId
        && requirement.sourcePageNumber != null
        && requirement.sourceExactQuote
        && requirement.sourceExactQuote.trim().length > 0
        && (typeof requirement.sourceConfidence === "number" ? requirement.sourceConfidence : 0) > 0,
      ),
    );
    const hasAuthoritativeDeterministicSelection = matching.expertMatches.some((match) => match.isSelected)
      || matching.projectMatches.some((match) => match.isSelected);

    if (aiRematchFailed && hasSourceGroundedRequirements && !hasAuthoritativeDeterministicSelection) {
      const fallback = buildDeterministicFallbackRows(createdRequirements.map(({ id, requirement }) => ({
        id,
        title: requirement.title,
        description: requirement.description,
        requirementType: requirement.requirementType,
        priority: requirement.priority,
        sourceTenderFileId: requirement.sourceTenderFileId ?? null,
        sourcePageNumber: requirement.sourcePageNumber ?? null,
        sourceExactQuote: requirement.sourceExactQuote ?? null,
        sourceConfidence: typeof requirement.sourceConfidence === "number" ? requirement.sourceConfidence : 0,
      })));
      if (fallback.rows.length > 0) {
        compliance = mergeFallbackRows(compliance, fallback.rows);
        evidenceMatchingBlocker = {
          code: rematchSkippedForDeadline ? "EVIDENCE_MATCHING_AI_SKIPPED_DEADLINE" : fallback.blockerCode!,
          message: rematchSkippedForDeadline
            ? "AI reranking was skipped and deterministic matching found no authoritative selectable evidence. Re-run in background mode for AI multi-perspective scoring."
            : fallback.blockerMessage!,
        };
      }
    } else if (aiRematchFailed && !hasSourceGroundedRequirements) {
      evidenceMatchingBlocker = {
        code: "AI_REMATCH_FAILED_ZERO_EVIDENCE",
        message: "No mandatory requirement could be tied to an active canonical source quote.",
      };
    } else if (aiRematchFailed && hasAuthoritativeDeterministicSelection) {
      logger.warn("[run-tender-engine] optional AI reranking failed or was skipped; authoritative deterministic selection remains valid", {
        detail: mainEngineAIRematch.warning,
      });
    }

    const hasDraftKnowledge = aiDraftExpertCount + regexDraftExpertCount + aiDraftProjectCount + regexDraftProjectCount > 0;
    const documentPlan = buildDocumentPlan(createdRequirements);
    const hardGaps = compliance.gaps.filter((gap) => gap.severity === "CRITICAL").length;
    const reviewGaps = compliance.gaps.filter((gap) => gap.severity === "HIGH").length + (hasDraftKnowledge ? 1 : 0);
    const reviewNeeded = hardGaps > 0 || reviewGaps > 0;
    const supportedOrReviewableCount = compliance.matrices.filter((matrix) =>
      ["SUPPORTED", "EVIDENCE_PENDING_REVIEW", "PARTIAL"].includes(matrix.supportStatus),
    ).length;
    const readinessScore = Math.max(0, Math.min(100, Math.round(
      (supportedOrReviewableCount / Math.max(compliance.matrices.length, 1)) * 100,
    )));

    const activeGeneratedDocuments = await prisma.generatedDocument.findMany({
      where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
      select: {
        id: true,
        name: true,
        documentType: true,
        exactFileName: true,
        exactOrder: true,
        generationStatus: true,
        validationStatus: true,
        reviewStatus: true,
        reviewedBy: true,
        reviewedAt: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { reviews: true, comments: true } },
      },
    });
    const existingCounts = await Promise.all([
      prisma.tenderRequirement.count({ where: { tenderId } }),
      prisma.tenderExpertMatch.count({ where: { tenderId } }),
      prisma.tenderProjectMatch.count({ where: { tenderId } }),
      prisma.complianceMatrix.count({ where: { tenderId } }),
      prisma.complianceGap.count({ where: { tenderId } }),
      prisma.generatedDocument.count({ where: { tenderId, generationStatus: { not: "SUPERSEDED" } } }),
    ]);

    progress("engine.persist", `Persisting ${requirementRows.length} requirements and selected evidence`);
    const expertMatchRows = matching.expertMatches.map((match) => ({
      tenderId,
      expertId: match.expertId,
      score: match.score,
      rationale: match.rationale,
      isSelected: match.isSelected,
    }));
    const projectMatchRows = matching.projectMatches.map((match) => ({
      tenderId,
      projectId: match.projectId,
      score: match.score,
      rationale: match.rationale,
      isSelected: match.isSelected,
    }));

    try {
      const { writeScoreBreakdown, deterministicScoreBreakdown } = await import("./score-breakdown-writer");
      const tenderTextForScoring = [tender.title, tender.description ?? "", analysis.summary ?? ""].join("\n").slice(0, 8_000);
      const evaluationText = tender.evaluationMethodology ?? "";

      for (const match of matching.expertMatches) {
        const expert = knowledge.experts.find((candidate) => candidate.id === match.expertId);
        if (!expert) continue;
        const aiPerspectives = mainEngineAIRematch.expertScoreBreakdowns[match.expertId];
        const candidateText = [expert.fullName ?? "", expert.title ?? "", expert.profile ?? "", expert.disciplines ?? "", expert.sectors ?? ""].join(" ");
        const perspectives = aiPerspectives ?? deterministicScoreBreakdown({ candidateText, tenderText: tenderTextForScoring, evaluationText });
        await writeScoreBreakdown({ tenderId, entityType: "EXPERT", entityId: expert.id, perspectives, source: aiPerspectives ? "AI_REMATCH" : "ENGINE_MATCH" });
      }
      for (const match of matching.projectMatches) {
        const project = knowledge.projects.find((candidate) => candidate.id === match.projectId);
        if (!project) continue;
        const aiPerspectives = mainEngineAIRematch.projectScoreBreakdowns[match.projectId];
        const candidateText = [project.name ?? "", project.clientName ?? "", project.summary ?? "", project.sector ?? "", project.country ?? ""].join(" ");
        const perspectives = aiPerspectives ?? deterministicScoreBreakdown({ candidateText, tenderText: tenderTextForScoring, evaluationText });
        await writeScoreBreakdown({ tenderId, entityType: "PROJECT", entityId: project.id, perspectives, source: aiPerspectives ? "AI_REMATCH" : "ENGINE_MATCH" });
      }
    } catch (error) {
      logger.warn("[run-tender-engine] score breakdown write failed", { detail: error instanceof Error ? error.message : error });
    }

    const matrixRows = compliance.matrices.map((matrix) => ({
      tenderId,
      requirementId: matrix.requirementId,
      evidenceType: matrix.evidenceType,
      evidenceSource: matrix.evidenceSource,
      evidenceReference: matrix.evidenceReference ?? null,
      supportLevel: matrix.supportStatus,
      notes: [matrix.evidenceSummary, matrix.notes].filter(Boolean).join(" | ") || null,
    }));
    const gapRows = compliance.gaps.map((gap) => ({
      tenderId,
      requirementId: gap.requirementId ?? null,
      severity: gap.severity,
      title: gap.title,
      description: gap.description,
      mitigationPlan: gap.mitigationPlan ?? null,
    }));
    if (hasDraftKnowledge) {
      gapRows.push({
        tenderId,
        requirementId: null,
        severity: "HIGH",
        title: "Draft company knowledge is excluded from final evidence",
        description: `${aiDraftExpertCount + regexDraftExpertCount} expert and ${aiDraftProjectCount + regexDraftProjectCount} project record(s) remain draft.`,
        mitigationPlan: "Upload or reconcile genuine source documents so eligible records become SOURCE_VERIFIED.",
      });
    }
    const documentRows = documentPlan.documents.map((document) => ({
      tenderId,
      name: document.name,
      documentType: document.documentType,
      exactFileName: document.exactFileName ?? null,
      exactOrder: typeof document.exactOrder === "number" ? document.exactOrder : null,
      contentSummary: document.contentSummary,
    }));

    await prisma.$transaction(async (tx) => {
      const tenderMutationLock = computeTenderMutationLockKey(tenderId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${tenderMutationLock})`;

      if (activeGeneratedDocuments.length > 0) {
        await tx.generatedDocument.updateMany({
          where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
          data: {
            generationStatus: "SUPERSEDED",
            validationStatus: "SUPERSEDED",
            reviewStatus: "SUPERSEDED",
            reviewNotes: `Superseded by tender engine run ${engineRunId}. Review and comment history was preserved.`,
            updatedAt: new Date(),
          },
        });
        await writeEngineRunAudit({
          userId,
          tenderId,
          action: "TENDER_ENGINE_DOCUMENTS_SUPERSEDED",
          description: `Superseded ${activeGeneratedDocuments.length} generated document(s) before engine rerun for "${tender.title}"`,
          metadata: {
            engineRunId,
            supersededAt: new Date().toISOString(),
            preservedGeneratedDocuments: activeGeneratedDocuments.map((document) => ({
              id: document.id,
              name: document.name,
              documentType: document.documentType,
              exactFileName: document.exactFileName,
              exactOrder: document.exactOrder,
              generationStatus: document.generationStatus,
              validationStatus: document.validationStatus,
              reviewStatus: document.reviewStatus,
              reviewedBy: document.reviewedBy,
              reviewedAt: document.reviewedAt?.toISOString() ?? null,
              reviewCount: document._count.reviews,
              commentCount: document._count.comments,
              createdAt: document.createdAt.toISOString(),
              updatedAt: document.updatedAt.toISOString(),
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
      for (const batch of chunks(requirementRows)) await tx.tenderRequirement.createMany({ data: batch });
      for (const batch of chunks(expertMatchRows)) await tx.tenderExpertMatch.createMany({ data: batch, skipDuplicates: true });
      for (const batch of chunks(projectMatchRows)) await tx.tenderProjectMatch.createMany({ data: batch, skipDuplicates: true });
      for (const batch of chunks(matrixRows)) await tx.complianceMatrix.createMany({ data: batch });
      for (const batch of chunks(gapRows)) await tx.complianceGap.createMany({ data: batch });

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
            canReusePromotedAnalysis ? "Engine reused the current manual AI Analyze output; requirement extraction was not repeated." : null,
            Math.max(0, tender.files.length - canonicalFiles.length) > 0 ? `${tender.files.length - canonicalFiles.length} duplicate or alternate source representation(s) were excluded.` : null,
            activeGeneratedDocuments.length > 0 ? `${activeGeneratedDocuments.length} previous generated document(s) were superseded and preserved.` : null,
            "Deterministic matching uses source-verified Company Vault evidence and broad capability/sector equivalence.",
            mainEngineAIRematch.aiApplied ? `Bounded AI reranking assessed ${mainEngineAIRematch.expertAssessments} expert and ${mainEngineAIRematch.projectAssessments} project candidate(s).` : null,
            mainEngineAIRematch.warning ? `AI reranking warning: ${mainEngineAIRematch.warning}` : null,
            analysisMethod === "AI" ? "Analysis source: current AI Analyze output." : `Analysis source: deterministic fallback (${analysisMethod}). ${analysisFallbackReason ?? ""}`.trim(),
            hardGaps > 0 ? `${hardGaps} critical evidence gap(s) remain.` : null,
            reviewGaps > 0 ? `${reviewGaps} review item(s) remain.` : null,
            knowledgeReadiness.reviewedExperts > 0 ? `${knowledgeReadiness.reviewedExperts} SOURCE_VERIFIED/REVIEWED expert(s) are eligible.` : null,
            knowledgeReadiness.reviewedProjects > 0 ? `${knowledgeReadiness.reviewedProjects} SOURCE_VERIFIED/REVIEWED project(s) are eligible.` : null,
          ].filter(Boolean).join("\n") || null,
        },
      });
    }, { timeout: 60_000 });

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
        reusedPromotedAnalysis: canReusePromotedAnalysis,
        canonicalTenderFileCount: canonicalFiles.length,
        excludedDuplicateSourceCount: Math.max(0, tender.files.length - canonicalFiles.length),
        previousStateCounts: {
          requirements: existingCounts[0],
          expertMatches: existingCounts[1],
          projectMatches: existingCounts[2],
          complianceRows: existingCounts[3],
          gaps: existingCounts[4],
          activeGeneratedDocuments: existingCounts[5],
        },
        newStateCounts: {
          requirements: requirementRows.length,
          expertMatches: expertMatchRows.length,
          projectMatches: projectMatchRows.length,
          complianceRows: matrixRows.length,
          gaps: gapRows.length,
          generatedDocuments: 0,
          plannedDocuments: documentRows.length,
          supersededGeneratedDocuments: activeGeneratedDocuments.length,
        },
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
        files: {
          select: { id: true, originalFileName: true, mimeType: true, size: true, classification: true, extractedText: true, createdAt: true },
        },
        requirements: true,
        expertMatches: { orderBy: { score: "desc" }, include: { expert: true } },
        projectMatches: { orderBy: { score: "desc" }, include: { project: true } },
        complianceGaps: { orderBy: { createdAt: "desc" } },
        complianceMatrix: { orderBy: { createdAt: "asc" } },
        generatedDocuments: {
          where: { generationStatus: { not: "SUPERSEDED" } },
          orderBy: { exactOrder: "asc" },
          select: {
            id: true,
            name: true,
            documentType: true,
            generationStatus: true,
            validationStatus: true,
            reviewStatus: true,
            exactFileName: true,
            exactOrder: true,
            contentSummary: true,
          },
        },
      },
    });

    const partial = evidenceMatchingBlocker !== null;
    const blockers = evidenceMatchingBlocker ? [evidenceMatchingBlocker.message] : [];
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
      reusedPromotedAnalysis: canReusePromotedAnalysis,
    });
  } catch (error) {
    await writeEngineRunAudit({
      userId,
      tenderId,
      action: "TENDER_ENGINE_RUN_FAILED",
      description: `Tender engine run failed for "${tender.title}"`,
      metadata: {
        engineRunId,
        startedAt: startedAt.toISOString(),
        failedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        error: error instanceof Error ? error.message : String(error),
      },
    });
    try {
      await prisma.tender.update({
        where: { id: tenderId },
        data: {
          status: "ERROR",
          notes: `Engine run failed at ${new Date().toISOString()}: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
    } catch {
      // Best effort; preserve the original error.
    }
    throw error;
  }
}
