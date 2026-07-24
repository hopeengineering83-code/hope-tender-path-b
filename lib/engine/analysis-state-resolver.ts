// Canonical AI Analyze state resolver.
//
// Single source of truth for tender analysis state, replacing fragmented
// state tracking across Tender.notes, AiJob, and AiAnalyzeChunk.
//
// All UI panels, gates, and workflows use this function to determine:
// - Whether analysis has run
// - Whether it succeeded or failed
// - Whether fallback (regex) is active
// - Whether export/generation is unblocked
// - What action is needed next
//
// ARCHITECTURE: The DB-querying entry point `resolveTenderAnalysisState`
// gathers raw data, then delegates ALL state logic to the pure function
// `deriveAnalysisStateDetail`. This keeps the core decision logic fully
// unit-testable without a database.

import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/observability";

export const AI_ANALYZE_JOB_TYPE = "AI_ANALYZE" as const;

export type AnalysisState =
  | "NOT_STARTED"              // No job created
  | "QUEUED"                   // Job waiting, chunks not started
  | "RUNNING"                  // At least one chunk in progress
  | "AI_SUCCEEDED"             // All required chunks succeeded, promoted
  | "PARTIAL_NEEDS_RESUME"     // Some chunks succeeded, some pending/failed, resumable
  | "REGEX_FALLBACK_UNAPPROVED" // All providers exhausted, regex fallback drafted, needs approval
  | "HUMAN_APPROVED_FALLBACK"  // Regex fallback approved (promoted) with mandatory note
  | "FAILED"                   // All chunks failed, no fallback, no recovery
  | "SUPERSEDED"               // Older analysis replaced by newer job
  | "SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED"; // Sections found but no structured requirements extracted

export type SafeProviderFailureCategory =
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "UNAUTHORIZED"
  | "MODEL_UNAVAILABLE"
  | "UNKNOWN";

export interface TenderAnalysisStateDetail {
  state: AnalysisState;
  // Latest job (may be superseded)
  latestJobId: string | null;
  // Canonical/winning job (the one that will be used for export/generation)
  canonicalJobId: string | null;
  analysisSource: "AI" | "REGEX_FALLBACK" | "LEGACY_NOTES" | "NONE";
  startedAt: Date | null;
  finishedAt: Date | null;
  successfulProvider: string | null;
  providerAttempts: Array<{
    provider: string;
    status: "SUCCESS" | "FAILED";
    successes: number;
    failures: number;
  }>;
  completedChunks: number;
  totalChunks: number;
  requirementsExtracted: number;
  // Count of requirements persisted in the database (for workflow display)
  requirementsPersisted?: number;
  sourceReferencesCreated: boolean;
  metadataFieldsPersisted: boolean;
  resumable: boolean;
  nextAction: string; // UI-friendly instruction
  safeDiagnosticSummary: string; // Safe to show in UI (no API keys, raw errors)
}

// ─── Pure input shapes (no Prisma types so this stays unit-testable) ──────

export interface ResolverJobInput {
  id: string;
  status: string; // QUEUED | RUNNING | SUCCEEDED | PARTIAL_SUCCESS | FAILED | CANCELED
  analysisInputHash: string | null;
  stagedMergedResult: string | null;
  promotedAt: Date | null;
  supersededBy: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorMessage: string | null;
}

export interface ResolverChunkInput {
  status: string; // QUEUED | RUNNING | SUCCEEDED | FAILED | SKIPPED
  provider: string | null;
}

export interface DeriveAnalysisStateInput {
  job: ResolverJobInput | null;
  chunks: ResolverChunkInput[];
  // Legacy notes flag — true when Tender.notes records a prior AI analysis
  // and there is no AiJob record.
  legacyNotesAiAnalyzed: boolean;
  // Persisted artefact counts (queried from canonical tables)
  requirementsExtracted: number;
  requirementsPersisted?: number;
  sourceReferencesCreated: boolean;
  metadataFieldsPersisted: boolean;
  // True when tender files contain detected sections (submission/evaluation/required docs)
  // but no structured requirements were extracted.
  sectionsDetectedButNoRequirements?: boolean;
}

/** Redact API keys and obvious secrets from a free-text error for safe UI display. */
function redactSafe(message: string): string {
  return message
    .replace(/sk-[a-zA-Z0-9-]+/g, "[KEY]")
    .replace(/(api[_-]?key\s*[=:]\s*)\S+/gi, "$1[KEY]")
    .replace(/Bearer\s+\S+/gi, "Bearer [KEY]")
    .slice(0, 200);
}

/** Parse the staged result's analysisSource without throwing on malformed JSON. */
function parseStagedSource(stagedMergedResult: string | null): "PARTIAL_AI" | "FALLBACK_DRAFT" | null {
  if (!stagedMergedResult) return null;
  try {
    const parsed = JSON.parse(stagedMergedResult) as { analysisSource?: string };
    if (parsed.analysisSource === "PARTIAL_AI" || parsed.analysisSource === "FALLBACK_DRAFT") {
      return parsed.analysisSource;
    }
  } catch {
    // malformed staged payload — treat as no staged source
  }
  return null;
}

/**
 * PURE state derivation. Takes all gathered data and returns a single
 * TenderAnalysisStateDetail. No database access — fully unit-testable.
 */
export function deriveAnalysisStateDetail(input: DeriveAnalysisStateInput): TenderAnalysisStateDetail {
  const { job, chunks, legacyNotesAiAnalyzed, requirementsExtracted, requirementsPersisted, sourceReferencesCreated, metadataFieldsPersisted, sectionsDetectedButNoRequirements } = input;

  // ─── No job: legacy notes or not started ───────────────────────────────
  if (!job) {
    if (legacyNotesAiAnalyzed) {
      return {
        state: "AI_SUCCEEDED",
        latestJobId: null,
        canonicalJobId: null,
        analysisSource: "LEGACY_NOTES",
        startedAt: null,
        finishedAt: null,
        successfulProvider: null,
        providerAttempts: [],
        completedChunks: 0,
        totalChunks: 0,
        requirementsExtracted,
        sourceReferencesCreated,
        metadataFieldsPersisted,
        resumable: false,
        nextAction: "Legacy analysis detected. Re-run AI Analyze for current extraction quality.",
        safeDiagnosticSummary:
          "Analysis was performed with a prior version of the extraction engine. Consider re-analyzing.",
      };
    }
    return {
      state: "NOT_STARTED",
      latestJobId: null,
      canonicalJobId: null,
      analysisSource: "NONE",
      startedAt: null,
      finishedAt: null,
      successfulProvider: null,
      providerAttempts: [],
      completedChunks: 0,
      totalChunks: 0,
      requirementsExtracted,
      sourceReferencesCreated,
      metadataFieldsPersisted,
      resumable: false,
      nextAction: "Run AI Analyze to extract requirements and metadata.",
      safeDiagnosticSummary: "No analysis performed yet.",
    };
  }

  // ─── Chunk tallies ──────────────────────────────────────────────────────
  const totalChunks = chunks.length;
  const succeededChunks = chunks.filter((c) => c.status === "SUCCEEDED").length;
  const failedChunks = chunks.filter((c) => c.status === "FAILED").length;
  const pendingChunks = chunks.filter((c) => c.status === "QUEUED" || c.status === "RUNNING").length;

  // ─── Aggregate provider attempts (count successes/failures per provider) ──
  const providerMap = new Map<string, { successes: number; failures: number }>();
  for (const chunk of chunks) {
    if (!chunk.provider) continue;
    const stats = providerMap.get(chunk.provider) ?? { successes: 0, failures: 0 };
    if (chunk.status === "SUCCEEDED") stats.successes++;
    else if (chunk.status === "FAILED") stats.failures++;
    providerMap.set(chunk.provider, stats);
  }
  const providerAttempts: TenderAnalysisStateDetail["providerAttempts"] = [];
  for (const [provider, stats] of providerMap.entries()) {
    providerAttempts.push({
      provider,
      status: stats.successes > 0 ? "SUCCESS" : "FAILED",
      successes: stats.successes,
      failures: stats.failures,
    });
  }
  const successfulProvider =
    chunks.find((c) => c.status === "SUCCEEDED")?.provider ?? null;

  const stagedSource = parseStagedSource(job.stagedMergedResult);

  // ─── State machine ────────────────────────────────────────────────────
  let state: AnalysisState;
  let analysisSource: TenderAnalysisStateDetail["analysisSource"];

  if (job.supersededBy) {
    state = "SUPERSEDED";
    analysisSource = "AI";
  } else if (job.status === "SUCCEEDED") {
    // A terminal SUCCEEDED row is not sufficient by itself: canonical promotion
    // is the durable unlock signal for generation/export. If a finalizer or
    // legacy synchronous path failed after analysis but before setting
    // promotedAt, fail closed instead of treating an unpromoted run as usable.
    if (!job.promotedAt) {
      state = "FAILED";
      analysisSource = "NONE";
    } else if (totalChunks === 0 || succeededChunks === totalChunks) {
      // SUCCEEDED with no chunk rows is a valid single-shot success (0 === 0),
      // but only after canonical promotion has been recorded.
      // Check if sections were detected but no requirements extracted — block generation.
      if (sectionsDetectedButNoRequirements && requirementsExtracted === 0) {
        state = "SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED";
        analysisSource = "AI";
      } else {
        state = "AI_SUCCEEDED";
        analysisSource = "AI";
      }
    } else {
      state = "PARTIAL_NEEDS_RESUME";
      analysisSource = "AI";
    }
  } else if (job.status === "PARTIAL_SUCCESS") {
    state = "PARTIAL_NEEDS_RESUME";
    analysisSource = "AI";
  } else if (job.status === "FAILED") {
    if (stagedSource === "FALLBACK_DRAFT") {
      // A promoted fallback draft is a human-approved fallback.
      if (job.promotedAt) {
        state = "HUMAN_APPROVED_FALLBACK";
        analysisSource = "REGEX_FALLBACK";
      } else {
        state = "REGEX_FALLBACK_UNAPPROVED";
        analysisSource = "REGEX_FALLBACK";
      }
    } else if (stagedSource === "PARTIAL_AI") {
      // Partial AI work staged but job ultimately failed — resumable.
      state = "PARTIAL_NEEDS_RESUME";
      analysisSource = "AI";
    } else {
      state = "FAILED";
      analysisSource = "NONE";
    }
  } else if (job.status === "QUEUED") {
    state = "QUEUED";
    analysisSource = "NONE";
  } else if (job.status === "RUNNING" || pendingChunks > 0) {
    state = "RUNNING";
    analysisSource = "NONE";
  } else {
    // CANCELED or unknown status
    state = "FAILED";
    analysisSource = "NONE";
  }

  const canonicalJobId = job.promotedAt ? job.id : null;
  const resumable =
    state === "PARTIAL_NEEDS_RESUME" ||
    state === "REGEX_FALLBACK_UNAPPROVED" ||
    state === "FAILED";

  // ─── UI-friendly next action ────────────────────────────────────────────
  const nextActions: Record<AnalysisState, string> = {
    NOT_STARTED: "Run AI Analyze to extract requirements and metadata.",
    QUEUED: "AI Analyze queued. Processing will start shortly.",
    RUNNING: `Processing: ${succeededChunks}/${totalChunks} chunks completed. Current chunk in progress...`,
    AI_SUCCEEDED: "Analysis complete. Proceed to Build Submission Plan.",
    PARTIAL_NEEDS_RESUME: `Resume Analysis: ${succeededChunks}/${totalChunks} chunks done. Click Resume to complete.`,
    REGEX_FALLBACK_UNAPPROVED:
      "Provider exhausted. Regex fallback available (lower quality). Review and approve with a note, or retry AI Analyze.",
    HUMAN_APPROVED_FALLBACK: "Fallback analysis approved. Proceed with caution (lower confidence).",
    FAILED: "Analysis failed. Check provider status and retry, or proceed with manual entry.",
    SUPERSEDED: "This analysis was replaced by a newer run. Review the latest analysis.",
    SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED:
      "Tender sections detected but no structured requirements found. Retry AI extraction or manually add requirements.",
  };

  // ─── Safe diagnostic summary (no secrets, no raw errors) ─────────────────
  let safeDiagnosticSummary: string;
  if (job.errorMessage && (state === "FAILED" || state === "REGEX_FALLBACK_UNAPPROVED")) {
    safeDiagnosticSummary = `Last error: ${redactSafe(job.errorMessage)}`;
  } else {
    safeDiagnosticSummary = `Job status: ${job.status}. Chunks: ${succeededChunks} succeeded, ${failedChunks} failed, ${pendingChunks} pending.`;
  }

  return {
    state,
    latestJobId: job.id,
    canonicalJobId,
    analysisSource,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    successfulProvider: succeededChunks > 0 ? successfulProvider : null,
    providerAttempts,
    completedChunks: succeededChunks,
    totalChunks,
    requirementsExtracted,
    requirementsPersisted,
    sourceReferencesCreated,
    metadataFieldsPersisted,
    resumable,
    nextAction: nextActions[state],
    safeDiagnosticSummary,
  };
}

/**
 * Resolve the canonical AI Analyze state for a tender.
 * Gathers raw data from the database and delegates all logic to the pure
 * `deriveAnalysisStateDetail`.
 *
 * NOTE: This is the unified resolver that replaces both #797 (pure)
 * and #802 (modular). It uses #802's DB signature but #797's richer state logic.
 */
export async function resolveTenderAnalysisState(
  prismaClient: PrismaClient | typeof prisma,
  tenderId: string,
  userId?: string
): Promise<TenderAnalysisStateDetail> {
  // Load the latest AI_ANALYZE job for this tender.
  const latestJob = await prismaClient.aiJob.findFirst({
    where: { tenderId, jobType: AI_ANALYZE_JOB_TYPE, ...(userId ? { tender: { userId } } : {}) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      analysisInputHash: true,
      stagedMergedResult: true,
      promotedAt: true,
      supersededBy: true,
      startedAt: true,
      finishedAt: true,
      errorMessage: true,
    },
  });

  // Gather persisted artefact counts + tender metadata in parallel.
  const [requirementsPersisted, sourceReferencesCreated, tender] = await Promise.all([
    prismaClient.tenderRequirement.count({ where: { tenderId, ...(userId ? { tender: { userId } } : {}) } }),
    prismaClient.tenderRequirement
      .count({ where: { tenderId, sourceExactQuote: { not: null }, ...(userId ? { tender: { userId } } : {}) } })
      .then((n) => n > 0),
    prismaClient.tender.findFirst({
      where: { id: tenderId, ...(userId ? { userId } : {}) },
      include: { files: true },
    }),
  ]);

  // Metadata is considered persisted when critical fields are populated.
  const metadataFieldsPersisted = Boolean(
    (tender?.clientName || tender?.procuringEntityName) && (tender?.deadline || tender?.submissionMethod)
  );

  // Legacy notes-based analysis only matters when there is no job record.
  // CRITICAL FIX (investigation FM-010): the previous regex `/analysis\s+source.*ai/i`
  // was too permissive — the `.*` greedily matched the substring "ai" inside
  // "REGEX_FALLBACK_AI_ERROR", causing a false-positive AI_SUCCEEDED for a
  // tender that actually fell back to regex. The anchored regex below requires
  // "ai" to appear as a word boundary immediately after "source:".
  const legacyNotesAiAnalyzed =
    !latestJob && Boolean(tender?.notes && /^analysis\s+source:\s*ai\b/im.test(tender.notes));

  // Detect if tender files have section markers (submission/evaluation/required docs)
  // but no requirements were extracted — a case that should block generation.
  let sectionsDetectedButNoRequirements = false;
  if (tender?.files) {
    for (const file of tender.files) {
      try {
        const pageStatus = JSON.parse(file.pageStatusJson || "[]");
        if (Array.isArray(pageStatus)) {
          if (
            pageStatus.some(
              (p: any) =>
                p.hasSubmissionInstructions || p.hasEvaluationCriteria || p.hasRequiredDocuments
            )
          ) {
            sectionsDetectedButNoRequirements = true;
            break;
          }
        }
      } catch (e) {
        // Malformed JSON in staged payload — skip — but log a warn so
        // operators can detect analysis-corruption patterns (a series of
        // these in a row suggests a provider returning bad output, not
        // a one-off serialization glitch).
        logger.warn("[analysis-state-resolver] malformed staged JSON — skipping", {
          detail: e,
        });
      }
    }
  }

  // When the job has no content hash there are no meaningful chunk rows to
  // attribute to it — querying with an empty hash would match foreign/corrupt
  // rows, so we treat it as no chunks.
  let chunks: ResolverChunkInput[] = [];
  if (latestJob?.analysisInputHash) {
    chunks = await prismaClient.aiAnalyzeChunk.findMany({
      where: { tenderId, contentHash: latestJob.analysisInputHash, ...(userId ? { userId } : {}) },
      select: { status: true, provider: true },
    });
  }

  return deriveAnalysisStateDetail({
    job: latestJob,
    chunks,
    legacyNotesAiAnalyzed,
    requirementsExtracted: requirementsPersisted,
    requirementsPersisted,
    sourceReferencesCreated,
    metadataFieldsPersisted,
    sectionsDetectedButNoRequirements,
  });
}

/**
 * Check if an analysis state unblocks generation/export.
 * Only AI_SUCCEEDED is accepted. HUMAN_APPROVED_FALLBACK is explicitly
 * blocked — regex/fallback analysis is not a sufficient basis for creating
 * output GeneratedDocument rows, exporting, or building a Final ZIP.
 */
export function canExportWithAnalysisState(state: AnalysisState): boolean {
  return state === "AI_SUCCEEDED";
}

/**
 * Check if analysis can be resumed or retried.
 */
export function canResumeAnalysis(state: AnalysisState): boolean {
  return (
    state === "PARTIAL_NEEDS_RESUME" ||
    state === "REGEX_FALLBACK_UNAPPROVED" ||
    state === "FAILED" ||
    state === "SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED"
  );
}

/**
 * UI-friendly display label for analysis state.
 */
export function analysisStateLabel(state: AnalysisState): string {
  const labels: Record<AnalysisState, string> = {
    NOT_STARTED: "Not Started",
    QUEUED: "Queued",
    RUNNING: "Running",
    AI_SUCCEEDED: "Analysis Complete",
    PARTIAL_NEEDS_RESUME: "Partial (Resume)",
    REGEX_FALLBACK_UNAPPROVED: "Fallback (Unapproved)",
    HUMAN_APPROVED_FALLBACK: "Fallback (Approved)",
    FAILED: "Failed",
    SUPERSEDED: "Superseded",
    SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED: "Sections Detected (No Requirements)",
  };
  return labels[state];
}
