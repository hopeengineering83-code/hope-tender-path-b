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

import { prisma } from "@/lib/prisma";

export type AnalysisState =
  | "NOT_STARTED"              // No job created
  | "QUEUED"                   // Job waiting, chunks not started
  | "RUNNING"                  // At least one chunk in progress
  | "AI_SUCCEEDED"             // All required chunks succeeded, promoted
  | "PARTIAL_NEEDS_RESUME"     // Some chunks succeeded, some pending/failed, resumable
  | "REGEX_FALLBACK_UNAPPROVED" // All providers exhausted, regex fallback drafted, needs approval
  | "HUMAN_APPROVED_FALLBACK"  // Regex fallback approved with mandatory note
  | "FAILED"                   // All chunks failed, no fallback, no recovery
  | "SUPERSEDED";              // Older analysis replaced by newer job

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
    failureCategory?: SafeProviderFailureCategory;
  }>;
  completedChunks: number;
  totalChunks: number;
  requirementsExtracted: number;
  sourceReferencesCreated: boolean;
  metadataFieldsPersisted: boolean;
  resumable: boolean;
  nextAction: string; // UI-friendly instruction
  safeDiagnosticSummary: string; // Safe to show in UI (no API keys, raw errors)
}

/**
 * Resolve the canonical AI Analyze state for a tender.
 * Returns exactly one state and all information needed by UI panels and gates.
 *
 * Decision logic:
 * 1. Check AiJob + AiAnalyzeChunk records (primary truth)
 * 2. If no job, check Tender.notes for legacy analysis (fallback for old tenders)
 * 3. Return unified state detail
 */
export async function resolveTenderAnalysisState(
  tenderId: string,
  userId: string
): Promise<TenderAnalysisStateDetail> {
  // Load the latest job for this tender/user
  const latestJob = await prisma.aiJob.findFirst({
    where: {
      tenderId,
      userId,
      jobType: "ANALYZE_TENDER", // Assuming job type enum includes this
    },
    orderBy: { createdAt: "desc" },
    include: {
      steps: true,
    },
  });

  // If no job exists, check for legacy notes-based analysis
  if (!latestJob) {
    const tender = await prisma.tender.findUnique({
      where: { id: tenderId },
      select: {
        notes: true,
        updatedAt: true,
      },
    });

    if (tender?.notes && /analysis\s+source.*ai/i.test(tender.notes)) {
      // Legacy AI analysis recorded in notes
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
        requirementsExtracted: 0,
        sourceReferencesCreated: false,
        metadataFieldsPersisted: false,
        resumable: false,
        nextAction: "Legacy analysis detected. Re-run AI Analyze for current extraction.",
        safeDiagnosticSummary:
          "Analysis was performed with prior version of extraction engine. Consider re-analyzing for better extraction quality.",
      };
    }

    // No analysis at all
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
      requirementsExtracted: 0,
      sourceReferencesCreated: false,
      metadataFieldsPersisted: false,
      resumable: false,
      nextAction: "Run AI Analyze to extract requirements and metadata.",
      safeDiagnosticSummary: "No analysis performed yet.",
    };
  }

  // We have a job. Analyze its chunks to determine state
  const chunks = await prisma.aiAnalyzeChunk.findMany({
    where: {
      tenderId,
      userId,
      contentHash: latestJob.analysisInputHash || "",
    },
  });

  const totalChunks = chunks.length || 1; // At least 1
  const succeededChunks = chunks.filter((c) => c.status === "SUCCEEDED").length;
  const failedChunks = chunks.filter((c) => c.status === "FAILED").length;
  const pendingChunks = chunks.filter((c) => c.status === "QUEUED" || c.status === "RUNNING").length;

  // Determine canonical (winning) job
  // If job has been promoted, it's canonical; otherwise latest is canonical
  const canonicalJobId = latestJob.promotedAt ? latestJob.id : null;

  // Determine state based on job status and chunk progress
  let state: AnalysisState = "NOT_STARTED";
  let analysisSource: "AI" | "REGEX_FALLBACK" | "LEGACY_NOTES" | "NONE" = "NONE";

  if (latestJob.status === "SUCCEEDED") {
    if (succeededChunks === totalChunks) {
      state = "AI_SUCCEEDED";
      analysisSource = "AI";
    } else {
      // Job succeeded but not all chunks succeeded (partial success persisted)
      state = "PARTIAL_NEEDS_RESUME";
      analysisSource = "AI";
    }
  } else if (latestJob.status === "PARTIAL_SUCCESS") {
    state = "PARTIAL_NEEDS_RESUME";
    analysisSource = "AI";
  } else if (latestJob.status === "FAILED") {
    if (latestJob.stagedMergedResult) {
      // Fallback result exists but not approved
      state = "REGEX_FALLBACK_UNAPPROVED";
      analysisSource = "REGEX_FALLBACK";
    } else {
      state = "FAILED";
      analysisSource = "NONE";
    }
  } else if (latestJob.status === "QUEUED") {
    state = "QUEUED";
  } else if (latestJob.status === "RUNNING" || pendingChunks > 0) {
    state = "RUNNING";
  }

  // Check if superseded by newer job
  if (latestJob.supersededBy) {
    state = "SUPERSEDED";
  }

  // Collect provider attempts from chunks
  const providerAttempts: TenderAnalysisStateDetail["providerAttempts"] = [];
  for (const chunk of chunks) {
    if (chunk.provider) {
      const existing = providerAttempts.find((p) => p.provider === chunk.provider);
      if (!existing) {
        providerAttempts.push({
          provider: chunk.provider,
          status: chunk.status === "SUCCEEDED" ? "SUCCESS" : "FAILED",
        });
      }
    }
  }

  // Determine resumable status
  const resumable = state === "PARTIAL_NEEDS_RESUME" || state === "REGEX_FALLBACK_UNAPPROVED";

  // Generate UI-friendly next action
  let nextAction = "";
  switch (state) {
    case "NOT_STARTED":
      nextAction = "Run AI Analyze to extract requirements and metadata.";
      break;
    case "QUEUED":
      nextAction = "AI Analyze queued. Processing will start shortly.";
      break;
    case "RUNNING":
      nextAction = `Processing: ${succeededChunks}/${totalChunks} chunks completed. Current chunk in progress...`;
      break;
    case "AI_SUCCEEDED":
      nextAction = "Analysis complete. Proceed to Build Submission Plan.";
      break;
    case "PARTIAL_NEEDS_RESUME":
      nextAction = `Resume Analysis: ${succeededChunks}/${totalChunks} chunks done. Click Resume to complete.`;
      break;
    case "REGEX_FALLBACK_UNAPPROVED":
      nextAction =
        "Provider exhausted. Regex fallback available (lower quality). Review and approve with a note, or retry AI Analyze.";
      break;
    case "HUMAN_APPROVED_FALLBACK":
      nextAction = "Fallback analysis approved. Proceed with caution (lower confidence).";
      break;
    case "FAILED":
      nextAction = "Analysis failed. Check provider status and retry, or proceed with manual entry.";
      break;
    case "SUPERSEDED":
      nextAction = "This analysis was replaced by a newer run. Review the latest analysis.";
      break;
  }

  // Safe diagnostic summary (no secrets, no raw errors)
  let safeDiagnosticSummary = "";
  if (latestJob.errorMessage) {
    // Redact API keys and provider details
    const safe = latestJob.errorMessage
      .replace(/sk-[a-z0-9]+/gi, "[KEY]")
      .replace(/api[_-]?key/gi, "[KEY]")
      .slice(0, 200);
    safeDiagnosticSummary = `Last error: ${safe}...`;
  } else {
    safeDiagnosticSummary = `Job status: ${latestJob.status}. Chunks: ${succeededChunks} succeeded, ${failedChunks} failed, ${pendingChunks} pending.`;
  }

  return {
    state,
    latestJobId: latestJob.id,
    canonicalJobId,
    analysisSource,
    startedAt: latestJob.startedAt,
    finishedAt: latestJob.finishedAt,
    successfulProvider: succeededChunks > 0 ? chunks.find((c) => c.status === "SUCCEEDED")?.provider || null : null,
    providerAttempts,
    completedChunks: succeededChunks,
    totalChunks,
    requirementsExtracted: 0, // TODO: query TenderRequirement table
    sourceReferencesCreated: false, // TODO: check if source references exist
    metadataFieldsPersisted: false, // TODO: check if tender metadata is populated
    resumable,
    nextAction,
    safeDiagnosticSummary,
  };
}

/**
 * Check if an analysis state unblocks generation/export.
 * Only AI_SUCCEEDED and HUMAN_APPROVED_FALLBACK allow export.
 */
export function canExportWithAnalysisState(state: AnalysisState): boolean {
  return state === "AI_SUCCEEDED" || state === "HUMAN_APPROVED_FALLBACK";
}

/**
 * Check if analysis can be resumed or retried.
 */
export function canResumeAnalysis(state: AnalysisState): boolean {
  return state === "PARTIAL_NEEDS_RESUME" || state === "REGEX_FALLBACK_UNAPPROVED" || state === "FAILED";
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
  };
  return labels[state] || "Unknown";
}
