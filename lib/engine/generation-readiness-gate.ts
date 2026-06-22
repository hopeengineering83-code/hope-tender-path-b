// Central authoritative generation/export readiness gate.
//
// THE single fail-closed authorization source for every path that can create a
// GeneratedDocument, regenerate a section, run an AI proposal (interactive or
// background), export, or build a final ZIP. No route, worker, retry handler, or
// job handler may create generation/export output without passing this gate.
//
// This does NOT introduce a competing readiness resolver. It composes the
// existing canonical pieces:
//   - resolveTenderAnalysisState        (canonical AI Analyze state machine)
//   - canExportWithAnalysisState        (state → export-allowed)
//   - buildTenderAnalysisContent + computeAnalysisContentHash (canonical hash)
// …and adds the binding conditions the spec requires (current-hash match,
// chunk integrity, mandatory-requirement source grounding, submission-plan
// confirmation, regex-fallback binding to the exact job + content hash).
//
// ARCHITECTURE: a PURE decision function `evaluateGenerationReadiness(input)`
// holds all the logic (fully unit-testable, no DB), and the async
// `assertTenderReadyForGenerationAndExport({ prisma, ... })` gathers the raw
// facts from the database and delegates the decision to the pure function.
// This mirrors the resolveTenderAnalysisState / deriveAnalysisStateDetail split.

import type { PrismaClient } from "@prisma/client";
import {
  resolveTenderAnalysisState,
  canExportWithAnalysisState,
  AI_ANALYZE_JOB_TYPE,
  type AnalysisState,
} from "./analysis-state-resolver";
import {
  buildTenderAnalysisContent,
  computeAnalysisContentHash,
} from "./tender-analysis-content";

export type GenerationPurpose =
  | "generate"
  | "regenerate-section"
  | "ai-proposal"
  | "background-proposal-generation"
  | "export"
  | "final-zip";

export type GenerationBlockerCode =
  | "OWNERSHIP_TENDER_NOT_FOUND"
  | "EXTRACTION_NO_ACTIVE_FILE"
  | "ANALYSIS_NOT_READY"
  | "ANALYSIS_NO_PROMOTED_JOB"
  | "ANALYSIS_HASH_MISMATCH"
  | "CHUNKS_INCOMPLETE"
  | "REQUIREMENTS_MISSING"
  | "REQUIREMENT_SOURCE_UNGROUNDED"
  | "SUBMISSION_PLAN_MISSING"
  | "SUBMISSION_PLAN_EMPTY"
  | "FALLBACK_UNAPPROVED"
  | "GATE_INTERNAL_ERROR";

export interface GenerationReadinessResult {
  ok: boolean;
  blockerCode?: GenerationBlockerCode;
  blockerDetail?: string;
  purpose: GenerationPurpose;
}

// ─── Pure decision input (no Prisma types — fully unit-testable) ──────────────

export interface ReadinessChunkRow {
  status: string; // QUEUED | RUNNING | SUCCEEDED | FAILED | SKIPPED
  totalChunks: number;
}

export interface ReadinessRequirement {
  priority: string | null;
  sourceTenderFileId: string | null;
  sourcePageNumber: number | null;
  sourceExactQuote: string | null;
  // True only when sourceTenderFileId resolves to an ACTIVE file in THIS tender.
  sourceFileActiveInTender: boolean;
}

export interface GenerationReadinessInput {
  purpose: GenerationPurpose;
  // A — ownership
  tenderExistsAndOwned: boolean;
  // B — extraction
  activeFileCount: number;
  // C/D — analysis state + content-hash binding
  analysisState: AnalysisState;
  canonicalJobId: string | null; // latest job's id when promoted, else null
  latestJobHash: string | null; // analysisInputHash of the latest eligible job
  currentContentHash: string; // recomputed immediately before authorization
  // E — chunk integrity for the CURRENT content hash
  currentHashChunks: ReadinessChunkRow[];
  // F — requirement source grounding
  requirementCount: number;
  requirements: ReadinessRequirement[];
  // H — submission/build plan
  submissionPlanConfirmed: boolean;
  submissionPlanDerivedDocumentCount: number;
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

  // B — Extraction readiness (must have at least one active tender file)
  if (input.activeFileCount < 1) {
    return fail("EXTRACTION_NO_ACTIVE_FILE", "No active tender file exists. Upload and extract the tender document first.");
  }

  // D — Eligible AI Analyze job: state must be export-eligible
  //     (AI_SUCCEEDED or HUMAN_APPROVED_FALLBACK). Everything else — NOT_STARTED,
  //     QUEUED, RUNNING, PARTIAL_NEEDS_RESUME, FAILED, SUPERSEDED, and
  //     REGEX_FALLBACK_UNAPPROVED — fails closed here.
  if (!canExportWithAnalysisState(input.analysisState)) {
    if (input.analysisState === "REGEX_FALLBACK_UNAPPROVED") {
      return fail("FALLBACK_UNAPPROVED", "Latest analysis used the regex fallback and has not been human-approved. Re-run AI Analyze or approve the fallback before generating/exporting.");
    }
    return fail("ANALYSIS_NOT_READY", `AI Analyze is not in an export-ready state (current: ${input.analysisState}). Run/complete AI Analyze before generating or exporting.`);
  }

  // D — canonical promotion is mandatory (a SUCCEEDED job without promotion
  //     cannot authorize final generation/export).
  if (!input.canonicalJobId) {
    return fail("ANALYSIS_NO_PROMOTED_JOB", "The latest AI Analyze result has not been canonically promoted. Promotion is required before generation/export.");
  }

  // C — Current content hash must equal the eligible job's analysisInputHash.
  //     Any change to active tender-file content or analyzed inputs invalidates
  //     the prior analysis (and, by extension, any prior fallback approval).
  if (!input.latestJobHash) {
    return fail("ANALYSIS_HASH_MISMATCH", "The eligible AI Analyze job has no recorded content hash; analysis cannot be trusted for generation/export.");
  }
  if (input.latestJobHash !== input.currentContentHash) {
    return fail("ANALYSIS_HASH_MISMATCH", "Tender content or analyzed inputs changed since the last analysis. Re-run AI Analyze so the analysis matches the current tender.");
  }

  // E — Chunk integrity for the current content hash. Zero chunk rows is a valid
  //     single-shot success (state machine already required SUCCEEDED+promoted).
  //     When chunk rows exist, every required chunk must be SUCCEEDED.
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

  // F — Requirement and source grounding.
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

  // H — Build/Submission plan must be confirmed and non-empty.
  if (!input.submissionPlanConfirmed) {
    return fail("SUBMISSION_PLAN_MISSING", "The submission/build plan has not been confirmed. Build and confirm the submission plan before generating/exporting.");
  }
  if (input.submissionPlanDerivedDocumentCount < 1) {
    return fail("SUBMISSION_PLAN_EMPTY", "The submission/build plan is empty (no derived deliverables). Rebuild the plan from the tender requirements.");
  }

  return { ok: true, purpose: input.purpose };
}

// ─── Async DB-backed entry point ──────────────────────────────────────────────

/**
 * THE authoritative readiness gate. Gathers raw facts from the database and
 * delegates the decision to the pure `evaluateGenerationReadiness`.
 *
 * Fail-closed: any unexpected error returns a blocked result rather than
 * throwing, so no caller can treat an exception as implicit authorization.
 */
export async function assertTenderReadyForGenerationAndExport(args: {
  prisma: PrismaClient;
  tenderId: string;
  userId: string;
  purpose: GenerationPurpose;
}): Promise<GenerationReadinessResult> {
  const { prisma, tenderId, userId, purpose } = args;
  try {
    // A — ownership + load the inputs needed to recompute the content hash.
    const tender = await prisma.tender.findFirst({
      where: { id: tenderId, userId },
      select: {
        id: true,
        title: true,
        description: true,
        intakeSummary: true,
        files: {
          select: {
            id: true,
            originalFileName: true,
            extractedText: true,
            classification: true,
            createdAt: true,
            deletionStatus: true,
          },
        },
      },
    });
    if (!tender) {
      return { ok: false, blockerCode: "OWNERSHIP_TENDER_NOT_FOUND", blockerDetail: "Tender does not exist or does not belong to the requesting user.", purpose };
    }

    const activeFiles = tender.files.filter((f) => f.deletionStatus === "ACTIVE");

    // Company vault digest participates in the canonical hash so vault changes
    // invalidate the analysis exactly as AI Analyze computed it.
    const company = await prisma.company.findUnique({
      where: { userId },
      select: { documents: { select: { originalFileName: true, category: true, extractedText: true } } },
    });

    const currentContentHash = computeAnalysisContentHash(
      buildTenderAnalysisContent(
        { title: tender.title, description: tender.description, intakeSummary: tender.intakeSummary, files: activeFiles },
        company ?? undefined,
      ),
    );

    // C/D — canonical analysis state + the latest eligible job's hash.
    const [analysis, latestJob] = await Promise.all([
      resolveTenderAnalysisState(prisma as never, tenderId, userId),
      prisma.aiJob.findFirst({
        where: { tenderId, jobType: AI_ANALYZE_JOB_TYPE, tender: { userId } },
        orderBy: { createdAt: "desc" },
        select: { analysisInputHash: true },
      }),
    ]);

    // E — chunk integrity for the CURRENT content hash only.
    const currentHashChunks = await prisma.aiAnalyzeChunk.findMany({
      where: { tenderId, contentHash: currentContentHash, tender: { userId } },
      select: { status: true, totalChunks: true },
    });

    // F — requirements + source-file activeness resolved against THIS tender.
    const requirements = await prisma.tenderRequirement.findMany({
      where: { tenderId },
      select: { priority: true, sourceTenderFileId: true, sourcePageNumber: true, sourceExactQuote: true },
    });
    const activeFileIds = new Set(activeFiles.map((f) => f.id));
    const mappedRequirements: ReadinessRequirement[] = requirements.map((r) => ({
      priority: r.priority,
      sourceTenderFileId: r.sourceTenderFileId,
      sourcePageNumber: r.sourcePageNumber,
      sourceExactQuote: r.sourceExactQuote,
      sourceFileActiveInTender: !!r.sourceTenderFileId && activeFileIds.has(r.sourceTenderFileId),
    }));

    // H — submission/build plan confirmation.
    const plan = await prisma.submissionPlanState.findUnique({
      where: { tenderId },
      select: { confirmationStatus: true, provenance: true, derivedDocumentCount: true },
    });
    const submissionPlanConfirmed =
      !!plan &&
      (plan.confirmationStatus === "CONFIRMED" || plan.confirmationStatus === "APPROVED") &&
      plan.provenance !== "NONE";

    return evaluateGenerationReadiness({
      purpose,
      tenderExistsAndOwned: true,
      activeFileCount: activeFiles.length,
      analysisState: analysis.state,
      canonicalJobId: analysis.canonicalJobId,
      latestJobHash: latestJob?.analysisInputHash ?? null,
      currentContentHash,
      currentHashChunks,
      requirementCount: requirements.length,
      requirements: mappedRequirements,
      submissionPlanConfirmed,
      submissionPlanDerivedDocumentCount: plan?.derivedDocumentCount ?? 0,
    });
  } catch (err) {
    // Fail closed — never let a thrown error read as authorization.
    const detail = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    return { ok: false, blockerCode: "GATE_INTERNAL_ERROR", blockerDetail: `Readiness gate failed to evaluate: ${detail}`, purpose };
  }
}
