import { randomUUID } from "crypto";
import { prisma } from "../prisma";
import { logAction } from "../audit";
import { analyzeTender, normalizeStrategicRequirements } from "./analysis";
import { analyzeWithAI, isAIEnabled } from "../ai";
import { buildCompliance } from "./compliance";
import { buildDocumentPlan } from "./documents";
import { buildMatches } from "./matching";
import { applyMainEngineBestAvailableSelection } from "./main-engine-selection-policy";
import { applyAIRematchToMainEngine } from "./main-engine-ai-rematch";
import type { MatchPerspective } from "./ai-multi-perspective-matcher";
import { inferSector } from "./proposal-intelligence";

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
}) {
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

export async function runTenderEngine(tenderId: string, userId: string) {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: { files: { select: { id: true, originalFileName: true, mimeType: true, classification: true, extractedText: true } } },
  });
  if (!tender) throw new Error("Tender not found");

  const company = await prisma.company.findUnique({
    where: { userId },
    include: {
      experts: true,
      projects: true,
      documents: { select: { id: true, category: true, originalFileName: true, extractedText: true } },
      legalRecords: true,
      financialRecords: true,
      complianceRecords: true,
    },
  });
  if (!company) throw new Error("Company profile required before engine run");

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
    let analysis: ReturnType<typeof analyzeTender>;
    let analysisMethod: "AI" | "REGEX_FALLBACK_AI_DISABLED" | "REGEX_FALLBACK_NO_TEXT" | "REGEX_FALLBACK_AI_ERROR" = "REGEX_FALLBACK_AI_DISABLED";
    let analysisFallbackReason: string | null = null;

    if (isAIEnabled()) {
      const tenderText = tender.files
        .map((f) => (f.extractedText ?? "").trim())
        .map((t) => t.replace(/^\[(?:PDF text|OCR text)[^\]]*\]\s*\n+/i, ""))
        .filter((t) => t.length > 100 && !/^\[(?:Scanned PDF|Extraction failed|Image:|Legacy \.doc)/i.test(t))
        .join("\n\n--- NEXT DOCUMENT ---\n\n");

      if (tenderText.length > 500) {
        try {
          const aiResult = await analyzeWithAI(tenderText);
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
          console.error("[engine] AI analysis failed — falling back to regex:", err);
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

    const reviewedExperts = company.experts.filter((expert) => expert.trustLevel === "REVIEWED");
    const reviewedProjects = company.projects.filter((project) => project.trustLevel === "REVIEWED");
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
      aiDraftExperts: aiDraftExpertCount,
      aiDraftProjects: aiDraftProjectCount,
      regexDraftExperts: regexDraftExpertCount,
      regexDraftProjects: regexDraftProjectCount,
      hasUsableExperts: reviewedExperts.length > 0,
      hasUsableProjects: reviewedProjects.length > 0,
      hasBlockingExperts: aiDraftExpertCount + regexDraftExpertCount > 0,
      hasBlockingProjects: aiDraftProjectCount + regexDraftProjectCount > 0,
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
      console.info(`[run-tender-engine] Inferred tender sector: "${inferredSector}" (used for matching instead of tender.category="${tender.category}")`);
    }

    const initialMatching = buildMatches(analysis.requirements, knowledge, sectorForMatching, tender.title);
    let matching = applyMainEngineBestAvailableSelection({
      requirements: analysis.requirements,
      matching: initialMatching,
      expertTrust: new Map(knowledge.experts.map((expert) => [expert.id, expert.trustLevel])),
      projectTrust: new Map(knowledge.projects.map((project) => [project.id, project.trustLevel])),
    });

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

    if (isAIEnabled()) {
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
      if (aiRematch.warning) console.warn("[run-tender-engine] main-engine AI rematch warning:", aiRematch.warning);
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
        console.info(`[run-tender-engine] requirement source extractor: ${bestByReqId.size}/${analysis.requirements.length} requirements matched to a source paragraph.`);
      } catch (eErr) {
        console.warn("[run-tender-engine] requirement source extractor failed:", eErr instanceof Error ? eErr.message : eErr);
      }
    }

    const createdRequirements = analysis.requirements.map((requirement) => ({ id: randomUUID(), requirement }));
    const requirementRows = createdRequirements.map(({ id, requirement }) => ({
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
    }));

    const compliance = buildCompliance(createdRequirements, knowledge, matching);
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

    if (activeGeneratedDocuments.length > 0) {
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
      });
      await prisma.generatedDocument.updateMany({ where: { tenderId, generationStatus: { not: "SUPERSEDED" } }, data: { generationStatus: "SUPERSEDED", validationStatus: "SUPERSEDED", reviewStatus: "SUPERSEDED", reviewNotes: `Superseded by tender engine run ${engineRunId}. Review/comment history preserved on this historical document record.`, updatedAt: new Date() } });
    }

    await prisma.tenderExpertMatch.deleteMany({ where: { tenderId } });
    await prisma.tenderProjectMatch.deleteMany({ where: { tenderId } });
    await prisma.complianceGap.deleteMany({ where: { tenderId } });
    await prisma.complianceMatrix.deleteMany({ where: { tenderId } });
    await prisma.tenderRequirement.deleteMany({ where: { tenderId } });

    for (const batch of chunks(requirementRows, 100)) await prisma.tenderRequirement.createMany({ data: batch });
    const expertMatchRows = matching.expertMatches.map((match) => ({ tenderId, expertId: match.expertId, score: match.score, rationale: match.rationale, isSelected: match.isSelected }));
    for (const batch of chunks(expertMatchRows, 100)) await prisma.tenderExpertMatch.createMany({ data: batch, skipDuplicates: true });
    const projectMatchRows = matching.projectMatches.map((match) => ({ tenderId, projectId: match.projectId, score: match.score, rationale: match.rationale, isSelected: match.isSelected }));
    for (const batch of chunks(projectMatchRows, 100)) await prisma.tenderProjectMatch.createMany({ data: batch, skipDuplicates: true });

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
      console.warn("[run-tender-engine] score breakdown write failed:", sErr instanceof Error ? sErr.message : sErr);
    }

    const matrixRows = compliance.matrices.map((matrix) => ({ tenderId, requirementId: matrix.requirementId, evidenceType: matrix.evidenceType, evidenceSource: matrix.evidenceSource, evidenceReference: matrix.evidenceReference ?? null, supportLevel: matrix.supportStatus, notes: [matrix.evidenceSummary, matrix.notes].filter(Boolean).join(" | ") || null }));
    for (const batch of chunks(matrixRows, 100)) await prisma.complianceMatrix.createMany({ data: batch });

    const gapRows = compliance.gaps.map((gap) => ({ tenderId, requirementId: gap.requirementId ?? null, severity: gap.severity, title: gap.title, description: gap.description, mitigationPlan: gap.mitigationPlan ?? null }));
    if (hasDraftKnowledge) {
      gapRows.push({ tenderId, requirementId: null, severity: "HIGH", title: "Draft company knowledge requires review", description: `The company knowledge base contains ${aiDraftExpertCount} AI_DRAFT expert(s), ${regexDraftExpertCount} REGEX_DRAFT expert(s), ${aiDraftProjectCount} AI_DRAFT project(s), and ${regexDraftProjectCount} REGEX_DRAFT project(s). Draft records are not used as final submission evidence until marked REVIEWED.`, mitigationPlan: "Open Company Knowledge Review, verify source evidence, correct fields, and mark valid expert/project records as REVIEWED before final generation." });
    }
    for (const batch of chunks(gapRows, 100)) await prisma.complianceGap.createMany({ data: batch });

    const documentRows = documentPlan.documents.map((document) => ({ tenderId, name: document.name, documentType: document.documentType, exactFileName: document.exactFileName ?? null, exactOrder: typeof document.exactOrder === "number" ? document.exactOrder : null, contentSummary: document.contentSummary }));
    for (const batch of chunks(documentRows, 100)) await prisma.generatedDocument.createMany({ data: batch });

    await prisma.tender.update({
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
        newStateCounts: { requirements: requirementRows.length, expertMatches: expertMatchRows.length, projectMatches: projectMatchRows.length, complianceRows: matrixRows.length, gaps: gapRows.length, generatedDocuments: documentRows.length, supersededGeneratedDocuments: activeGeneratedDocuments.length },
        readinessScore,
        hardGapCount: hardGaps,
        reviewGapCount: reviewGaps,
        reviewNeeded,
        knowledgeReadiness,
        mainEngineAIRematch,
      },
    });

    return prisma.tender.findUnique({
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
  } catch (error) {
    await writeEngineRunAudit({ userId, tenderId, action: "TENDER_ENGINE_RUN_FAILED", description: `Tender engine run failed for "${tender.title}"`, metadata: { engineRunId, startedAt: startedAt.toISOString(), failedAt: new Date().toISOString(), durationMs: Date.now() - startedAt.getTime(), error: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
}
