// Canonical AI Analyze state resolver.
//
// Single source of truth for tender analysis state logic.
//
// ARCHITECTURE: This file contains ONLY pure logic and types.
// The DB-querying adapter lives in lib/engine/analysis-state-resolver.ts (bottom)
// and is also used by lib/engine/analysis/tender-analysis-resolver.ts.

import { prisma as globalPrisma } from "@/lib/prisma";

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
  | "SUPERSEDED";              // Older analysis replaced by newer job

export interface TenderAnalysisStateDetail {
  state: AnalysisState;
  latestJobId: string | null;
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
  sourceReferencesCreated: boolean;
  metadataFieldsPersisted: boolean;
  resumable: boolean;
  nextAction: string;
  safeDiagnosticSummary: string;
}

export interface ResolverJobInput {
  id: string;
  status: string;
  analysisInputHash: string | null;
  stagedMergedResult: string | null;
  promotedAt: Date | null;
  supersededBy: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorMessage: string | null;
}

export interface ResolverChunkInput {
  status: string;
  provider: string | null;
  totalChunks: number;
}

export interface DeriveAnalysisStateInput {
  latestJob: ResolverJobInput | null;
  promotedJob: ResolverJobInput | null;
  latestChunks: ResolverChunkInput[];
  promotedChunks: ResolverChunkInput[];
  legacyNotesAiAnalyzed: boolean;
  requirementsExtracted: number;
  sourceReferencesCreated: boolean;
  metadataFieldsPersisted: boolean;
}

function redactSafe(message: string): string {
  return message
    .replace(/(sk-ant-api-[a-zA-Z0-9_-]{12,})/g, "[KEY]")
    .replace(/(sk-or-v1-[a-zA-Z0-9_-]{12,})/g, "[KEY]")
    .replace(/(sk-[a-zA-Z0-9]{12,})/g, "[KEY]")
    .replace(/(gsk_[a-zA-Z0-9]{12,})/g, "[KEY]")
    .replace(/(dsk-[a-zA-Z0-9]{12,})/g, "[KEY]")
    .replace(/(AIza[0-9A-Za-z-_]{12,})/g, "[KEY]")
    .replace(/(AQ[a-zA-Z0-9]{12,})/g, "[KEY]")
    .replace(/(Bearer\s+[a-zA-Z0-9._-]{12,})/g, "Bearer [REDACTED]")
    .replace(/(authorization:\s+Bearer\s+[a-zA-Z0-9._-]{12,})/gi, "authorization: Bearer [REDACTED]")
    .replace(/(api_key=[a-zA-Z0-9]{1,})/gi, "api_key=[REDACTED]");
}

function parseStagedSource(mergedResult: string | null): string | null {
  if (!mergedResult) return null;
  try {
    const parsed = JSON.parse(mergedResult);
    return parsed.analysisSource ?? null;
  } catch { return null; }
}

export function deriveAnalysisStateDetail(input: DeriveAnalysisStateInput): TenderAnalysisStateDetail {
  const {
    latestJob, promotedJob, latestChunks, promotedChunks,
    legacyNotesAiAnalyzed, requirementsExtracted,
    sourceReferencesCreated, metadataFieldsPersisted
  } = input;

  const defaultResult: TenderAnalysisStateDetail = {
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

  if (!latestJob) {
    if (legacyNotesAiAnalyzed) {
      return {
        ...defaultResult,
        state: "AI_SUCCEEDED",
        analysisSource: "LEGACY_NOTES",
        nextAction: "Legacy analysis detected. Re-run AI Analyze for current extraction quality.",
        safeDiagnosticSummary: "Analysis was performed with a prior version of the extraction engine. Consider re-analyzing.",
      };
    }
    return defaultResult;
  }

  const isRunningOrQueued = latestJob.status === "RUNNING" || latestJob.status === "QUEUED";
  const chunksToTally = (isRunningOrQueued || !promotedJob) ? latestChunks : promotedChunks;
  const jobToTally = (isRunningOrQueued || !promotedJob) ? latestJob : promotedJob;

  const totalChunks = chunksToTally.length > 0 ? chunksToTally[0].totalChunks : 0;
  const succeededChunks = chunksToTally.filter((c) => c.status === "SUCCEEDED").length;
  const failedChunks = chunksToTally.filter((c) => c.status === "FAILED").length;
  const pendingChunks = chunksToTally.filter((c) => c.status === "QUEUED" || c.status === "RUNNING").length;

  const providerMap = new Map<string, { successes: number; failures: number }>();
  for (const chunk of latestChunks) {
    if (!chunk.provider) continue;
    const stats = providerMap.get(chunk.provider) ?? { successes: 0, failures: 0 };
    if (chunk.status === "SUCCEEDED") stats.successes++;
    else if (chunk.status === "FAILED") stats.failures++;
    providerMap.set(chunk.provider, stats);
  }
  const providerAttempts = Array.from(providerMap.entries()).map(([provider, stats]) => ({
    provider,
    status: (stats.successes > 0 ? "SUCCESS" : "FAILED") as "SUCCESS" | "FAILED",
    successes: stats.successes,
    failures: stats.failures,
  }));

  const successfulProvider = chunksToTally.find((c) => c.status === "SUCCEEDED")?.provider ?? null;
  const stagedSource = parseStagedSource(latestJob.stagedMergedResult);

  let state: AnalysisState;
  let analysisSource: "AI" | "REGEX_FALLBACK" | "LEGACY_NOTES" | "NONE";

  if (latestJob.supersededBy) {
    state = "SUPERSEDED";
    analysisSource = "AI";
  } else if (latestJob.status === "RUNNING" || (latestJob.status === "QUEUED" && pendingChunks > 0)) {
    state = "RUNNING";
    analysisSource = "AI";
  } else if (latestJob.status === "QUEUED") {
    state = "QUEUED";
    analysisSource = "AI";
  } else {
     if (promotedJob && promotedJob.status === "SUCCEEDED" && latestJob.status !== "RUNNING") {
        state = "AI_SUCCEEDED";
        analysisSource = "AI";
     } else if (latestJob.status === "SUCCEEDED") {
        if (totalChunks > 0 && pendingChunks > 0) {
            state = "PARTIAL_NEEDS_RESUME";
            analysisSource = "AI";
        } else if (totalChunks === 0 || succeededChunks === totalChunks) {
            state = "AI_SUCCEEDED";
            analysisSource = "AI";
        } else {
            state = "PARTIAL_NEEDS_RESUME";
            analysisSource = "AI";
        }
     } else if (latestJob.status === "PARTIAL_SUCCESS" || stagedSource === "PARTIAL_AI") {
        state = "PARTIAL_NEEDS_RESUME";
        analysisSource = "AI";
     } else if (stagedSource === "FALLBACK_DRAFT") {
        if (latestJob.promotedAt) {
            state = "HUMAN_APPROVED_FALLBACK";
            analysisSource = "REGEX_FALLBACK";
        } else {
            state = "REGEX_FALLBACK_UNAPPROVED";
            analysisSource = "REGEX_FALLBACK";
        }
     } else {
        state = "FAILED";
        analysisSource = "NONE";
     }
  }

  const canonicalJobId = promotedJob?.id ?? (latestJob.status === "SUCCEEDED" ? latestJob.id : null);
  const resumable = state === "PARTIAL_NEEDS_RESUME" || state === "REGEX_FALLBACK_UNAPPROVED" || state === "FAILED";

  const nextActions: Record<AnalysisState, string> = {
    NOT_STARTED: "Run AI Analyze to extract requirements and metadata.",
    QUEUED: "AI Analyze queued. Processing will start shortly.",
    RUNNING: `Processing: ${succeededChunks}/${totalChunks} chunks completed. Current chunk in progress...`,
    AI_SUCCEEDED: "Analysis complete. Proceed to Build Submission Plan.",
    PARTIAL_NEEDS_RESUME: `Resume Analysis: ${succeededChunks}/${totalChunks} chunks done. Click Resume to complete.`,
    REGEX_FALLBACK_UNAPPROVED: "Provider exhausted. Regex fallback available (lower quality). Review and approve with a note, or retry AI Analyze.",
    HUMAN_APPROVED_FALLBACK: "Fallback analysis approved. Proceed with caution (lower confidence).",
    FAILED: "Analysis failed. Check provider status and retry, or proceed with manual entry.",
    SUPERSEDED: "This analysis was replaced by a newer run. Review the latest analysis.",
  };

  let safeDiagnosticSummary: string;
  if (state === "AI_SUCCEEDED" && promotedJob && latestJob.id !== promotedJob.id && latestJob.status === "FAILED") {
    safeDiagnosticSummary = `Using prior successful analysis (${promotedJob.id}). Latest attempt failed: ${latestJob.errorMessage ? redactSafe(latestJob.errorMessage) : "Unknown error"}`;
  } else if (latestJob.errorMessage && (state === "FAILED" || state === "REGEX_FALLBACK_UNAPPROVED" || (state === "PARTIAL_NEEDS_RESUME" && latestJob.status === "FAILED"))) {
    safeDiagnosticSummary = `Last attempt error: ${redactSafe(latestJob.errorMessage)}`;
  } else {
    safeDiagnosticSummary = `Job status: ${latestJob.status}. Chunks: ${succeededChunks} succeeded, ${failedChunks} failed, ${pendingChunks} pending.`;
  }

  return {
    state, latestJobId: latestJob.id, canonicalJobId, analysisSource,
    startedAt: jobToTally.startedAt, finishedAt: jobToTally.finishedAt,
    successfulProvider, providerAttempts, completedChunks: succeededChunks, totalChunks,
    requirementsExtracted, sourceReferencesCreated, metadataFieldsPersisted,
    resumable, nextAction: nextActions[state], safeDiagnosticSummary,
  };
}

export async function resolveTenderAnalysisState(prisma: any, tenderId: string, userId: string): Promise<TenderAnalysisStateDetail> {
  const db = prisma || globalPrisma;
  const [latestJob, promotedJob] = await Promise.all([
    db.aiJob?.findFirst ? db.aiJob.findFirst({ where: { tenderId, userId, jobType: AI_ANALYZE_JOB_TYPE }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, analysisInputHash: true, stagedMergedResult: true, promotedAt: true, supersededBy: true, startedAt: true, finishedAt: true, errorMessage: true } }).catch(() => null) : Promise.resolve(null),
    db.aiJob?.findFirst ? db.aiJob.findFirst({ where: { tenderId, userId, jobType: AI_ANALYZE_JOB_TYPE, promotedAt: { not: null }, supersededBy: null }, orderBy: { promotedAt: "desc" }, select: { id: true, status: true, analysisInputHash: true, stagedMergedResult: true, promotedAt: true, supersededBy: true, startedAt: true, finishedAt: true, errorMessage: true } }).catch(() => null) : Promise.resolve(null)
  ]);
  const [requirementsExtracted, sourceReferencesCreated, tender] = await Promise.all([
    db.tenderRequirement?.count ? db.tenderRequirement.count({ where: { tenderId } }).catch(() => 0) : Promise.resolve(0),
    db.tenderRequirement?.count ? db.tenderRequirement.count({ where: { tenderId, OR: [{ sourceTenderFileId: { not: null } }, { sourcePageNumber: { not: null } }, { sourceExactQuote: { not: null } }] } }).then((n: number) => n > 0).catch(() => false) : Promise.resolve(false),
    db.tender?.findUnique ? db.tender.findUnique({ where: { id: tenderId }, select: { notes: true, clientName: true, deadline: true, submissionMethod: true } }).catch(() => null) : Promise.resolve(null),
  ]);
  const metadataFieldsPersisted = Boolean(tender?.clientName && (tender?.deadline || tender?.submissionMethod));
  const legacyNotesAiAnalyzed = !latestJob && Boolean(tender?.notes && /analysis\s+source.*ai/i.test(tender.notes));
  let latestChunks: ResolverChunkInput[] = [];
  if (latestJob?.analysisInputHash && db.aiAnalyzeChunk?.findMany) {
    latestChunks = await db.aiAnalyzeChunk.findMany({ where: { tenderId, userId, contentHash: latestJob.analysisInputHash }, select: { status: true, provider: true, totalChunks: true } }).catch(() => []) ?? [];
  }
  let promotedChunks: ResolverChunkInput[] = [];
  if (promotedJob && promotedJob.id !== latestJob?.id && promotedJob.analysisInputHash && db.aiAnalyzeChunk?.findMany) {
    promotedChunks = await db.aiAnalyzeChunk.findMany({ where: { tenderId, userId, contentHash: promotedJob.analysisInputHash }, select: { status: true, provider: true, totalChunks: true } }).catch(() => []) ?? [];
  } else if (promotedJob && latestJob && promotedJob.id === latestJob.id) {
    promotedChunks = latestChunks;
  }
  return deriveAnalysisStateDetail({ latestJob, promotedJob, latestChunks, promotedChunks, legacyNotesAiAnalyzed, requirementsExtracted, sourceReferencesCreated, metadataFieldsPersisted });
}

export function canExportWithAnalysisState(state: AnalysisState): boolean {
  return state === "AI_SUCCEEDED" || state === "HUMAN_APPROVED_FALLBACK";
}

export function canResumeAnalysis(state: AnalysisState): boolean {
  return state === "PARTIAL_NEEDS_RESUME" || state === "REGEX_FALLBACK_UNAPPROVED" || state === "FAILED";
}

export function analysisStateLabel(state: AnalysisState): string {
  const labels: Record<AnalysisState, string> = {
    NOT_STARTED: "Not Started", QUEUED: "Queued", RUNNING: "Running",
    AI_SUCCEEDED: "Analysis Complete", PARTIAL_NEEDS_RESUME: "Partial (Resume)",
    REGEX_FALLBACK_UNAPPROVED: "Fallback (Unapproved)", HUMAN_APPROVED_FALLBACK: "Fallback (Approved)",
    FAILED: "Failed", SUPERSEDED: "Superseded",
  };
  return labels[state];
}
