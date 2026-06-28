// Central authoritative generation/export readiness gate.
//
// THE single fail-closed authorization source for every path that can create a
// GeneratedDocument, regenerate a section, run an AI proposal (interactive or
// background), export, or build a final ZIP. No route, worker, retry handler, or
// job handler may create generation/export output without passing this gate.

import type { PrismaClient } from "@prisma/client";
import {
  resolveTenderAnalysisState,
  AI_ANALYZE_JOB_TYPE,
  type AnalysisState,
} from "./analysis-state-resolver";
import {
  buildTenderAnalysisContent,
  computeAnalysisContentHash,
} from "../ai-analyze/content-hash";
import { isExtractionCorrupted } from "./extraction-quality-gate";
import { hasBoundFallbackApproval, hasActiveExtractionOverride } from "./readiness-overrides";
import { resolveCanonicalFieldState } from "./canonical-field-state";

export type GenerationPurpose =
  | "generate"
  | "regenerate-section"
  | "ai-proposal"
  | "ai-proposal-persist"
  | "background-proposal-generation"
  | "export"
  | "final-zip"
  | "regenerate-cvs"
  | "generate-missing-plan-files";

export type GenerationBlockerCode =
  | "OWNERSHIP_TENDER_NOT_FOUND"
  | "EXTRACTION_NO_ACTIVE_FILE"
  | "EXTRACTION_CORRUPTED"
  | "EXTRACTION_WEAK_NO_OVERRIDE"
  | "ANALYSIS_NOT_READY"
  | "ANALYSIS_NO_PROMOTED_JOB"
  | "ANALYSIS_HASH_MISMATCH"
  | "FALLBACK_UNAPPROVED"
  | "CHUNKS_INCOMPLETE"
  | "REQUIREMENTS_MISSING"
  | "REQUIREMENT_SOURCE_UNGROUNDED"
  | "SUBMISSION_PLAN_MISSING"
  | "METADATA_CRITICAL_BLOCKED"
  | "VAULT_EVIDENCE_INCOMPLETE"
  | "GATE_INTERNAL_ERROR";

export interface GenerationReadinessResult {
  ok: boolean;
  blockerCode?: GenerationBlockerCode;
  blockerDetail?: string;
  purpose: GenerationPurpose;
}

// ─── Pure decision input (no Prisma types — fully unit-testable) ──────────────

export interface ReadinessExtractionFile {
  fileId: string;
  corrupted: boolean;
  weak: boolean;
  hasOverride: boolean;
}

export interface ReadinessChunkRow {
  status: string;
  totalChunks: number;
}

export interface ReadinessRequirement {
  priority: string | null;
  sourceTenderFileId: string | null;
  sourcePageNumber: number | null;
  sourceExactQuote: string | null;
  sourceFileActiveInTender: boolean;
}

export interface GenerationReadinessInput {
  purpose: GenerationPurpose;
  tenderExistsAndOwned: boolean;
  activeFileCount: number;
  extractionFiles: ReadinessExtractionFile[];
  analysisState: AnalysisState;
  canonicalJobId: string | null;
  latestJobHash: string | null;
  currentContentHash: string;
  fallbackApprovalBound: boolean;
  currentHashChunks: ReadinessChunkRow[];
  requirementCount: number;
  requirements: ReadinessRequirement[];
  submissionPlanDocumentCount: number;
  metadataBlocked: boolean;
  metadataBlockerReason: string | null;
  reviewedSelectedExperts: number;
  totalSelectedExperts: number;
  reviewedSelectedProjects: number;
  totalSelectedProjects: number;
  isLegacyAnalyzed?: boolean;
}

const MIN_MEANINGFUL_QUOTE_CHARS = 10;

/**
 * PURE readiness decision. Fail-closed: returns ok only when every applicable
 * condition passes. Returns on the FIRST failing condition with a structured
 * blocker code + human-readable detail.
 */
export function evaluateGenerationReadiness(
  input: GenerationReadinessInput,
): GenerationReadinessResult {
  const fail = (
    blockerCode: GenerationBlockerCode,
    blockerDetail: string,
  ): GenerationReadinessResult => ({ ok: false, blockerCode, blockerDetail, purpose: input.purpose });

  // A — Ownership
  if (!input.tenderExistsAndOwned) {
    return fail("OWNERSHIP_TENDER_NOT_FOUND", "Tender does not exist or does not belong to the requesting user.");
  }

  // B — Extraction readiness.
  if (input.activeFileCount < 1) {
    return fail("EXTRACTION_NO_ACTIVE_FILE", "No active tender file exists. Upload and extract the tender document first.");
  }
  for (const file of input.extractionFiles) {
    if (file.corrupted) {
      return fail("EXTRACTION_CORRUPTED", "At least one tender file has corrupted extraction. Re-upload a clearer document or run OCR — corrupted extraction can never be overridden.");
    }
    if (file.weak && !file.hasOverride) {
      return fail("EXTRACTION_WEAK_NO_OVERRIDE", "At least one tender file has weak extraction and no human override on record. Re-extract (run OCR) or record an explicit extraction-quality override before generating/exporting.");
    }
  }

  // D — Eligible AI Analyze job (Rule 4)
  // Only AI_SUCCEEDED is allowed. HUMAN_APPROVED_FALLBACK, regex fallback, legacy,
  // and partial analysis are all now BLOCKED.
  if (input.analysisState !== "AI_SUCCEEDED") {
    if (input.analysisState === "HUMAN_APPROVED_FALLBACK" || input.analysisState === "REGEX_FALLBACK_UNAPPROVED") {
      return fail("FALLBACK_UNAPPROVED", "Regex fallback analysis is no longer permitted for generation or export. Re-run AI Analyze successfully to proceed.");
    }
    return fail("ANALYSIS_NOT_READY", `AI Analyze is not in a success state (current: ${input.analysisState}). Run/complete AI Analyze successfully before generating or exporting.`);
  }

  // D — canonical promotion is mandatory.
  // Rule 4: unpromoted AI jobs and legacy-notes analysis are blocked.
  if (!input.canonicalJobId) {
    return fail("ANALYSIS_NO_PROMOTED_JOB", "The latest AI Analyze result has not been canonically promoted. Promotion is required before generation/export.");
  }

  // C — Content Hash Binding
  // Rule 4: stale extraction or stale content hash is blocked.
  if (!input.latestJobHash) {
    return fail("ANALYSIS_HASH_MISMATCH", "The eligible AI Analyze job has no recorded content hash; analysis cannot be trusted for generation/export.");
  }
  if (input.latestJobHash !== input.currentContentHash) {
    return fail("ANALYSIS_HASH_MISMATCH", "Tender content or analyzed inputs changed since the last analysis. Re-run AI Analyze so the analysis matches the current tender.");
  }

  // E — Chunk integrity
  if (input.currentHashChunks.length > 0) {
    const expected = input.currentHashChunks.reduce((m, c) => Math.max(m, c.totalChunks || 0), 0);
    const succeeded = input.currentHashChunks.filter((c) => c.status === "SUCCEEDED").length;
    const hasBadChunk = input.currentHashChunks.some(
      (c) => c.status !== "SUCCEEDED" && c.status !== "SKIPPED",
    );
    if (hasBadChunk || (expected > 0 && succeeded < expected) || succeeded < input.currentHashChunks.length) {
      return fail("CHUNKS_INCOMPLETE", `AI Analyze chunks are incomplete for the current tender content (${succeeded}/${expected || input.currentHashChunks.length} succeeded). Resume or re-run AI Analyze.`);
    }
  }

  // G — Metadata Truth (Rule 3)
  if (input.metadataBlocked) {
    return fail("METADATA_CRITICAL_BLOCKED", input.metadataBlockerReason || "Critical metadata fields are missing or ungrounded. Source evidence is required for title, deadline, and submission method.");
  }

  // F — Requirement and source grounding (Rule 5)
  if (input.requirementCount < 1) {
    return fail("REQUIREMENTS_MISSING", "No tender requirements have been extracted. Run AI Analyze or add requirements before generating/exporting.");
  }
  const mandatory = input.requirements.filter((r) => (r.priority ?? "").toUpperCase() === "MANDATORY");
  for (const r of mandatory) {
    const quote = (r.sourceExactQuote ?? "").trim();
    const grounded =
      !!r.sourceTenderFileId &&
      r.sourceFileActiveInTender &&
      typeof r.sourcePageNumber === "number" &&
      r.sourcePageNumber >= 1 &&
      quote.length >= MIN_MEANINGFUL_QUOTE_CHARS;
    if (!grounded) {
      return fail("REQUIREMENT_SOURCE_UNGROUNDED", "At least one mandatory requirement is missing a valid source reference (active source file, page number, and a meaningful verbatim quote). Re-run AI Analyze to ground requirements.");
    }
  }

  // J — Vault Evidence (Rule 7)
  if (input.totalSelectedExperts > 0 && input.reviewedSelectedExperts < input.totalSelectedExperts) {
    return fail("VAULT_EVIDENCE_INCOMPLETE", "At least one selected expert is not yet REVIEWED. Review and link rationale/evidence for all selected experts.");
  }
  if (input.totalSelectedProjects > 0 && input.reviewedSelectedProjects < input.totalSelectedProjects) {
    return fail("VAULT_EVIDENCE_INCOMPLETE", "At least one selected project is not yet REVIEWED. Review and link rationale/evidence for all selected projects.");
  }

  // H — Build Plan (Rule 6)
  if (input.submissionPlanDocumentCount < 1) {
    return fail("SUBMISSION_PLAN_MISSING", "No submission/build plan exists. Build and confirm the submission plan before generating/exporting.");
  }

  return { ok: true, purpose: input.purpose };
}

/**
 * Resolve the (latest AI_ANALYZE job id, current content hash) binding for a
 * tender.
 */
export async function resolveCurrentAnalysisBinding(
  prisma: PrismaClient,
  tenderId: string,
  userId: string,
): Promise<{ jobId: string | null; contentHash: string | null }> {
  const content = await buildTenderAnalysisContent(tenderId, userId, prisma).catch(() => null);
  if (!content) return { jobId: null, contentHash: null };
  const currentContentHash = computeAnalysisContentHash(content);

  const latestJob = await prisma.aiJob.findFirst({
    where: { tenderId, jobType: AI_ANALYZE_JOB_TYPE, tender: { userId } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return { jobId: latestJob?.id ?? null, contentHash: currentContentHash };
}

// ─── Async DB-backed entry point ──────────────────────────────────────────────

const WEAK_EXTRACTION_SCORE_THRESHOLD = 70;

export async function assertTenderReadyForGenerationAndExport(args: {
  prisma: PrismaClient;
  tenderId: string;
  userId: string;
  purpose: GenerationPurpose;
}): Promise<GenerationReadinessResult> {
  const { prisma, tenderId, userId, purpose } = args;
  try {
    const tender = await prisma.tender.findFirst({
      where: { id: tenderId, userId },
      include: {
        files: true,
        requirements: true,
        metadataOverrides: true,
        expertMatches: { include: { expert: true } },
        projectMatches: { include: { project: true } },
      }
    });
    if (!tender) {
      return { ok: false, blockerCode: "OWNERSHIP_TENDER_NOT_FOUND", blockerDetail: "Tender does not exist or does not belong to the requesting user.", purpose };
    }

    const activeFiles = tender.files.filter((f) => f.deletionStatus === "ACTIVE");

    const extractionFiles = await Promise.all(
      activeFiles.map(async (f) => {
        const corrupted = isExtractionCorrupted(f.extractedText || "");
        const score = f.extractionScore ?? 0;
        const weak = !corrupted && score < WEAK_EXTRACTION_SCORE_THRESHOLD;
        const hasOverride = weak ? await hasActiveExtractionOverride(prisma, { tenderId, tenderFileId: f.id }) : false;
        return { fileId: f.id, corrupted, weak, hasOverride };
      }),
    );

    const { contentHash: currentContentHash } = await resolveCurrentAnalysisBinding(prisma, tenderId, userId);

    const [analysis, latestJob] = await Promise.all([
      resolveTenderAnalysisState(prisma as any, tenderId, userId),
      prisma.aiJob.findFirst({
        where: { tenderId, jobType: AI_ANALYZE_JOB_TYPE, tender: { userId } },
        orderBy: { createdAt: "desc" },
        select: { analysisInputHash: true },
      }),
    ]);

    const fallbackApprovalBound =
      analysis.state === "HUMAN_APPROVED_FALLBACK" && analysis.canonicalJobId
        ? await hasBoundFallbackApproval(prisma, { tenderId, jobId: analysis.canonicalJobId, contentHash: currentContentHash || "" })
        : false;

    const currentHashChunks = currentContentHash ? await prisma.aiAnalyzeChunk.findMany({
      where: { tenderId, contentHash: currentContentHash },
      select: { status: true, totalChunks: true },
    }) : [];

    const activeFileIds = new Set(activeFiles.map((f) => f.id));
    const mappedRequirements: ReadinessRequirement[] = tender.requirements.map((r) => ({
      priority: r.priority,
      sourceTenderFileId: r.sourceTenderFileId,
      sourcePageNumber: r.sourcePageNumber,
      sourceExactQuote: r.sourceExactQuote,
      sourceFileActiveInTender: !!r.sourceTenderFileId && activeFileIds.has(r.sourceTenderFileId),
    }));

    // Metadata Truth Rule Enforcement
    const metadataState = resolveCanonicalFieldState({
      tender: tender as any,
      overrides: tender.metadataOverrides as any,
      hasExtractedRequirements: tender.requirements.length > 0,
    });

    const submissionPlanDocumentCount = await prisma.generatedDocument.count({
      where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
    });

    const selectedExperts = tender.expertMatches.filter(m => m.isSelected);
    const selectedProjects = tender.projectMatches.filter(m => m.isSelected);

    return evaluateGenerationReadiness({
      purpose,
      tenderExistsAndOwned: true,
      activeFileCount: activeFiles.length,
      extractionFiles,
      analysisState: analysis.state,
      canonicalJobId: analysis.canonicalJobId,
      latestJobHash: latestJob?.analysisInputHash ?? null,
      currentContentHash: currentContentHash || "",
      fallbackApprovalBound,
      currentHashChunks,
      requirementCount: tender.requirements.length,
      requirements: mappedRequirements,
      submissionPlanDocumentCount,
      metadataBlocked: metadataState.hasGenerationBlocker,
      metadataBlockerReason: metadataState.fields.find(f => f.blockerReason)?.blockerReason || null,
      reviewedSelectedExperts: selectedExperts.filter(m => m.expert?.trustLevel === "REVIEWED").length,
      totalSelectedExperts: selectedExperts.length,
      reviewedSelectedProjects: selectedProjects.filter(m => m.project?.trustLevel === "REVIEWED").length,
      totalSelectedProjects: selectedProjects.length,
      isLegacyAnalyzed: !analysis.canonicalJobId && tender.requirements.length > 0,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    return { ok: false, blockerCode: "GATE_INTERNAL_ERROR", blockerDetail: `Readiness gate failed to evaluate: ${detail}`, purpose };
  }
}
