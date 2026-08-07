import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import crypto from "crypto";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { computeTenderMutationLockKey } from "../../../../../lib/engine/advisory-lock-key";
import { analyzeWithAI, isAIEnabled, type AnalysisWithMeta, type AIAnalysisResult } from "../../../../../lib/ai";
import { analyzeTender } from "../../../../../lib/engine/analysis";
import { logAction } from "../../../../../lib/audit";
import { invalidateDashboardCache } from "../../../../../lib/dashboard-cache";
import { rateLimit, AI_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../lib/request-id";
import { createNotification } from "../../../../../lib/notifications";
import { assessExtractionQuality } from "../../../../../lib/extraction-quality";
import { deriveExtractionStatus, isExtractionCorrupted, type ExtractionStatus } from "../../../../../lib/engine/extraction-quality-gate";
import { buildCanonicalAnalysisTenderUpdate } from "../../../../../lib/engine/canonical-analysis-update";
import { safeApiError, newDiagnosticId } from "../../../../../lib/engine/safe-api-error";
import { attributeMetadataSourceFileId } from "../../../../../lib/engine/metadata-source-attribution";
import { locateQuoteProvenPage } from "../../../../../lib/engine/page-provenance";
import { buildAnalysisFallbackDiagnostics, formatFallbackDiagnosticsLine, type AnalysisFallbackDiagnostics } from "../../../../../lib/engine/analysis-fallback-diagnostics";
import { buildProviderDiagnosticsSnapshot, getMinCooldownExpiryMs } from "../../../../../lib/ai-provider-health";
import { restoreHealthFromDb, persistAllHealthToDb } from "../../../../../lib/ai-provider-health-db";
import { safeParseJsonObject } from "../../../../../lib/safe-json";
import { redactSecrets } from "../../../../../lib/sanitize-error";
import { buildTenderAnalysisContent, computeAnalysisContentHash } from "../../../../../lib/engine/tender-analysis-content";
// BLOCKER 1: createAnalysisJob import removed — this legacy route may no
// longer create fresh AI_ANALYZE jobs. Only POST /api/tenders/:id/manual-ai-analyze
// has that authority.
import {
  AiAnalyzeCheckpointPersistenceError,
  clearAnalyzeCheckpoints,
  clearAnalyzeCheckpointsForContentHashMismatch,
  getCompletedChunkResults,
  upsertAnalyzeChunkFailed,
  upsertAnalyzeChunkStarted,
  upsertAnalyzeChunkSucceeded,
} from "../../../../../lib/ai-analyze-checkpoints";
import {
  canPromoteToCanonical,
  promoteAnalysisToCanonical,
  stageFallbackDraft,
  stagePartialResult,
} from "../../../../../lib/ai-analyze-promotion";
import { recordAiUsage } from "../../../../../lib/ai-usage-tracker";
import { resolveTenderOperationGate } from "../../../../../lib/engine/tender-operation-gate";
import { syncPersistedTenderFactsToLedger } from "../../../../../lib/engine/tender-facts-ledger-service";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Resolve the per-field metadata source file IDs from the ACTUAL extraction
// evidence: each field is bound to the active file whose extracted text contains
// the field's supporting quote (or null → ungrounded). Previously only
// clientName, submissionMethod, and submissionAddress had quotes to attribute.
// Now title and deadline also carry source quotes (tenderTitleSourceQuote,
// deadlineSourceQuote), and submissionEmail is attributed from its own
// submissionEmailSourceQuote (no longer left null).
function resolveMetadataSourceFileIds(
  aiResult: AIAnalysisResult,
  files: Array<{ id: string; extractedText?: string | null; deletionStatus?: string | null }>,
): {
  clientNameSourceFileId: string | null;
  submissionMethodSourceFileId: string | null;
  submissionAddressSourceFileId: string | null;
  submissionEmailSourceFileId: string | null;
  titleSourceFileId: string | null;
  deadlineSourceFileId: string | null;
} {
  return {
    clientNameSourceFileId: attributeMetadataSourceFileId(aiResult.clientNameSourceQuote, files),
    submissionMethodSourceFileId: attributeMetadataSourceFileId(aiResult.submissionMethodSourceQuote, files),
    submissionAddressSourceFileId: attributeMetadataSourceFileId(aiResult.submissionAddressSourceQuote, files),
    submissionEmailSourceFileId: attributeMetadataSourceFileId(aiResult.submissionEmailSourceQuote, files),
    titleSourceFileId: attributeMetadataSourceFileId(aiResult.tenderTitleSourceQuote, files),
    deadlineSourceFileId: attributeMetadataSourceFileId(aiResult.deadlineSourceQuote, files),
  };
}

/**
 * Guard AI-claimed page numbers using locateQuoteProvenPage with the file's
 * stored TenderFile.totalPages as the authoritative page-count guard.
 *
 * AI can hallucinate page numbers (e.g., page 99 for a 3-page file). Without
 * this guard, the hallucinated page would be persisted to the DB and read by
 * the canonical resolver as if it were proven. This function re-derives the
 * page from the FULL quote's exact position in the attributed file's extracted
 * text via locateQuoteProvenPage (no prefix matching, no offset-0 fallback,
 * ambiguous multi-page occurrences → null).
 *
 * Returns a new aiResult with guarded page numbers (null when the page cannot
 * be proven).
 */
function guardAiPageNumbers(
  aiResult: AIAnalysisResult,
  files: Array<{ id: string; extractedText?: string | null; deletionStatus?: string | null; totalPages?: number | null }>,
  sourceFileIds: { clientNameSourceFileId: string | null; submissionMethodSourceFileId: string | null; submissionAddressSourceFileId: string | null; submissionEmailSourceFileId: string | null; titleSourceFileId: string | null; deadlineSourceFileId: string | null },
): AIAnalysisResult {
  const guarded = { ...aiResult };

  const guardPage = (quote: string | null | undefined, fileId: string | null): number | null => {
    if (!quote || !fileId) return null;
    const file = files.find((f) => f.id === fileId);
    if (!file || !file.extractedText) return null;
    // Canonical quote→page resolver: FULL-quote match (never a prefix), exact
    // normalized→original offset mapping, null when the quote is absent or its
    // occurrences resolve to different pages (ambiguous). Never guesses page 1.
    return locateQuoteProvenPage(file.extractedText, quote, file.totalPages ?? null);
  };

  // Guard each AI-claimed page using the attributed file's totalPages
  if (guarded.tenderTitleSourcePage !== undefined) {
    guarded.tenderTitleSourcePage = guardPage(guarded.tenderTitleSourceQuote, sourceFileIds.titleSourceFileId);
  }
  if (guarded.deadlineSourcePage !== undefined) {
    guarded.deadlineSourcePage = guardPage(guarded.deadlineSourceQuote, sourceFileIds.deadlineSourceFileId);
  }
  if (guarded.clientNameSourcePage !== undefined) {
    guarded.clientNameSourcePage = guardPage(guarded.clientNameSourceQuote, sourceFileIds.clientNameSourceFileId);
  }
  if (guarded.submissionEmailSourcePage !== undefined) {
    guarded.submissionEmailSourcePage = guardPage(guarded.submissionEmailSourceQuote, sourceFileIds.submissionEmailSourceFileId);
  }
  if (guarded.submissionMethodSourcePage !== undefined) {
    guarded.submissionMethodSourcePage = guardPage(guarded.submissionMethodSourceQuote, sourceFileIds.submissionMethodSourceFileId);
  }
  if (guarded.submissionAddressSourcePage !== undefined) {
    guarded.submissionAddressSourcePage = guardPage(guarded.submissionAddressSourceQuote, sourceFileIds.submissionAddressSourceFileId);
  }

  // Guard contactDetailsSource page numbers (e.g., procurementReferenceNumber)
  if (guarded.contactDetailsSource) {
    const guardedContact: Record<string, { page: number | null; quote: string | null; fileId?: string | null }> = {};
    for (const [key, entry] of Object.entries(guarded.contactDetailsSource)) {
      if (entry && entry.quote) {
        // Resolve fileId for this entry's quote
        const entryFileId = attributeMetadataSourceFileId(entry.quote, files);
        const entryPage = guardPage(entry.quote, entryFileId);
        guardedContact[key] = { page: entryPage, quote: entry.quote, fileId: entryFileId };
      } else if (entry) {
        guardedContact[key] = { page: null, quote: entry?.quote ?? null, fileId: null };
      }
    }
    guarded.contactDetailsSource = guardedContact;
  }

  return guarded;
}


/**
 * After AI Analyze writes contactDetailsSourceJson, the
 * procurementReferenceNumber entry has { page, quote } but NO fileId (AI
 * never emits fileIds). Resolve the fileId via attributeMetadataSourceFileId
 * on the quote and update the JSON entry so the reference field can achieve
 * EXTRACTED_AND_GROUNDED status in the canonical resolver.
 *
 * Returns { originalJson, updatedJson } where originalJson is the value read
 * from the DB (used as an optimistic-concurrency guard in the caller's
 * updateMany WHERE clause) and updatedJson is the patched value to write.
 * Returns null when no update is needed (no entry, no quote, or no active
 * file contains the quote).
 *
 * RACE-SAFETY: the caller MUST use prisma.tender.updateMany with
 * `where: { id, contactDetailsSourceJson: originalJson }` so a concurrent
 * AI re-run that wrote a different value between our read and write is
 * NOT silently overwritten. If updateMany affects 0 rows, a concurrent run
 * won — log and skip (the concurrent run's fileId resolution will run on
 * its own read).
 */
async function resolveReferenceFileId(
  tenderId: string,
  files: Array<{ id: string; extractedText?: string | null; deletionStatus?: string | null }>,
): Promise<{ originalJson: string; updatedJson: string } | null> {
  // Read the current contactDetailsSourceJson
  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    select: { contactDetailsSourceJson: true, reference: true },
  }).catch(() => null);
  if (!tender?.contactDetailsSourceJson) return null;
  const originalJson = tender.contactDetailsSourceJson;
  let contactDetails: Record<string, { page?: number | null; quote?: string | null; fileId?: string | null }>;
  try {
    contactDetails = JSON.parse(originalJson);
  } catch {
    return null;
  }
  const refEntry = contactDetails["procurementReferenceNumber"];
  if (!refEntry || !refEntry.quote || refEntry.quote.trim().length < 6) return null;
  // Skip if fileId is already set and points to an active file
  if (refEntry.fileId) {
    const stillActive = files.some((f) => f.id === refEntry.fileId && (f.deletionStatus ?? "ACTIVE") === "ACTIVE");
    if (stillActive) return null;
  }
  const fileId = attributeMetadataSourceFileId(refEntry.quote, files);
  if (!fileId) return null;
  contactDetails["procurementReferenceNumber"] = {
    page: refEntry.page ?? null,
    quote: refEntry.quote,
    fileId,
  };
  return { originalJson, updatedJson: JSON.stringify(contactDetails) };
}

function buildChunkStepResults(meta: AnalysisWithMeta): Array<{
  stepName: string;
  status: string;
  output: string;
}> {
  const results: Array<{ stepName: string; status: string; output: string }> = [];
  for (let i = 0; i < meta.totalChunks; i++) {
    let status: string;
    if (i < meta.completedChunks) {
      status = "SUCCEEDED";
    } else if (meta.skippedChunks > 0 && i >= meta.completedChunks + meta.failedChunks) {
      status = "SKIPPED";
    } else {
      status = "FAILED";
    }
    results.push({
      stepName: `chunk_${i}`,
      status,
      output: JSON.stringify({ chunkIndex: i, providerUsed: meta.chunkProviders[i] ?? null }),
    });
  }
  return results;
}

function parseAiAnalyzeJobOutput(output: string | null | undefined): Record<string, unknown> | null {
  if (!output) return null;
  return safeParseJsonObject(output);
}

function normalizePreviousChunkResults(raw: unknown): Array<{ index: number; result: AIAnalysisResult; provider?: string | null }> {
  if (!Array.isArray(raw)) return [];
  const cleaned: Array<{ index: number; result: AIAnalysisResult; provider?: string | null }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const result = row.result as AIAnalysisResult | undefined;
    if (!Number.isInteger(row.index) || !result || typeof result.summary !== "string" || !Array.isArray(result.requirements)) continue;
    cleaned.push({ index: row.index as number, result, provider: typeof row.provider === "string" ? row.provider : null });
  }
  return cleaned.sort((a, b) => a.index - b.index);
}

type AiAnalyzeFailureOutput = {
  analysisSource?: "AI" | "PARTIAL_AI" | "REGEX_FALLBACK";
  errorMessage?: string;
  status?: "FAILED" | "FALLBACK";
  fallbackDiagnostics?: unknown;
  providerDiagnostics?: unknown;
};

function buildAiAnalyzePartialOutput(
  completed: Array<{ index: number; result: AIAnalysisResult; provider?: string | null }>,
  totalChunks: number,
  contentHash: string,
) {
  const chunkProviders: Array<string | null> = Array(totalChunks).fill(null);
  for (const entry of completed) {
    if (Number.isInteger(entry.index) && entry.index >= 0 && entry.index < totalChunks) {
      chunkProviders[entry.index] = entry.provider ?? null;
    }
  }

  return {
    isPartial: true,
    completedChunks: completed.length,
    totalChunks,
    chunkProviders,
    chunkResults: completed,
    contentHash,
  };
}

async function findLatestResumableAiAnalyzeJob(tenderId: string, userId: string, contentHash: string) {
  const checkpointChunks = await getCompletedChunkResults(tenderId, userId, contentHash);
  if (checkpointChunks.length > 0) {
    const latestJob = await prisma.aiJob.findFirst({
      where: { tenderId, userId, jobType: "AI_ANALYZE", status: { in: ["PARTIAL_SUCCESS", "FAILED", "RUNNING"] } },
      orderBy: [{ finishedAt: "desc" }, { startedAt: "desc" }],
      select: { id: true },
    }).catch(() => null);
    return { id: latestJob?.id ?? null, previousChunkResults: checkpointChunks };
  }

  // Legacy fallback: older partial runs only stored chunkResults in AiJob.output.
  const candidates = await prisma.aiJob.findMany({
    where: { tenderId, userId, jobType: "AI_ANALYZE", status: { in: ["PARTIAL_SUCCESS", "FAILED"] } },
    orderBy: [{ finishedAt: "desc" }, { startedAt: "desc" }],
    take: 10,
    select: { id: true, output: true },
  }).catch(() => []);

  for (const job of candidates) {
    const savedOutput = parseAiAnalyzeJobOutput(job.output);
    if (savedOutput?.contentHash !== contentHash) continue;
    const cachedChunks = normalizePreviousChunkResults(savedOutput.chunkResults);
    if (cachedChunks.length > 0) {
      return { id: job.id, previousChunkResults: cachedChunks };
    }
  }

  return null;
}

async function preserveAiAnalyzeProgressOnFailure(jobId: string, failureData: AiAnalyzeFailureOutput) {
  const currentJob = await prisma.aiJob.findUnique({
    where: { id: jobId },
    select: { output: true },
  }).catch(() => null);
  const existingOutput = parseAiAnalyzeJobOutput(currentJob?.output) ?? {};
  const chunkResults = normalizePreviousChunkResults(existingOutput.chunkResults);
  const hasChunkResults = chunkResults.length > 0;
  const totalChunks = typeof existingOutput.totalChunks === "number" ? existingOutput.totalChunks : undefined;
  const existingProviders = Array.isArray(existingOutput.chunkProviders)
    ? existingOutput.chunkProviders.map((provider) => typeof provider === "string" ? provider : null)
    : undefined;
  const chunkProviders = existingProviders ?? (totalChunks !== undefined
    ? buildAiAnalyzePartialOutput(chunkResults, totalChunks, typeof existingOutput.contentHash === "string" ? existingOutput.contentHash : "").chunkProviders
    : undefined);

  const preservedOutput = {
    ...existingOutput,
    ...(hasChunkResults ? { chunkResults } : {}),
    ...(hasChunkResults ? { completedChunks: Math.max(typeof existingOutput.completedChunks === "number" ? existingOutput.completedChunks : 0, chunkResults.length) } : {}),
    ...(totalChunks !== undefined ? { totalChunks } : {}),
    ...(existingOutput.contentHash !== undefined ? { contentHash: existingOutput.contentHash } : {}),
    ...(chunkProviders !== undefined ? { chunkProviders } : {}),
    ...failureData,
    status: failureData.status ?? "FAILED",
    failedAt: new Date().toISOString(),
    nextAction: hasChunkResults ? "CONTINUE_AI_ANALYZE" : "RETRY_AI_ANALYZE",
  };

  await prisma.aiJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      output: JSON.stringify(preservedOutput),
      errorMessage: failureData.errorMessage,
    },
  }).catch(() => {});
}

const AI_ANALYSIS_TIMEOUT_MS = (() => {
  const raw = Number(process.env.AI_ANALYSIS_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 5_000 && raw <= 600_000) return raw;
  const tier = (process.env.ANTHROPIC_TIER || "").trim();
  // Tier 1 and 2 are Vercel Hobby/basic — hard-kill at 60s, must stay under.
  // Tier 3/4 are Pro/Enterprise with 300s limit.
  // Unknown tier defaults to Hobby-safe 50s so a missing env var never causes a silent 504.
  return tier === "3" || tier === "4" ? 240_000 : 50_000;
})();

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`AI analysis timed out after ${Math.round(ms / 1000)} seconds`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}


type SavedJobOutput = {
  isPartial?: boolean;
  totalChunks?: number;
  completedChunks?: number;
  contentHash?: string;
  chunkResults?: Array<{ index: number; result: unknown; provider?: string | null }>;
};

function parseJobOutput(raw: string | null | undefined): SavedJobOutput | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as SavedJobOutput; } catch { return null; }
}

type ResumeState = {
  startFromChunk: number;
  previousChunkResults: import("../../../../../lib/ai").ChunkResult[];
  existingContentHash: string | undefined;
};

function buildResumeState(savedOutput: SavedJobOutput | null): ResumeState {
  if (!savedOutput) return { startFromChunk: 0, previousChunkResults: [], existingContentHash: undefined };
  const raw = savedOutput.chunkResults ?? [];
  const previousChunkResults = raw
    .filter((r): r is { index: number; result: import("../../../../../lib/ai").AIAnalysisResult; provider?: string | null } =>
      typeof r.index === "number" && r.result != null)
    .sort((a, b) => a.index - b.index);
  const startFromChunk = previousChunkResults.length > 0
    ? 0
    : (typeof savedOutput.completedChunks === "number" ? savedOutput.completedChunks : 0);
  return {
    startFromChunk,
    previousChunkResults,
    existingContentHash: typeof savedOutput.contentHash === "string" ? savedOutput.contentHash : undefined,
  };
}

// SAFE_DEADLINE_MS must stay within maxDuration (60s). On Vercel Hobby the
// platform hard-kills the function at 60s regardless of AI_ANALYSIS_TIMEOUT_MS.
// The outer withTimeout races against AI_ANALYSIS_TIMEOUT_MS but the inner
// deadlineAt caps chunk processing at SAFE_DEADLINE_MS so we always return
// a partial result rather than being killed mid-write.
const SAFE_DEADLINE_MS = Math.min(48_000, (maxDuration - 12) * 1_000);

// ---------------------------------------------------------------------------
// Durable background enqueue — the authoritative production path for AI
// Analyze. The caller is already authenticated as ADMIN/PROPOSAL_MANAGER by
// POST(). Here we verify tender ownership, validate extraction quality, and
// enqueue exactly one durable AI_ANALYZE job via the shared job service.
// Returns 202 { jobId, status: "QUEUED" }.
// ---------------------------------------------------------------------------
async function handleBackgroundEnqueue(
  req: Request,
  userId: string,
  requestId: string,
  params: { id: string },
): Promise<Response> {
  await prismaReady;
  const { id } = params;
  const force = new URL(req.url).searchParams.get("force") === "true";

  // Ownership check — scope the tender to this user. createAnalysisJob repeats
  // this check, but we do it up front so extraction validation never runs on a
  // tender the caller doesn't own.
  const tender = await prisma.tender.findFirst({
    where: { id, userId },
    include: {
      files: { select: { id: true, fileName: true, originalFileName: true, extractedText: true } },
    },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  // ── Operation gate (ANALYSIS) — non-blocking observability ─────────────
  // Same as the synchronous POST handler: surface metadata warnings without
  // blocking. ANALYSIS is never blocked by metadata.
  const bgAnalysisOpGate = resolveTenderOperationGate({
    tender: {
      id: tender.id,
      title: tender.title,
      reference: tender.reference,
      clientName: tender.clientName,
      deadline: tender.deadline,
      submissionMethod: tender.submissionMethod,
      submissionEmails: tender.submissionEmails,
      submissionAddress: tender.submissionAddress,
      country: tender.country,
      metadataContaminated: tender.metadataContaminated,
      analysisExtractionStatus: tender.analysisExtractionStatus,
    },
    requirements: [],
    overrides: [],
    buildPlan: null,
    operation: "ANALYSIS",
  });
  if (bgAnalysisOpGate.warnings.length > 0) {
    logger.info(`[ai-analyze/background] tender=${id} operation-gate warnings: ${bgAnalysisOpGate.warnings.join("; ")}`);
  }
  if (bgAnalysisOpGate.blockers.length > 0) {
    return NextResponse.json({
      error: `AI Analyze (background) blocked by operation gate: ${bgAnalysisOpGate.blockers.join("; ")}`,
      code: "OPERATION_GATE_BLOCKED",
      blockers: bgAnalysisOpGate.blockers,
    }, { status: 422 });
  }

  // Extraction-quality gate BEFORE enqueueing — mirrors the synchronous path so
  // the durable worker never starts on corrupted or too-weak extraction.
  const extractionReports = tender.files.map((file) => ({
    fileName: file.originalFileName || file.fileName,
    quality: assessExtractionQuality(file.extractedText, file.originalFileName || file.fileName),
  }));
  const corrupted = extractionReports.filter((item) => item.quality.corrupted);
  if (corrupted.length > 0) {
    await prisma.tender.update({
      where: { id },
      data: { status: "EXTRACTION_CORRUPTED_AI_SKIPPED", analysisExtractionStatus: "OCR_REQUIRED" },
    }).catch(() => {});
    return NextResponse.json({
      error: "AI analysis skipped: extracted tender text is corrupted/gibberish and requires OCR or re-upload before reliable analysis.",
      code: "EXTRACTION_CORRUPTED_AI_SKIPPED",
      nextAction: "RUN_OCR_OR_UPLOAD_CLEARER_SCAN",
    }, { status: 422 });
  }
  const blockers = extractionReports.filter((item) => item.quality.severity === "FAILED" || item.quality.severity === "POOR");
  if (!force && blockers.length > 0) {
    return NextResponse.json({
      error: "AI analysis blocked: one or more tender files have poor extraction quality.",
      code: "EXTRACTION_NOT_READY",
      nextAction: "OPEN_EXTRACTION_QUALITY",
      blockers,
    }, { status: 422 });
  }

  try {
    // BLOCKER 1: This background path must NOT create a fresh AI_ANALYZE
    // job. Only POST /api/tenders/:id/manual-ai-analyze may create new
    // AI_ANALYZE jobs. This legacy route may only:
    //   - read status
    //   - resume/re-arm the SAME already manually-authorized job
    //   - provide diagnostics
    //
    // If a caller needs a fresh AI Analyze, it must use the manual route.
    // The createAnalysisJob import is retained for type compatibility but
    // is no longer called from this path.
    //
    // Look for an existing manually-authorized job for this tender. If one
    // exists in a resumable state (QUEUED/RUNNING/PARTIAL_SUCCESS/FAILED),
    // re-arm it. If none exists, refuse and direct the caller to the manual
    // route.
    const existingJob = await prisma.aiJob.findFirst({
      where: {
        tenderId: id,
        userId,
        jobType: "AI_ANALYZE",
        status: { in: ["QUEUED", "RUNNING", "PARTIAL_SUCCESS", "FAILED"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, analysisInputHash: true, input: true },
    });

    if (!existingJob) {
      return NextResponse.json({
        error: "No existing AI_ANALYZE job found to resume. Use POST /api/tenders/:id/manual-ai-analyze to create a new analysis.",
        code: "MANUAL_AI_ANALYZE_REQUIRED",
        nextAction: "POST /api/tenders/:id/manual-ai-analyze",
      }, { status: 422 });
    }

    // Verify the existing job has valid manual authority (not a fabricated job).
    let existingInput: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(existingJob.input ?? "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        existingInput = parsed as Record<string, unknown>;
      }
    } catch { /* treat as invalid */ }

    if (
      existingInput.manualRequested !== true ||
      existingInput.source !== "manual-ai-analyze" ||
      typeof existingInput.actorUserId !== "string" ||
      existingInput.actorUserId !== userId
    ) {
      return NextResponse.json({
        error: "Existing AI_ANALYZE job lacks valid manual authority. Use POST /api/tenders/:id/manual-ai-analyze to create a new analysis.",
        code: "MANUAL_AUTHORITY_REQUIRED",
        nextAction: "POST /api/tenders/:id/manual-ai-analyze",
      }, { status: 422 });
    }

    // Re-arm the existing job (reset to QUEUED so the worker can pick it up).
    if (existingJob.status === "QUEUED" || existingJob.status === "RUNNING") {
      // Already active — return it as-is (idempotent).
      return NextResponse.json(
        { jobId: existingJob.id, status: existingJob.status, totalChunks: 0, reused: true },
        { status: 202 },
      );
    }

    // PARTIAL_SUCCESS or FAILED — re-arm for resume.
    await prisma.aiJob.update({
      where: { id: existingJob.id },
      data: { status: "QUEUED", startedAt: null, finishedAt: null, errorMessage: null },
    });

    void logAction({
      userId, action: "AI_ANALYZE", entityType: "Tender", entityId: id,
      description: `Re-armed existing AI analysis for "${tender.title}" (job ${existingJob.id})`,
      metadata: { mode: "background-rearm", jobId: existingJob.id, reused: true },
      requestId,
    }).catch(() => {});

    return NextResponse.json(
      { jobId: existingJob.id, status: "QUEUED", reused: true },
      { status: 202 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const notReady = /too short|not ready/i.test(msg);
    return NextResponse.json({
      error: notReady
        ? "Tender extraction is not ready for analysis yet — re-extract or upload a clearer file first."
        : "Failed to enqueue AI analysis.",
      code: notReady ? "EXTRACTION_NOT_READY" : "ENQUEUE_FAILED",
    }, { status: 422 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  const userId = actor.id;

  const rl = rateLimit(`analyze:${userId}`, AI_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded — too many analysis requests. Please wait a minute and retry.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  // BLOCKER 1: Only POST /api/tenders/:id/manual-ai-analyze may create a
  // NEW AI_ANALYZE job. This legacy route may only:
  //   - mode=background → re-arm an EXISTING manually-authorized job (no fresh creation)
  //   - accept: text/event-stream → refuse (streaming path created fresh jobs; removed)
  //   - default (synchronous) → refuse (sync path created fresh jobs; removed)
  //
  // The streaming and synchronous paths previously created fresh AI_ANALYZE
  // jobs via prisma.aiJob.create() — that authority is removed. Callers
  // who need a fresh analysis must use the manual route.
  if (new URL(req.url).searchParams.get("mode") === "background") {
    return handleBackgroundEnqueue(req, userId, requestId, await params);
  }

  const wantsStream = req.headers.get("accept") === "text/event-stream";
  if (wantsStream) {
    // BLOCKER 1: The streaming path previously created fresh AI_ANALYZE jobs.
    // That authority is removed. Direct callers to the manual route.
    return NextResponse.json({
      error: "Streaming AI Analyze is no longer supported for fresh job creation. Use POST /api/tenders/:id/manual-ai-analyze to create a new analysis, then poll /api/ai-jobs/:jobId for status.",
      code: "MANUAL_AI_ANALYZE_REQUIRED",
      nextAction: "POST /api/tenders/:id/manual-ai-analyze",
    }, { status: 422 });
  }

  // BLOCKER 1: The default synchronous path previously created fresh AI_ANALYZE
  // jobs via prisma.aiJob.create(). That authority is removed. Direct callers
  // to the manual route.
  return NextResponse.json({
    error: "Synchronous AI Analyze is no longer supported for fresh job creation. Use POST /api/tenders/:id/manual-ai-analyze to create a new analysis.",
    code: "MANUAL_AI_ANALYZE_REQUIRED",
    nextAction: "POST /api/tenders/:id/manual-ai-analyze",
  }, { status: 422 });
}
