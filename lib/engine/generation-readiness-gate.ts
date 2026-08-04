// Central authoritative generation/export readiness gate.
import { logger } from "../observability";
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
// extraction override (ExtractionQualityOverride).
//
// NOTE: HUMAN_APPROVED_FALLBACK is PERMANENTLY HARD-BLOCKED at the state
// check (line ~236). The spec's "regex-fallback approval bound to the exact
// job + content hash (FallbackApprovalRecord)" mechanism exists in
// lib/engine/readiness-overrides.ts (recordFallbackApproval/hasBoundFallbackApproval)
// and rows ARE written by the approve-analysis route, but the gate does NOT
// consult them — it hard-blocks before any binding check could run. This is
// intentionally MORE restrictive than the original spec (audit-only approval
// never authorizes release). The hasBoundFallbackApproval helper is retained
// for future use but is not currently wired into the gate.
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
import { hasActiveExtractionOverride } from "./readiness-overrides";
import { resolveCanonicalFieldState } from "./canonical-field-state";
import type { MetadataFieldState } from "./metadata-override";

// Local type stubs for Prisma query result shapes — avoids implicit `any` when
// @prisma/client types are not yet generated in the current environment.
// Stubs MUST stay aligned with the columns selected by assertTenderReadyForGenerationAndExport
// and validateCriticalMetadataEvidenceForBuildPlan. If you add a column to one
// of those queries, add it here too — otherwise the runtime value reaches the
// gate via `as any` and TypeScript cannot catch a missing column.
type _TenderFileRow = {
  id: string;
  originalFileName: string;
  extractedText: string | null;
  extractionScore: number | null;
  classification: string | null;
  createdAt: Date;
  deletionStatus: string | null;
  totalPages: number | null;
};
type _RequirementRow = {
  id: string;
  priority: string | null;
  sourceTenderFileId: string | null;
  sourcePageNumber: number | null;
  sourceExactQuote: string | null;
  title: string | null;
  description: string | null;
  requirementType: string | null;
  exactFileName: string | null;
  exactOrder: number | null;
};
type _MetadataOverrideRow = {
  field: string;
  fieldState: MetadataFieldState;
  overrideValue: string | null;
  reason: string | null;
  overriddenBy?: string | null;
  createdAt?: Date;
  confirmationBasis: string | null;
  authorityClass: string | null;
  confirmedAt: Date | null;
};
type _TenderRow = {
  id: string;
  deadline: Date | null;
  clientNameSourcePage: number | null;
  clientNameSourceQuote: string | null;
  clientNameSourceFileId: string | null;
  submissionMethodSourcePage: number | null;
  submissionMethodSourceQuote: string | null;
  submissionMethodSourceFileId: string | null;
  submissionAddressSourcePage: number | null;
  submissionAddressSourceQuote: string | null;
  submissionAddressSourceFileId: string | null;
  submissionEmailSourcePage: number | null;
  submissionEmailSourceFileId: string | null;
  submissionEmailSourceQuote: string | null;
  titleSourceFileId: string | null;
  titleSourcePage: number | null;
  titleSourceQuote: string | null;
  deadlineSourceFileId: string | null;
  deadlineSourcePage: number | null;
  deadlineSourceQuote: string | null;
  contactDetailsSourceJson: string | null;
  metadataContaminated: boolean | null;
  submissionMethod: string | null;
  metadataOverrides: _MetadataOverrideRow[] | null;
  files: _TenderFileRow[];
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
  | "REQUIREMENT_QUOTE_NOT_IN_FILE"
  | "TENDER_FACTS_INVALID"
  | "BUILD_PLAN_MISSING"
  | "BUILD_PLAN_STALE"
  | "BUILD_PLAN_ITEMS_INVALID"
  | "NO_EXPORT_READY_DOCUMENTS"
  | "BUILD_PLAN_NOT_CONFIRMED"
  | "CONFIRMED_PLAN_DOCUMENTS_INCOMPLETE"
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
  /** Extracted text of the source TenderFile — used for quote containment verification. */
  sourceFileExtractedText?: string | null;
  /** Total pages of the source TenderFile — used for sourcePage <= totalPages enforcement. */
  sourceFileTotalPages?: number | null;
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
  //     generated/export-ready.
  // H2 — Recorded (persisted) Build Plan state. A persisted BuildPlan is
  //      MANDATORY for generation/export: it is bound to the shared content hash
  //      of the tender's ACTIVE files + requirements + exact naming/order +
  //      submission instructions at build time.
  //        - "MISSING": no recorded plan exists → block (must Build Plan first).
  //        - "STALE":   recorded plan's hash no longer matches the tender's
  //                     current state (files/requirements/naming changed) → block.
  //        - "VALID":   recorded plan matches the current state → allowed.
  //      The async gate always sets this from the database. Left undefined only
  //      in pure unit tests that are not exercising the plan condition.
  recordedBuildPlanState?: "MISSING" | "STALE" | "VALID";
  // I — EXPORT/FINAL-ZIP readiness: count of real current generated files with
  //     content, validation, review, and exact-plan reconciliation. Only these
  //     rows satisfy export and final-ZIP gates. PLANNED/SUPERSEDED/virtual/
  //     missing-content/unvalidated/unreviewed rows never count here.
  exportReadyDocumentCount: number;
  // K — CONFIRMED BuildPlan: a current CONFIRMED BuildPlan with matching hash.
  hasCurrentConfirmedBuildPlan?: boolean;
  // K2 — Confirmed BuildPlan items validation: all items must be valid, non-null,
  //      with correct structure, no duplicates, and matching current tender scope.
  confirmedBuildPlanItemsValid?: boolean;
  confirmedBuildPlanItemBlockers?: string[];
  // L — Confirmed plan document reconciliation for export/ZIP.
  confirmedPlanDocumentsOk?: boolean;
  confirmedPlanDocumentBlockers?: string[];
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
      return fail("EXTRACTION_CORRUPTED", "At least one tender file has corrupted extraction. Upload a clearer, text-based document — corrupted extraction can never be overridden.");
    }
    if (file.weak && !file.hasOverride) {
      return fail("EXTRACTION_WEAK_NO_OVERRIDE", "At least one tender file has weak extraction and no override on record. Upload a clearer, text-based copy, or record an explicit extraction-quality override before generating/exporting.");
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
    return fail("ANALYSIS_HASH_MISMATCH", "The eligible AI Analyze job has no recorded content hash. Re-run AI Analyze before generating or exporting.");
  } else if (input.latestJobHash !== input.currentContentHash) {
    return fail("ANALYSIS_HASH_MISMATCH", "Tender content or analyzed inputs changed since the last analysis. Re-run AI Analyze so the analysis matches the current tender before generating or exporting.");
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

  // G — Tender Facts safety gate (source-grounded, final-output fail-closed).
  //
  // PR #1002 removed this check entirely, weakening final-output safety. This
  // restoration re-enables the gate for FINAL purposes (export, final-zip) only.
  // Draft generation remains unblocked — missing optional tender details are
  // advisory during draft work.
  //
  // The `criticalMetadataOk` input is computed upstream using:
  //   - DRAFT purposes: !fieldStates.hasGenerationBlocker (manual values OK)
  //   - FINAL purposes:  !fieldStates.hasExportBlocker (manual values need audit)
  //     AND the BuildPlan source-evidence validator
  //
  // Blocker code renamed from METADATA_CRITICAL_FIELD_INVALID to
  // TENDER_FACTS_INVALID per the unified tender-facts model. The app no longer
  // exposes "metadata" as a user-facing concept; these are Tender Details /
  // Submission Facts / Final Package Facts.
  if (!input.criticalMetadataOk) {
    if (input.purpose === "export" || input.purpose === "final-zip") {
      return fail(
        "TENDER_FACTS_INVALID",
        "One or more required Tender Details / Submission Facts are missing, invalid, or not source-grounded with active tender file evidence (page + quote + containment). Resolve all required fields — client/procuring entity, deadline, submission method/email/address — before final export.",
      );
    }
    // Draft/support/review: tender facts are advisory, not blocking. Missing
    // optional details do not prevent draft generation.
  }

  // F — Requirement and source grounding.
  if (input.requirementCount < 1) {
    return fail("REQUIREMENTS_MISSING", "No tender requirements have been extracted. Run AI Analyze or add requirements before generating/exporting.");
  }
  const mandatory = input.requirements.filter((r) => (r.priority ?? "").toUpperCase() === "MANDATORY");
  for (const r of mandatory) {
    const quote = (r.sourceExactQuote ?? "").trim();
    const hasStructuralGrounding =
      !!r.sourceTenderFileId &&
      r.sourceFileActiveInTender &&
      typeof r.sourcePageNumber === "number" &&
      r.sourcePageNumber >= 1 &&
      quote.length >= MIN_MEANINGFUL_QUOTE_CHARS;
    if (!hasStructuralGrounding) {
      return fail("REQUIREMENT_SOURCE_UNGROUNDED", "At least one mandatory requirement is missing a valid source reference (active source file, page number, and a meaningful verbatim quote). Re-run AI Analyze to ground requirements.");
    }
    // ENFORCE sourcePage <= totalPages when totalPages exists — same rule as
    // the metadata evidence validator. A page beyond the file's actual page
    // count is fabricated evidence and must be blocked.
    if (
      typeof r.sourcePageNumber === "number" &&
      typeof r.sourceFileTotalPages === "number" &&
      r.sourceFileTotalPages > 0 &&
      r.sourcePageNumber > r.sourceFileTotalPages
    ) {
      return fail("REQUIREMENT_SOURCE_UNGROUNDED", `Mandatory requirement source page ${r.sourcePageNumber} exceeds the source file's total pages ${r.sourceFileTotalPages}. Re-run AI Analyze to ground requirements with valid page references.`);
    }
    // QUOTE CONTAINMENT: the normalized quote MUST actually appear in the
    // extracted text of the referenced ACTIVE TenderFile. Without this, a
    // foreign/guessed/unsupported quote could pass the structural check.
    const fileText = (r.sourceFileExtractedText ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    const normalizedQuote = quote.toLowerCase().replace(/\s+/g, " ").trim();
    if (quote.length >= MIN_MEANINGFUL_QUOTE_CHARS && (fileText.length === 0 || !fileText.includes(normalizedQuote))) {
      return fail("REQUIREMENT_QUOTE_NOT_IN_FILE", "At least one mandatory requirement has a source quote that is not contained in the extracted text of the referenced active TenderFile. Foreign, guessed, or unsupported evidence is blocked. Re-run AI Analyze to ground requirements.");
    }
  }

  // H2 — A persisted Build Plan is mandatory and must match the tender's current
  //      state. No recorded plan → block (build it first). A recorded plan whose
  //      shared content hash no longer matches (files/requirements/exact naming
  //      changed after it was built) is stale → block until rebuilt.
  if (input.recordedBuildPlanState === "MISSING") {
    return fail("BUILD_PLAN_MISSING", "No submission/build plan has been recorded for this tender. Build (and persist) the submission plan before generating or exporting.");
  }
  if (input.recordedBuildPlanState === "STALE") {
    return fail("BUILD_PLAN_STALE", "The recorded submission/build plan is out of date because the tender's files, requirements, or exact naming/order changed after it was built. Rebuild the submission plan before generating/exporting.");
  }

  // I — EXPORT/FINAL-ZIP readiness: require real current generated files.
  //     PLANNED, virtual, SUPERSEDED, missing-content, unvalidated, or
  //     unreviewed rows never count. Only real generated files with content,
  //     validation, review, and exact-plan reconciliation satisfy export/ZIP.
  // K — Confirmed BuildPlan is mandatory for all release actions.
  //     Fail-closed: undefined (caller did not compute it) blocks the same as
  //     false. Without this, a caller that forgets to pass the field would
  //     silently bypass the confirmed-plan requirement.
  if (input.hasCurrentConfirmedBuildPlan !== true) {
    return fail("BUILD_PLAN_NOT_CONFIRMED", "No current confirmed Build Plan exists. Build and confirm the Build Plan before any release action.");
  }

  // K2 — Confirmed BuildPlan items must be valid at runtime. A corrupted, invalid,
  //      or malformed item must block generation/export.
  if (input.confirmedBuildPlanItemsValid !== true) {
    const blockerList = (input.confirmedBuildPlanItemBlockers ?? []).slice(0, 3).join("; ");
    return fail("BUILD_PLAN_ITEMS_INVALID", `Build Plan items are invalid and cannot authorize generation/export: ${blockerList || "unspecified error"}`);
  }

  if (input.purpose === "export" || input.purpose === "final-zip") {
    if (input.confirmedPlanDocumentsOk !== true) {
      return fail("CONFIRMED_PLAN_DOCUMENTS_INCOMPLETE", "Confirmed plan documents are incomplete, missing, or mismatched.");
    }
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
        clientNameSourceFileId: true,
        submissionMethodSourcePage: true,
        submissionMethodSourceQuote: true,
        submissionMethodSourceFileId: true,
        submissionAddressSourcePage: true,
        submissionAddressSourceQuote: true,
        submissionAddressSourceFileId: true,
        submissionEmailSourcePage: true,
        submissionEmailSourceFileId: true,
        submissionEmailSourceQuote: true,
        // Title + deadline source evidence — required by the canonical
        // field-state resolver and validateCriticalMetadataEvidenceForBuildPlan
        // for full source-grounding verification. Without these, the gate's
        // criticalMetadataOk check would be incomplete.
        titleSourceFileId: true,
        titleSourcePage: true,
        titleSourceQuote: true,
        deadlineSourceFileId: true,
        deadlineSourcePage: true,
        deadlineSourceQuote: true,
        // Reference source evidence — dedicated columns read first by the
        // canonical resolver's getSourceEvidence for fieldKey="reference".
        // The resolver call below uses `...tender` spread, so selecting these
        // columns is sufficient to forward them. Without this, the gate's
        // reference grounding diverges from the strict BuildPlan validator.
        referenceSourceFileId: true,
        referenceSourcePage: true,
        referenceSourceQuote: true,
        contactDetailsSourceJson: true,
        // Plan-driving fields for the shared Build Plan hash.
        exactFileNaming: true,
        exactFileOrder: true,
        files: {
          select: {
            id: true,
            originalFileName: true,
            extractedText: true,
            classification: true,
            extractionScore: true,
            createdAt: true,
            deletionStatus: true,
            totalPages: true,
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
            // Authority model columns
            confirmationBasis: true,
            authorityClass: true,
            confirmedAt: true,
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
      where: { tenderId, userId, contentHash: currentContentHash },
      select: { status: true, totalChunks: true },
    });

    // F — requirements + source-file activeness resolved against THIS tender.
    //     Includes the plan-driving fields needed for the shared Build Plan hash.
    const requirements = await prisma.tenderRequirement.findMany({
      where: { tenderId },
      select: {
        id: true, priority: true, sourceTenderFileId: true, sourcePageNumber: true, sourceExactQuote: true,
        title: true, requirementType: true, exactFileName: true, exactOrder: true,
      },
    });
    const activeFileIds = new Set(activeFiles.map((f) => f.id));
    const mappedRequirements: ReadinessRequirement[] = (requirements as _RequirementRow[]).map((r) => {
      const sourceFile = r.sourceTenderFileId ? activeFiles.find((f) => f.id === r.sourceTenderFileId) : null;
      return {
        priority: r.priority,
        sourceTenderFileId: r.sourceTenderFileId,
        sourcePageNumber: r.sourcePageNumber,
        sourceExactQuote: r.sourceExactQuote,
        sourceFileActiveInTender: !!r.sourceTenderFileId && activeFileIds.has(r.sourceTenderFileId),
        sourceFileExtractedText: sourceFile?.extractedText ?? null,
        sourceFileTotalPages: sourceFile?.totalPages ?? null,
      };
    });

    // G — canonical field-state resolver: every critical field must pass validation
    //     before generation/export is authorized. No parallel metadata check needed —
    //     this is the single authoritative source of critical field validity.
    const fieldStates = resolveCanonicalFieldState({
      tender: {
        ...tender,
        deadline: tender.deadline ?? null,
        clientNameSourcePage: tender.clientNameSourcePage ?? null,
        clientNameSourceQuote: tender.clientNameSourceQuote ?? null,
        clientNameSourceFileId: tender.clientNameSourceFileId ?? null,
        submissionMethodSourcePage: tender.submissionMethodSourcePage ?? null,
        submissionMethodSourceQuote: tender.submissionMethodSourceQuote ?? null,
        submissionMethodSourceFileId: tender.submissionMethodSourceFileId ?? null,
        submissionAddressSourcePage: tender.submissionAddressSourcePage ?? null,
        submissionAddressSourceQuote: tender.submissionAddressSourceQuote ?? null,
        submissionAddressSourceFileId: tender.submissionAddressSourceFileId ?? null,
        submissionEmailSourcePage: tender.submissionEmailSourcePage ?? null,
        submissionEmailSourceFileId: tender.submissionEmailSourceFileId ?? null,
        submissionEmailSourceQuote: tender.submissionEmailSourceQuote ?? null,
        titleSourceFileId: tender.titleSourceFileId ?? null,
        titleSourcePage: tender.titleSourcePage ?? null,
        titleSourceQuote: tender.titleSourceQuote ?? null,
        deadlineSourceFileId: tender.deadlineSourceFileId ?? null,
        deadlineSourcePage: tender.deadlineSourcePage ?? null,
        deadlineSourceQuote: tender.deadlineSourceQuote ?? null,
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
        confirmationBasis: o.confirmationBasis,
        authorityClass: o.authorityClass,
        confirmedAt: o.confirmedAt,
      })),
      hasExtractedRequirements: requirements.length > 0,
      submissionMethodContext: tender.submissionMethod ?? undefined,
      // Enforce stricter metadata grounding: a USER_EDITED/USER_CONFIRMED
      // critical field only counts as grounded when its evidence points to an
      // ACTIVE tender file (page + quote + valid file). Stale/deleted-file
      // evidence cannot unblock generation.
      activeTenderFileIds: activeFileIds,
      // Full active-file rows enable the STRONGEST shared grounding check
      // (quote containment + page <= totalPages) — the same evidence rules
      // validateCriticalMetadataEvidenceForBuildPlan applies below, so this
      // resolver verdict and the validator verdict cannot diverge.
      activeFiles: activeFiles.map((f) => ({ id: f.id, extractedText: f.extractedText, totalPages: f.totalPages ?? null })),
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
    // Virtual submission plan authority removed — release depends only on
    // persisted confirmed BuildPlan.
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

    // H2 — recorded Build Plan state (MANDATORY). A persisted BuildPlan is bound
    //      to the SINGLE shared content hash over the tender's ACTIVE files +
    //      requirements + exact naming/order + submission instructions. No
    //      recorded plan → MISSING (block); recorded hash != current → STALE
    //      (block); match → VALID. Uses the same helper as the Build Plan route,
    //      so the recorded plan and this check can never disagree.
    const recordedBuildPlan = await prisma.buildPlan.findUnique({
      where: { tenderId },
      select: { contentHash: true, status: true, revision: true, confirmedRevision: true, confirmedContentHash: true, itemsJson: true },
    });
    // CANONICAL HASH: call computeTenderBuildPlanHash — the ONE shared service
    // that loads tender data and builds the canonical hash input internally.
    // No manual file/requirement/metadata/item mapping in the gate.
    const persistedItems = recordedBuildPlan?.itemsJson ? JSON.parse(recordedBuildPlan.itemsJson) : [];
    const { computeTenderBuildPlanHash } = await import("./build-plan");
    const currentPlanHash = await computeTenderBuildPlanHash(prisma, tenderId, userId, persistedItems);
    const recordedBuildPlanState: "MISSING" | "STALE" | "VALID" =
      !recordedBuildPlan ? "MISSING"
        : recordedBuildPlan.contentHash !== currentPlanHash ? "STALE"
        : "VALID";

    // K — Confirmed BuildPlan (MANDATORY for all release actions). Uses the
    //     unified service (lib/engine/build-plan.ts getCurrentConfirmedBuildPlan)
    //     so the gate's definition of "confirmed" matches the confirmation
    //     route's definition exactly: status=CONFIRMED, confirmedRevision =
    //     current revision, confirmedContentHash = current contentHash, and the
    //     live computed hash still equals confirmedContentHash. Any drift
    //     (files added/removed/renamed, requirements changed, submission
    //     instructions changed, plan rebuilt but not re-confirmed) → false.
    let hasCurrentConfirmedBuildPlan = false;
    let confirmedBuildPlanItemsValid: boolean | undefined;
    let confirmedBuildPlanItemBlockers: string[] | undefined;
    let confirmedPlanDocumentsOk: boolean | undefined;
    let confirmedPlanDocumentBlockers: string[] | undefined;
    if (recordedBuildPlan && recordedBuildPlanState === "VALID") {
      const buildPlanModule: typeof import("./build-plan") = await import("./build-plan");
      const confirmed = await buildPlanModule.getCurrentConfirmedBuildPlan(prisma, tenderId, userId);
      if (confirmed.ok) {
        hasCurrentConfirmedBuildPlan = true;
        // K2 — Every item of the confirmed plan is re-validated at runtime:
        // structure, duplicates, scope match, requirement links, template file
        // references. A confirmed plan whose ITEMS are malformed must never
        // authorize a release action even when its hash is fresh.
        const itemValidation = await buildPlanModule.validateBuildPlanItemsAtRuntime(prisma, tenderId, userId, confirmed.items);
        confirmedBuildPlanItemsValid = itemValidation.ok;
        confirmedBuildPlanItemBlockers = itemValidation.blockers;
        // For export/final-zip, also validate that every required plan item has
        // a matching generated, validated, approved document with content — and
        // no extra/foreign documents exist outside the confirmed plan.
        if (purpose === "export" || purpose === "final-zip") {
          const docValidation = await buildPlanModule.validateConfirmedPlanDocuments(prisma, tenderId, userId, confirmed.items);
          confirmedPlanDocumentsOk = docValidation.ok;
          confirmedPlanDocumentBlockers = docValidation.blockers;
        }
      }
    }

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
      criticalMetadataOk: (() => {
        // ─── Authority model: draft vs final distinction ────────────────
        // DRAFT purposes (generate, regenerate-section, ai-proposal,
        // ai-proposal-persist, background-proposal-generation,
        // regenerate-cvs, generate-missing-plan-files) use
        // hasGenerationBlocker — which is NEVER set by a manual value
        // (USER_EDITED / USER_CONFIRMED). Draft work proceeds even when
        // critical fields have only human-confirmed operational values.
        //
        // FINAL purposes (export, final-zip) use hasExportBlocker —
        // which IS set when a submission-critical field has a manual
        // value without sufficient audit (reason + confirmationBasis).
        const isDraftPurpose = purpose !== "export" && purpose !== "final-zip";
        const resolverBlocker = isDraftPurpose
          ? fieldStates.hasGenerationBlocker
          : fieldStates.hasExportBlocker;
        if (resolverBlocker) return false;
        // The BuildPlan validator is the SECOND conjunctive gate. For draft
        // purposes we SKIP it (the resolver's hasGenerationBlocker is the
        // sole authority for draft). For final purposes we still consult it
        // as a defense-in-depth check.
        if (isDraftPurpose) return true;
        // Final purpose — run the BuildPlan validator
        // (returned via async IIFE below — this branch is synchronous)
        return true; // placeholder — async check below overrides this
      })() && (purpose === "export" || purpose === "final-zip" ? (await (async () => {
        // Defense-in-depth metadata validation for final purposes. The async
        // IIFE returns true when the metadata is VALID (metaValidation.ok=true).
        // The outer expression therefore yields true (allow) only when
        // validation passes, and false (block) when validation fails or throws.
        // Previously this had a spurious `!` that inverted the check — valid
        // metadata was blocked and invalid metadata was allowed. The catch
        // returns false (fail-closed) so a validator error blocks the export.
        try {
          const { validateCriticalMetadataEvidenceForBuildPlan } = await import("./build-plan");
          const fullTender = await prisma.tender.findFirst({
            where: { id: tenderId, userId },
            include: {
              files: { where: { deletionStatus: "ACTIVE" }, select: { id: true, extractedText: true, originalFileName: true, deletionStatus: true, totalPages: true } },
              // Load metadata overrides so the validator checks EFFECTIVE values
              // (override ?? raw), mirroring the canonical hash. Include the
              // authority-model columns so the validator can check audit sufficiency.
              metadataOverrides: { select: { field: true, fieldState: true, overrideValue: true, reason: true, confirmationBasis: true, authorityClass: true, confirmedAt: true } },
            },
          });
          if (!fullTender) return false;
          const metaValidation = validateCriticalMetadataEvidenceForBuildPlan(fullTender as unknown as _TenderRow, fullTender.files as _TenderFileRow[], (fullTender.metadataOverrides ?? []) as _MetadataOverrideRow[], "final");
          return metaValidation.ok;
        } catch { return false; }
      })()) : true),
      recordedBuildPlanState,
      hasCurrentConfirmedBuildPlan,
      confirmedBuildPlanItemsValid,
      confirmedBuildPlanItemBlockers,
      confirmedPlanDocumentsOk,
      confirmedPlanDocumentBlockers,
      exportReadyDocumentCount,
    });
  } catch (err) {
    // Fail closed — never let a thrown error read as authorization.
    // Log technical details server-side only; return only stable public-safe code.
    const detail = err instanceof Error ? err.message : "unknown error";
    logger.error("[generation-readiness-gate] GATE_INTERNAL_ERROR", { detail });
    return { ok: false, blockerCode: "GATE_INTERNAL_ERROR", blockerDetail: "Readiness gate failed to evaluate. Check server logs for details.", purpose };
  }
}
