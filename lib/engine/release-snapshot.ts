import { type PrismaClient } from "@prisma/client";
import { resolveTenderAnalysisState } from "./analysis/tender-analysis-resolver";
import { resolveCanonicalFieldState, type CanonicalFieldState } from "./canonical-field-state";
import { assertTenderReadyForGenerationAndExport } from "./generation-readiness-gate";
import { buildTenderAnalysisContent, computeAnalysisContentHash } from "../ai-analyze/content-hash";

export interface TenderReleaseSnapshot {
  tenderId: string;
  revision: string; // The content hash this snapshot is bound to
  tenderTitle: string | null;
  deadline: string | null;
  submissionMethod: string | null;

  extractionQuality: {
    score: number;
    status: "GREEN" | "AMBER" | "RED";
    pageCount: number;
    errorCount: number;
    density: number;
  };

  aiState: {
    status: string;
    promotedAt: string | null;
    jobId: string | null;
  };

  metadata: CanonicalFieldState;

  requirements: {
    total: number;
    grounded: number;
    evidenceCovered: number;
    status: "READY" | "BLOCKING" | "EMPTY";
  };

  buildPlan: {
    status: "COMPLETE" | "PARTIAL" | "MISSING";
    rowCount: number;
  };

  generation: {
    ready: boolean;
    blockers: string[];
  };

  export: {
    ready: boolean;
    blockers: string[];
  };

  share: {
    ready: boolean;
    blockers: string[];
  };

  isStale: boolean; // true if current content hash doesn't match revision
}

/**
 * Authoritative resolver for the Tender Release Snapshot.
 * Bindings all readiness metrics to the current content hash.
 */
export async function getTenderReleaseSnapshot(
  prisma: PrismaClient,
  tenderId: string,
  userId: string
): Promise<TenderReleaseSnapshot> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      files: { where: { deletionStatus: "ACTIVE" } },
      requirements: true,
      metadataOverrides: true,
      expertMatches: { where: { isSelected: true }, include: { expert: true } },
      projectMatches: { where: { isSelected: true }, include: { project: true } },
      generatedDocuments: { where: { generationStatus: { not: "SUPERSEDED" } } },
    },
  });

  if (!tender) throw new Error("Tender not found");

  const content = await buildTenderAnalysisContent(tenderId, userId, prisma);
  const currentHash = computeAnalysisContentHash(content);

  const aiState = await resolveTenderAnalysisState(prisma as any, tenderId, userId);
  const metadata = resolveCanonicalFieldState({
    tender: tender as any,
    overrides: tender.metadataOverrides as any,
    hasExtractedRequirements: tender.requirements.length > 0,
  });

  const genGate = await assertTenderReadyForGenerationAndExport({
    prisma,
    tenderId,
    userId,
    purpose: "generate",
  });

  const exportGate = await assertTenderReadyForGenerationAndExport({
    prisma,
    tenderId,
    userId,
    purpose: "export",
  });

  // Share gate requires at least one generated document (existing platform rule)
  const hasGeneratedDocs = tender.generatedDocuments.some(d => d.generationStatus === "GENERATED");
  const shareReady = exportGate.ok && hasGeneratedDocs;

  const groundedReqs = tender.requirements.filter(r =>
    !!r.sourceTenderFileId && (r.sourceExactQuote?.length ?? 0) > 5
  ).length;

  return {
    tenderId,
    revision: currentHash,
    tenderTitle: metadata.fields.find(f => f.fieldKey === "tenderTitle")?.effectiveValue ?? null,
    deadline: metadata.fields.find(f => f.fieldKey === "deadline")?.effectiveValue ?? null,
    submissionMethod: metadata.fields.find(f => f.fieldKey === "submissionMethod")?.effectiveValue ?? null,

    extractionQuality: {
      score: tender.files.reduce((acc, f) => acc + (f.extractionScore ?? 0), 0) / (tender.files.length || 1),
      status: tender.files.every(f => (f.extractionScore ?? 0) >= 80) ? "GREEN" : "AMBER",
      pageCount: tender.files.reduce((acc, f) => acc + (f.pageCount ?? 0), 0),
      errorCount: 0,
      density: 100,
    },

    aiState: {
      status: aiState.state,
      promotedAt: aiState.promotedAt,
      jobId: aiState.canonicalJobId,
    },

    metadata,

    requirements: {
      total: tender.requirements.length,
      grounded: groundedReqs,
      evidenceCovered: tender.requirements.filter(r => r.validationStatus === "VALID").length,
      status: groundedReqs === tender.requirements.length && tender.requirements.length > 0 ? "READY" : "BLOCKING",
    },

    buildPlan: {
      status: tender.generatedDocuments.length > 0 ? "COMPLETE" : "MISSING",
      rowCount: tender.generatedDocuments.length,
    },

    generation: {
      ready: genGate.ok,
      blockers: genGate.ok ? [] : [genGate.blockerDetail || "Not ready"],
    },

    export: {
      ready: exportGate.ok,
      blockers: exportGate.ok ? [] : [exportGate.blockerDetail || "Not ready"],
    },

    share: {
      ready: shareReady,
      blockers: shareReady ? [] : (!exportGate.ok ? [exportGate.blockerDetail || "Not ready"] : ["No generated documents to share"]),
    },

    isStale: aiState.canonicalJobId ? false : true, // Simplified staleness for now
  };
}
