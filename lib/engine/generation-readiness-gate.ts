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
//   - assessExtractionQuality           (corrupted/weak extraction)
//   - hasValidSubmissionPlan            (real submission-plan signal)
// …and adds the binding conditions the spec requires: current-content-hash
// match, chunk integrity, mandatory-requirement source grounding, weak-
// extraction override (ExtractionQualityOverride), and regex-fallback approval
// bound to the exact job + content hash (FallbackApprovalRecord).
//
// ARCHITECTURE: a PURE decision function `evaluateGenerationReadiness(input)`
// holds all the logic (fully unit-testable, no DB), and the async
// `assertTenderReadyForGenerationAndExport({ prisma, ... })` gathers the raw
// facts from the database and delegates the decision to the pure function.

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
import { assessExtractionQuality } from "../extraction-quality";
import { hasBoundFallbackApproval, hasActiveExtractionOverride } from "./readiness-overrides";
import { resolveCanonicalFieldState } from "./canonical-field-state";

// Local type stubs for Prisma query result shapes — avoids implicit `any` when
// @prisma/client types are not yet generated in the current environment.
type _TenderFileRow = {
  id: string;
  originalFileName: string;
  extractedText: string | null;
  extractionScore: number | null;
  classification: string | null;
  createdAt: Date;
  deletionStatus: string | null;
};
type _RequirementRow = {
  priority: string | null;
  sourceTenderFileId: string | null;
  sourcePageNumber: number | null;
  sourceExactQuote: string | null;
};
type _MetadataOverrideRow = {
  field: string;
  fieldState: string;
  overrideValue: string | null;
  reason: string | null;
  overriddenBy: string | null;
  createdAt: Date;
};

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
  | "FALLBACK_NOT_ALLOWED"
  | "LEGACY_ANALYSIS_BLOCKED"
  | "CHUNKS_INCOMPLETE"
  | "REQUIREMENTS_MISSING"
  | "REQUIREMENT_SOURCE_UNGROUNDED"
  | "METADATA_CRITICAL_FIELD_INVALID"
  | "SUBMISSION_PLAN_MISSING"
  | "NO_EXPORT_READY_DOCUMENTS"
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
  corrupted: boolean; // hard block, never overridable
  weak: boolean; // weak but not corrupted
  hasOverride: boolean; // valid ExtractionQualityOverride exists for this file
}

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
  extractionFiles: ReadinessExtractionFile[];
  // C/D — analysis state + content-hash binding
  analysisState: AnalysisState;
  canonicalJobId: string | null; // latest job's id when promoted, else null
  latestJobHash: string | null; // analysisInputHash of the latest eligible job
  currentContentHash: string; // recomputed immediately before authorization
  // I — regex-fallback approval (only consulted for legacy-compatible states; HUMAN_APPROVED_FALLBACK is now blocked)
  fallbackApprovalBound: boolean;
  // E — chunk integrity for the CURRENT content hash
  currentHashChunks: ReadinessChunkRow[];
  // F — requirement source grounding
  requirementCount: number;
  requirements: ReadinessRequirement[];
  // G — critical metadata: no critical field may be invalid, placeholder, contaminated,
  //     or a manual candidate without active tender-source evidence
  criticalMetadataOk: boolean;
  // H — Build/Submission plan for GENERATION: a valid virtual Build Plan satisfies
  //     this prerequisite. This is true when the submission plan has been built
  //     (virtual or real) and identifies at least one required file.
  //     PLANNED, SUPERSEDED, virtual, or legacy planned rows do NOT count as
  //     generated/export-ready — they only satisfy the plan prerequisite.
  hasValidVirtualSubmissionPlan: boolean;
  // I — EXPORT/FINAL-ZIP readiness: count of real current generated files with
  //     content, validation, review, and exact-plan reconciliation. Only these
  //     rows satisfy export and final-ZIP gates. PLANNED/SUPERSEDED/virtual/
  //     missing-content/unvalidated/unreviewed rows never count here.
  exportReadyDocumentCount: number;
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

  // D — Eligible AI Analyze job: ONLY AI_SUCCEEDED is accepted.
  //     HUMAN_APPROVED_FALLBACK is explicitly blocked — a regex fallback is not
  //     a sufficient basis for generating or exporting tender documents. Re-run
  //     AI Analyze to obtain a promoted AI_SUCCEEDED result.
  //     Everything else (NOT_STARTED, QUEUED, RUNNING, PARTIAL_NEEDS_RESUME,
  //     FAILED, SUPERSEDED, REGEX_FALLBACK_UNAPPROVED) also fails closed.
  if (input.analysisState === "HUMAN_APPROVED_FALLBACK") {
    return fail("FALLBACK_NOT_ALLOWED", "Analysis used a regex fallback. Regex-fallback and human-approved-fallback results cannot authorize generation or export. Re-run AI Analyze to obtain a promoted AI_SUCCEEDED result.");
  }
  if (!canExportWithAnalysisState(input.analysisState)) {
    if (input.analysisState === "REGEX_FALLBACK_UNAPPROVED") {
      return fail("FALLBACK_UNAPPROVED", "Latest analysis used the regex fallback and has not been approved. Re-run AI Analyze before generating or exporting.");
    }
    return fail("ANALYSIS_NOT_READY", `AI Analyze is not in an export-ready state (current: ${input.analysisState}). Run/complete AI Analyze before generating or exporting.`);
  }

  // D — canonical promotion is mandatory. Legacy-analyzed tenders (no AI job
  //     system, analyzed from notes) must re-run AI Analyze in the current
  //     system to obtain a promoted result before generating or exporting.
  if (!input.canonicalJobId) {
    return fail("LEGACY_ANALYSIS_BLOCKED", "No promoted AI Analyze job found. Tenders analyzed before the current AI job system must re-run AI Analyze before generating or exporting.");
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

  // G — Critical metadata: every critical field (clientName, title, deadline,
  //     submissionMethod, submissionEndpoint, requiredDocuments) must be valid,
  //     non-placeholder, non-contaminated, and either source-grounded or
  //     source-confirmed. Manual candidates (USER_EDITED) and ungrounded
  //     USER_CONFIRMED values are not sufficient for critical fields.
  if (!input.criticalMetadataOk) {
    return fail("METADATA_CRITICAL_FIELD_INVALID", "One or more critical metadata fields are missing, invalid, contaminated, or a manual candidate without active tender-source evidence. Resolve all critical fields before generating or exporting.");
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

  // H — Build/Submission plan prerequisite for GENERATION.
  //     A valid virtual Build Plan satisfies this — it proves the tender
  //     requires at least one file. PLANNED/SUPERSEDED/virtual rows do NOT
  //     count as generated/export-ready; they only satisfy the plan prerequisite.
  if (!input.hasValidVirtualSubmissionPlan) {
    return fail("SUBMISSION_PLAN_MISSING", "No submission/build plan exists. Build the submission plan before generating/exporting.");
  }

  // I — EXPORT/FINAL-ZIP readiness: require real current generated files.
  //     PLANNED, virtual, SUPERSEDED, missing-content, unvalidated, or
  //     unreviewed rows never count. Only real generated files with content,
  //     validation, review, and exact-plan reconciliation satisfy export/ZIP.
  if (input.purpose === "export" || input.purpose === "final-zip") {
    if (input.exportReadyDocumentCount < 1) {
      return fail("NO_EXPORT_READY_DOCUMENTS",
        "No export-ready documents exist. Generate and validate real documents before exporting or creating a final ZIP. PLANNED, virtual, and superseded rows do not count.");
    }
  }

  return { ok: true, purpose: input.purpose };
}

/**
 * Resolve the (latest AI_ANALYZE job id, current content hash) binding for a
 * tender, using the SAME content builder + hash the gate uses. Routes that
 * record a fallback approval bind it to exactly this pair so the gate's
 * condition I matches. Returns nulls when the tender is not found/owned.
 */
export async function resolveCurrentAnalysisBinding(
  prisma: PrismaClient,
  tenderId: string,
  userId: string,
): Promise<{ jobId: string | null; contentHash: string | null }> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      title: true,
      description: true,
      intakeSummary: true,
      files: { select: { id: true, originalFileName: true, extractedText: true, classification: true, createdAt: true, deletionStatus: true } },
    },
  });
  if (!tender) return { jobId: null, contentHash: null };
  const activeFiles = (tender.files as _TenderFileRow[]).filter((f) => f.deletionStatus === "ACTIVE");
  const company = await prisma.company.findUnique({
    where: { userId },
    select: { documents: { select: { originalFileName: true, category: true, extractedText: true } } },
  });
  const contentHash = computeAnalysisContentHash(
    buildTenderAnalysisContent(
      { title: tender.title, description: tender.description, intakeSummary: tender.intakeSummary, files: activeFiles },
      company ?? undefined,
    ),
  );
  const latestJob = await prisma.aiJob.findFirst({
    where: { tenderId, jobType: AI_ANALYZE_JOB_TYPE, tender: { userId } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return { jobId: latestJob?.id ?? null, contentHash };
}

// ─── Async DB-backed entry point ──────────────────────────────────────────────

// Below this average extraction score a file counts as "weak" (overridable).
// Mirrors the spec's weak-extraction band; corrupted is handled separately and
// is never overridable.
const WEAK_EXTRACTION_SCORE_THRESHOLD = 70;

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
    // Also load the metadata fields required for the canonical field-state resolver.
    const tender = await prisma.tender.findFirst({
      where: { id: tenderId, userId },
      select: {
        id: true,
        title: true,
        reference: true,
        description: true,
        intakeSummary: true,
        clientName: true,
        procuringEntityName: true,
        deadline: true,
        currency: true,
        country: true,
        submissionMethod: true,
        submissionAddress: true,
        submissionEmails: true,
        submissionEmailSubject: true,
        clientContactName: true,
        clientContactEmail: true,
        metadataContaminated: true,
        clientNameSourcePage: true,
        clientNameSourceQuote: true,
        submissionMethodSourcePage: true,
        submissionMethodSourceQuote: true,
        submissionAddressSourcePage: true,
        submissionAddressSourceQuote: true,
        submissionEmailSourcePage: true,
        contactDetailsSourceJson: true,
        files: {
          select: {
            id: true,
            originalFileName: true,
            extractedText: true,
            classification: true,
            extractionScore: true,
            createdAt: true,
            deletionStatus: true,
          },
        },
        metadataOverrides: {
          select: {
            field: true,
            fieldState: true,
            overrideValue: true,
            reason: true,
            overriddenBy: true,
            createdAt: true,
          },
        },
      },
    });
    if (!tender) {
      return { ok: false, blockerCode: "OWNERSHIP_TENDER_NOT_FOUND", blockerDetail: "Tender does not exist or does not belong to the requesting user.", purpose };
    }

    const activeFiles = (tender.files as _TenderFileRow[]).filter((f) => f.deletionStatus === "ACTIVE");

    // B — per-file extraction quality + weak-extraction override lookup.
    const extractionFiles = await Promise.all(
      activeFiles.map(async (f) => {
        const quality = assessExtractionQuality(f.extractedText, f.originalFileName);
        const score = Math.min(f.extractionScore ?? quality.score, quality.score);
        const corrupted = quality.corrupted;
        const weak = !corrupted && score < WEAK_EXTRACTION_SCORE_THRESHOLD;
        const hasOverride = weak ? await hasActiveExtractionOverride(prisma, { tenderId, tenderFileId: f.id }) : false;
        return { fileId: f.id, corrupted, weak, hasOverride };
      }),
    );

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
      resolveTenderAnalysisState(prisma, tenderId, userId),
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
    const mappedRequirements: ReadinessRequirement[] = (requirements as _RequirementRow[]).map((r) => ({
      priority: r.priority,
      sourceTenderFileId: r.sourceTenderFileId,
      sourcePageNumber: r.sourcePageNumber,
      sourceExactQuote: r.sourceExactQuote,
      sourceFileActiveInTender: !!r.sourceTenderFileId && activeFileIds.has(r.sourceTenderFileId),
    }));

    // G — canonical field-state resolver: every critical field must pass validation
    //     before generation/export is authorized. No parallel metadata check needed —
    //     this is the single authoritative source of critical field validity.
    const fieldStates = resolveCanonicalFieldState({
      tender: {
        ...tender,
        deadline: tender.deadline ?? null,
        clientNameSourcePage: tender.clientNameSourcePage ?? null,
        clientNameSourceQuote: tender.clientNameSourceQuote ?? null,
        submissionMethodSourcePage: tender.submissionMethodSourcePage ?? null,
        submissionMethodSourceQuote: tender.submissionMethodSourceQuote ?? null,
        submissionAddressSourcePage: tender.submissionAddressSourcePage ?? null,
        submissionAddressSourceQuote: tender.submissionAddressSourceQuote ?? null,
        submissionEmailSourcePage: tender.submissionEmailSourcePage ?? null,
        contactDetailsSourceJson: tender.contactDetailsSourceJson ?? null,
        metadataContaminated: tender.metadataContaminated ?? false,
      },
      overrides: ((tender.metadataOverrides ?? []) as _MetadataOverrideRow[]).map((o) => ({
        field: o.field,
        fieldState: o.fieldState,
        overrideValue: o.overrideValue,
        reason: o.reason,
        overriddenBy: o.overriddenBy,
        createdAt: o.createdAt,
      })),
      hasExtractedRequirements: requirements.length > 0,
      submissionMethodContext: tender.submissionMethod ?? undefined,
    });

    // H — Build/Submission plan prerequisite for GENERATION.
    //     A valid virtual Build Plan satisfies this. We compute it from the
    //     submission plan (built from tender requirements + exact file naming)
    //     rather than counting GeneratedDocument rows, because PLANNED rows
    //     are now virtual and should not be required for generation.
    //     If the tender has explicit submission scope (exact file naming/order
    //     or requirements with exactFileName), the plan must produce at least
    //     one required file. If there's no explicit scope, any tender with
    //     extracted requirements has a valid plan by default.
    const { buildSubmissionPlan, hasExplicitSubmissionScope, plannedSubmissionTargetFiles } = await import("./submission-plan");
    const submissionPlan = buildSubmissionPlan(tender as any);
    const plannedFiles = hasExplicitSubmissionScope(tender as any)
      ? plannedSubmissionTargetFiles(submissionPlan)
      : [];
    const hasValidVirtualSubmissionPlan = requirements.length > 0
      ? (hasExplicitSubmissionScope(tender as any) ? plannedFiles.length > 0 : true)
      : false;

    // I — EXPORT/FINAL-ZIP readiness: count of real current generated files
    //     with content, validation, and review. PLANNED/SUPERSEDED/virtual/
    //     missing-content/unvalidated/unreviewed rows never count.
    //     This is a strict count — only GENERATED rows with fileContent and
    //     validationStatus/reviewStatus indicating readiness are included.
    const exportReadyDocumentCount = await prisma.generatedDocument.count({
      where: {
        tenderId,
        generationStatus: "GENERATED",
        fileContent: { not: null },
        validationStatus: { in: ["VALIDATED", "APPROVED", "READY_FOR_EXPORT"] },
        reviewStatus: { in: ["APPROVED", "READY_FOR_EXPORT", "REPLACE_WITH_ORIGINAL"] },
      },
    });

    return evaluateGenerationReadiness({
      purpose,
      tenderExistsAndOwned: true,
      activeFileCount: activeFiles.length,
      extractionFiles,
      analysisState: analysis.state,
      canonicalJobId: analysis.canonicalJobId,
      latestJobHash: latestJob?.analysisInputHash ?? null,
      currentContentHash,
      fallbackApprovalBound: false, // HUMAN_APPROVED_FALLBACK is now blocked before this is checked
      currentHashChunks,
      requirementCount: requirements.length,
      requirements: mappedRequirements,
      criticalMetadataOk: !fieldStates.hasGenerationBlocker,
      hasValidVirtualSubmissionPlan,
      exportReadyDocumentCount,
    });
  } catch (err) {
    // Fail closed — never let a thrown error read as authorization.
    const detail = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    return { ok: false, blockerCode: "GATE_INTERNAL_ERROR", blockerDetail: `Readiness gate failed to evaluate: ${detail}`, purpose };
  }
}
