import { PrismaClient } from "@prisma/client";
import { resolveTenderAnalysisState, type TenderAnalysisStateDetail } from "./analysis-state-resolver";
import { resolveCanonicalFieldState, type CanonicalFieldStateResult } from "./canonical-field-state";
import { isExtractionCorrupted } from "./extraction-quality-gate";
import { buildTenderAnalysisContent, computeAnalysisContentHash } from "../ai-analyze/content-hash";
import { assertTenderReadyForGenerationAndExport } from "./generation-readiness-gate";
import { computeCanonicalModuleStates, buildCanonicalModulePayload, type CanonicalModuleStatePayload } from "./canonical-readiness-state";
import { computeTenderReadinessState } from "../tender-readiness-state";
import { detectAnalysisSource } from "./analysis-source";

/**
 * Authoritative Tender Release Snapshot
 *
 * ONE revisioned payload containing the complete readiness state of a tender.
 * All UI panels and API gates must consume this snapshot to ensure consistency.
 */

export type ReleaseSnapshot = {
  tenderId: string;
  userId: string;
  revision: string; // The content hash this snapshot is bound to
  calculatedAt: string;

  // 1. Extraction State
  extraction: {
    overallSeverity: "GOOD" | "WARNING" | "POOR" | "UNSAFE";
    files: Array<{
      fileId: string;
      fileName: string;
      score: number;
      corrupted: boolean;
      weak: boolean;
      hasOverride: boolean;
    }>;
  };

  // 2. AI Analyze State
  analysis: TenderAnalysisStateDetail;

  // 3. Metadata State
  metadata: CanonicalFieldStateResult;

  // 4. Requirement Grounding & Evidence
  requirements: {
    total: number;
    mandatory: number;
    traced: number; // Grounded in source
    evidenceCovered: number; // Linked in compliance matrix
  };

  // 5. Build Plan State
  buildPlan: {
    state: "NONE" | "DERIVED_DRAFT" | "USER_REVIEW_REQUIRED" | "CANONICAL_APPROVED";
    plannedDocumentCount: number;
    generatedDocumentCount: number;
    isConfirmed: boolean;
  };

  // 6. Vault Matches
  vaultMatches: {
    reviewedSelectedExperts: number;
    reviewedSelectedProjects: number;
    totalSelectedExperts: number;
    totalSelectedProjects: number;
    warnings: string[];
  };

  // 7. Release Eligibility (Authoritative Gates)
  eligibility: {
    readyForGeneration: boolean;
    readyForExport: boolean;
    readyForFinalZip: boolean;
    blockers: Array<{ code: string; message: string }>;
    warnings: Array<{ code: string; message: string }>;
  };

  // 8. Backward Compatibility: Canonical Module States
  modules: CanonicalModuleStatePayload;
};

/**
 * Resolves the complete release snapshot for a tender.
 * This is the SINGLE source of truth for all readiness UI and gates.
 */
export async function getTenderReleaseSnapshot(
  prisma: PrismaClient,
  tenderId: string,
  userId: string
): Promise<ReleaseSnapshot> {
  const [tender, company] = await Promise.all([
    prisma.tender.findFirst({
      where: { id: tenderId, userId },
      include: {
        files: { where: { deletionStatus: "ACTIVE" } },
        requirements: true,
        metadataOverrides: true,
        expertMatches: { include: { expert: true } },
        projectMatches: { include: { project: true } },
        submissionPlanState: true,
        extractionQualityOverrides: true,
        generatedDocuments: { where: { generationStatus: { not: "SUPERSEDED" } } }
      }
    }),
    prisma.company.findUnique({
      where: { userId }
    })
  ]);

  if (!tender) throw new Error("Tender not found");

  // A. Compute Revision (Content Hash)
  const content = await buildTenderAnalysisContent(tenderId, userId, prisma);
  const revision = computeAnalysisContentHash(content);

  // B. Extraction Quality
  const fileStates = tender.files.map(f => {
    const corrupted = isExtractionCorrupted(f.extractedText || "");
    const override = (tender.extractionQualityOverrides as any[]).find(o => o.tenderFileId === f.id);
    const score = f.extractionScore ?? 0;
    return {
      fileId: f.id,
      fileName: f.originalFileName,
      score,
      corrupted,
      weak: score < 70,
      hasOverride: !!override,
    };
  });
  const overallExtractionSeverity = fileStates.some(f => f.corrupted) ? "UNSAFE" : fileStates.some(f => f.weak && !f.hasOverride) ? "POOR" : fileStates.some(f => f.weak) ? "WARNING" : "GOOD";

  // C. AI Analyze State
  const analysis = await resolveTenderAnalysisState(prisma as any, tenderId, userId);

  // D. Metadata State
  const metadata = resolveCanonicalFieldState({
    tender: tender as any,
    overrides: tender.metadataOverrides as any,
    hasExtractedRequirements: tender.requirements.length > 0,
  });

  // E. Requirement Stats
  const mandatory = tender.requirements.filter(r => (r.priority ?? "").toUpperCase() === "MANDATORY");
  const traced = mandatory.filter(r => r.sourceTenderFileId && r.sourcePageNumber && r.sourcePageNumber > 0 && (r.sourceExactQuote?.length ?? 0) > 5).length;

  const complianceCount = await prisma.complianceMatrix.count({
    where: { tenderId, requirementId: { in: mandatory.map(r => r.id) } }
  });

  // F. Build Plan
  const plannedCount = tender.generatedDocuments.filter(d => d.generationStatus === "PLANNED").length;
  const generatedCount = tender.generatedDocuments.filter(d => d.generationStatus === "GENERATED").length;

  // G. Vault Matches
  const selectedExperts = tender.expertMatches.filter(m => m.isSelected);
  const selectedProjects = tender.projectMatches.filter(m => m.isSelected);
  const reviewedSelectedExperts = selectedExperts.filter(m => m.expert?.trustLevel === "REVIEWED").length;
  const reviewedSelectedProjects = selectedProjects.filter(m => m.project?.trustLevel === "REVIEWED").length;

  // H. Eligibility (Authoritative Gates)
  const genResult = await assertTenderReadyForGenerationAndExport({ prisma, tenderId, userId, purpose: "generate" });
  const exportResult = await assertTenderReadyForGenerationAndExport({ prisma, tenderId, userId, purpose: "export" });
  const zipResult = await assertTenderReadyForGenerationAndExport({ prisma, tenderId, userId, purpose: "final-zip" });

  const blockers: Array<{ code: string; message: string }> = [];
  if (!genResult.ok) blockers.push({ code: genResult.blockerCode!, message: genResult.blockerDetail! });
  if (exportResult.blockerCode && exportResult.blockerCode !== genResult.blockerCode) {
    blockers.push({ code: exportResult.blockerCode, message: exportResult.blockerDetail! });
  }
  if (zipResult.blockerCode && zipResult.blockerCode !== genResult.blockerCode && zipResult.blockerCode !== exportResult.blockerCode) {
    blockers.push({ code: zipResult.blockerCode, message: zipResult.blockerDetail! });
  }

  const uniqueBlockers = Array.from(new Map(blockers.map(b => [b.code, b])).values());

  // I. Module States (Legacy Compatibility)
  const analysisSource = detectAnalysisSource(tender);
  const readinessBase = computeTenderReadinessState({
    analysisExtractionStatus: tender.analysisExtractionStatus,
    analysisSource,
    analysisSeverity: overallExtractionSeverity as any,
    title: tender.title,
    clientName: tender.clientName,
    procuringEntityName: tender.procuringEntityName,
    reference: tender.reference,
    metadataContaminated: tender.metadataContaminated,
    requirements: tender.requirements,
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    generatedDocuments: tender.generatedDocuments as any,
  });

  const moduleStates = computeCanonicalModuleStates({
    ...readinessBase,
    hasAnalysis: Boolean(tender.analysisSummary),
    hasRequirements: tender.requirements.length > 0,
    hasDocuments: tender.generatedDocuments.length > 0,
    generationServerReady: genResult.ok,
    exportAllowed: exportResult.ok,
  });

  const modules = buildCanonicalModulePayload(moduleStates, {
    blockers: uniqueBlockers.map(b => b.code),
    warnings: [],
    currentAnalysisHash: revision,
  });

  return {
    tenderId,
    userId,
    revision,
    calculatedAt: new Date().toISOString(),
    extraction: {
      overallSeverity: overallExtractionSeverity as any,
      files: fileStates,
    },
    analysis,
    metadata,
    requirements: {
      total: tender.requirements.length,
      mandatory: mandatory.length,
      traced,
      evidenceCovered: complianceCount,
    },
    buildPlan: {
      state: (tender.submissionPlanState?.provenance as any) || "NONE",
      plannedDocumentCount: plannedCount,
      generatedDocumentCount: generatedCount,
      isConfirmed: !!tender.submissionPlanState?.confirmedAt,
    },
    vaultMatches: {
      reviewedSelectedExperts,
      reviewedSelectedProjects,
      totalSelectedExperts: selectedExperts.length,
      totalSelectedProjects: selectedProjects.length,
      warnings: [],
    },
    eligibility: {
      readyForGeneration: genResult.ok,
      readyForExport: exportResult.ok,
      readyForFinalZip: zipResult.ok,
      blockers: uniqueBlockers,
      warnings: [],
    },
    modules,
  };
}
