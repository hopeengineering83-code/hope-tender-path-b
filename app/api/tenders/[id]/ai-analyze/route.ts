import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import crypto from "crypto";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { analyzeWithAI, isAIEnabled, type AnalysisWithMeta, type AIAnalysisResult } from "../../../../../lib/ai";
import { analyzeTender } from "../../../../../lib/engine/analysis";
import { logAction } from "../../../../../lib/audit";
import { invalidateDashboardCache } from "../../../../../lib/dashboard-cache";
import { rateLimit, AI_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../lib/request-id";
import { createNotification } from "../../../../../lib/notifications";
import { assessExtractionQuality } from "../../../../../lib/extraction-quality";
import { deriveExtractionStatus, isExtractionCorrupted, type ExtractionStatus, type TenderFileQuality } from "../../../../../lib/engine/extraction-quality-gate";
import { buildCanonicalAnalysisTenderUpdate } from "../../../../../lib/engine/canonical-analysis-update";
import { buildAnalysisFallbackDiagnostics, formatFallbackDiagnosticsLine, type AnalysisFallbackDiagnostics } from "../../../../../lib/engine/analysis-fallback-diagnostics";
import { buildProviderDiagnosticsSnapshot, getMinCooldownExpiryMs } from "../../../../../lib/ai-provider-health";
import { restoreHealthFromDb, persistAllHealthToDb } from "../../../../../lib/ai-provider-health-db";
import { safeParseJsonObject } from "../../../../../lib/safe-json";
import { buildTenderAnalysisContent, computeAnalysisContentHash } from "../../../../../lib/engine/tender-analysis-content";
import { executeAnalysis } from "../../../../../lib/engine/analysis-orchestrator";
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

export const maxDuration = 60;
export const dynamic = "force-dynamic";

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
// SSE streaming helper — runs the same analysis logic but emits progress
// events over a text/event-stream response so the browser can show real-time
// progress instead of waiting 30-60s for a single JSON response.
// ---------------------------------------------------------------------------
async function handleStreamingAnalyze(
  req: Request,
  userId: string,
  requestId: string,
  params: { id: string },
): Promise<Response> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function emit(event: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // controller may already be closed if the client disconnected
        }
      }

      try {
        emit({ phase: "starting", message: "Preparing tender content for analysis…" });

        const { id } = params;
        const reqUrl = new URL(req.url);
        const force = reqUrl.searchParams.get("force") === "true";
        const continueJobIdParam = reqUrl.searchParams.get("continue");
        let continueJobId: string | null = continueJobIdParam;
        let startFromChunk: number | undefined;
        let existingContentHash: string | undefined;
        let previousChunkResults: Array<{ index: number; result: AIAnalysisResult; provider?: string | null }> = [];

        await prismaReady;

        if (continueJobId) {
          // Explicit resume: load the chunk results from the referenced job so
          // analyzeWithAI can skip already-completed chunks.
          const existingJob = await prisma.aiJob.findFirst({
            where: { id: continueJobId, tenderId: id, userId },
          });
          const resumeState = buildResumeState(parseJobOutput(existingJob?.output));
          previousChunkResults = resumeState.previousChunkResults;
          startFromChunk = resumeState.startFromChunk;
          existingContentHash = resumeState.existingContentHash;
        }

        const [tender, company] = await Promise.all([
          prisma.tender.findFirst({
            where: { id, userId },
            include: {
              files: {
                select: {
                  id: true, fileName: true, originalFileName: true, mimeType: true, size: true,
                  classification: true, extractedText: true, createdAt: true,
                  totalPages: true, extractedPages: true, ocrPages: true, failedPages: true,
                  extractionScore: true, extractionMethod: true,
                },
              },
            },
          }),
          prisma.company.findUnique({
            where: { userId },
            include: { documents: { select: { category: true, originalFileName: true, extractedText: true }, take: 5, orderBy: { createdAt: "desc" } } },
          }),
        ]);

        if (!tender) {
          emit({ phase: "error", message: "Tender not found" });
          controller.close();
          return;
        }
        const tenderRecord = tender;
        // Pre-build the set of real TenderFile IDs so we can validate the
        // AI-returned sourceFileToken before storing it as sourceTenderFileId.
        // The AI prompt embeds [FILE_ID:{uuid}] markers and asks the model to
        // copy the exact UUID, but LLMs sometimes return garbled values or file
        // names instead. Storing a garbage ID would make the export-readiness
        // SOURCE_REFERENCES_MISSING gate pass when it should block.
        const validTenderFileIds = new Set(tenderRecord.files.map((f) => f.id));

        const extractionReports = tenderRecord.files.map((file) => ({
          fileName: file.originalFileName || file.fileName,
          quality: assessExtractionQuality(file.extractedText, file.originalFileName || file.fileName),
        }));
        const corruptedExtractionReports = extractionReports.filter((item) => item.quality.corrupted);
        if (corruptedExtractionReports.length > 0) {
          await prisma.tender.update({
            where: { id },
            data: { status: "EXTRACTION_CORRUPTED_AI_SKIPPED", analysisExtractionStatus: "OCR_REQUIRED" },
          }).catch((e: unknown) => {
            logger.error("[ai-analyze/stream] failed to persist EXTRACTION_CORRUPTED_AI_SKIPPED status:", { detail: e instanceof Error ? e.message : String(e) });
          });
          emit({ phase: "error", message: "AI analysis skipped: extracted tender text is corrupted/gibberish and requires OCR or re-upload before reliable analysis.", code: "EXTRACTION_CORRUPTED_AI_SKIPPED" });
          controller.close();
          return;
        }

        const extractionBlockers = extractionReports.filter((item) => item.quality.severity === "FAILED" || item.quality.severity === "POOR");
        if (!force && extractionBlockers.length > 0) {
          emit({ phase: "error", message: "AI analysis blocked: one or more tender files have poor extraction quality.", code: "EXTRACTION_NOT_READY" });
          controller.close();
          return;
        }

        const textSamples = tenderRecord.files
          .map((f) => f.extractedText)
          .filter((t): t is string => Boolean(t && t.trim().length > 20));
        const isTextCorrupted = textSamples.length > 0 && textSamples.some((t) => isExtractionCorrupted(t));
        if (!force && isTextCorrupted) {
          emit({ phase: "error", message: "AI analysis blocked — extracted text is corrupted", code: "EXTRACTION_CORRUPTED_AI_SKIPPED" });
          controller.close();
          return;
        }

        const fileCount = tenderRecord.files.length;
        emit({ phase: "extracting", message: `Extracting text from ${fileCount} file${fileCount === 1 ? "" : "s"}…`, fileCount });

        // Shared builder — IDENTICAL content + hash to the non-streaming path
        // and the durable job service, so all execution paths share one
        // chunk-state identity.
        const tenderContent = buildTenderAnalysisContent(tenderRecord, company);
        const contentHash = computeAnalysisContentHash(tenderContent);
        if (force) {
          await clearAnalyzeCheckpoints(id, userId, contentHash);
        } else {
          await clearAnalyzeCheckpointsForContentHashMismatch(id, userId, contentHash);
          const durableChunks = await getCompletedChunkResults(id, userId, contentHash);
          if (durableChunks.length > 0) {
            previousChunkResults = durableChunks;
            startFromChunk = 0;
            existingContentHash = contentHash;
          }
        }
        if (!continueJobId && !force) {
          const resumableJob = await findLatestResumableAiAnalyzeJob(id, userId, contentHash);
          if (resumableJob) {
            continueJobId = resumableJob.id;
            previousChunkResults = resumableJob.previousChunkResults;
            startFromChunk = 0;
            existingContentHash = contentHash;
          }
        }
        if (existingContentHash && existingContentHash !== contentHash) {
          // Tender content changed since the partial run — restart from scratch.
          startFromChunk = undefined;
          previousChunkResults = [];
          continueJobId = null;
        }

        // Clean up stale RUNNING jobs
        await prisma.aiJob.updateMany({
          where: {
            tenderId: id, userId, jobType: "AI_ANALYZE", status: "RUNNING",
            startedAt: { lt: new Date(Date.now() - 90_000) },
          },
          data: { status: "FAILED", finishedAt: new Date(), errorMessage: "Timed out (cleaned up by subsequent request)" },
        }).catch(() => {});

        const runId = crypto.randomUUID();
        // analysisVersion is assigned by the PostgreSQL sequence (BIGSERIAL) —
        // no application-level version needed; DB guarantees strict ordering.

        let analysisJob: { id: string } | null = null;
        try {
          // Use a transaction to prevent race condition where two concurrent requests
          // both create AI jobs at the same time. Check for any active/recent RUNNING job
          // inside the transaction to ensure serial execution of job creation.
          analysisJob = await prisma.$transaction(async (tx) => {
            // Within the transaction, check if a RUNNING job already exists for this tender/user/jobType
            const existingRunning = await tx.aiJob.findFirst({
              where: {
                tenderId: id,
                userId,
                jobType: "AI_ANALYZE",
                status: "RUNNING",
                startedAt: { gt: new Date(Date.now() - 60_000) }, // Started in last 60s
              },
              select: { id: true },
            });

            // If a RUNNING job was started in the last 60s, return it instead of creating a duplicate
            if (existingRunning) {
              logger.warn(`[ai-analyze/stream] Concurrent AI job detected (${existingRunning.id}), reusing existing job instead of creating duplicate`);
              return existingRunning;
            }

            // No concurrent job exists, safe to create a new one
            return await tx.aiJob.create({
              data: {
                tenderId: id, userId, jobType: "AI_ANALYZE", status: "RUNNING", startedAt: new Date(),
                input: JSON.stringify({ contentLength: tenderContent.length, chunkCount: Math.ceil(tenderContent.length / 50_000), contentHash }),
              },
              select: { id: true },
            });
          }, { isolationLevel: "Serializable", timeout: 5_000 });
        } catch (jobCreateErr) {
          if (jobCreateErr instanceof Error && jobCreateErr.message.includes("timeout")) {
            logger.warn("[ai-analyze/stream] Transaction timeout creating AI job — another request may be running analysis concurrently. Continuing with analysis...");
          } else {
            logger.warn("[ai-analyze/stream] Failed to create AiJob record:", { detail: jobCreateErr instanceof Error ? jobCreateErr.message : String(jobCreateErr) });
          }
        }

        await Promise.race([
          restoreHealthFromDb(),
          new Promise<void>((r) => setTimeout(r, 2_000)),
        ]).catch(() => {});

        // Estimate total chunks for progress reporting
        const estimatedChunks = Math.max(1, Math.ceil(tenderContent.length / 50_000));
        const initialChunk = Math.min((startFromChunk ?? 0) + 1, estimatedChunks);
        emit({ phase: "analyzing", chunk: initialChunk, totalChunks: estimatedChunks, resumedFromChunk: startFromChunk ?? 0, message: startFromChunk ? `Resuming at chunk ${initialChunk} of ${estimatedChunks}…` : `Analyzing chunk 1 of ${estimatedChunks}…` });

        // Wrap analyzeWithAI to emit per-chunk progress events.
        // analyzeWithAI processes chunks in parallel (limit 3); we emit real
        // events as each chunk starts and completes — never an estimated
        // timer — so the UI progress reflects persisted chunk state only.
        let progressTimer: ReturnType<typeof setInterval> | null = null;

        let aiMeta: AnalysisWithMeta;
        let analysisResult: {
          ai: boolean; fallback: boolean;
          analysisSource?: "AI" | "PARTIAL_AI" | "REGEX_FALLBACK";
          summary: string; requirementCount: number;
          fallbackDiagnostics?: ReturnType<typeof buildAnalysisFallbackDiagnostics>;
          providerDiagnostics?: ReturnType<typeof buildProviderDiagnosticsSnapshot>;
          nextAction?: string;
        };
        let analysisJobId: string | null = null;
        let analysisMeta: AnalysisWithMeta | null = null;

        if (isAIEnabled()) {
          const onChunkStart = async ({ chunkIndex, totalChunks }: { chunkIndex: number; totalChunks: number }) => {
            emit({
              phase: "analyzing",
              chunk: chunkIndex + 1,
              totalChunks,
              message: `Starting analysis of chunk ${chunkIndex + 1} of ${totalChunks}…`,
            });
            await upsertAnalyzeChunkStarted({ tenderId: id, userId, contentHash, chunkIndex, totalChunks }).catch((e: unknown) => {
              logger.error("[ai-analyze/stream] checkpoint start write failed — chunk resume may retry this chunk:", { detail: e instanceof Error ? e.message : String(e) });
            });
          };
          const onChunkComplete = async ({
            completed,
            totalChunks,
            chunkIndex,
            result,
            provider,
          }: {
            completed: Array<{ index: number; result: AIAnalysisResult; provider?: string | null }>;
            totalChunks: number;
            chunkIndex?: number;
            result?: AIAnalysisResult;
            provider?: string | null;
          }) => {
            if (typeof chunkIndex === "number" && result) {
              emit({
                phase: "analyzing",
                chunk: chunkIndex + 1,
                totalChunks,
                message: `Completed chunk ${chunkIndex + 1} of ${totalChunks}${provider ? ` using ${provider}` : ""}.`,
              });
              await upsertAnalyzeChunkSucceeded({ tenderId: id, userId, contentHash, chunkIndex, totalChunks, result, provider }).catch((e: unknown) => {
                logger.error("[ai-analyze/stream] checkpoint succeeded write failed — chunk resume may retry this chunk:", { detail: e instanceof Error ? e.message : String(e) });
              });
            }
            if (analysisJob) {
              await prisma.aiJob.update({
                where: { id: analysisJob.id },
                data: {
                  output: JSON.stringify(buildAiAnalyzePartialOutput(completed, totalChunks, contentHash)),
                },
              }).catch((e: unknown) => {
                logger.error("[ai-analyze/stream] AiJob partial output update failed (non-critical):", { detail: e instanceof Error ? e.message : String(e) });
              });
            }
          };
          const onChunkFailure = async ({
            chunkIndex,
            totalChunks,
            errorMessage,
            provider,
          }: { chunkIndex: number; totalChunks: number; errorMessage: string; provider?: string | null }) => {
            emit({
              phase: "analyzing_error",
              chunk: chunkIndex + 1,
              totalChunks,
              message: `Chunk ${chunkIndex + 1} failed: ${errorMessage.slice(0, 100)}`,
            });
            await upsertAnalyzeChunkFailed({ tenderId: id, userId, contentHash, chunkIndex, totalChunks, errorMessage, provider }).catch((e: unknown) => {
              logger.error("[ai-analyze/stream] checkpoint failed write failed — chunk may be retried on resume:", { detail: e instanceof Error ? e.message : String(e) });
            });
          };
          try {
            const deadlineAt = Date.now() + SAFE_DEADLINE_MS;
            try {
              aiMeta = await withTimeout(
                analyzeWithAI(tenderContent, {
                  deadlineAt,
                  startFromChunk,
                  previousChunkResults,
                  onChunkStart,
                  onChunkComplete,
                  onChunkFailure,
                  // OBS-004 — fire-and-forget per-tenant AI usage tracking.
                  onProviderAttempt: (provider, success, latencyMs, failureCategory) => {
                    void recordAiUsage({
                      userId,
                      tenderId: id,
                      provider,
                      useCase: "extraction",
                      latencyMs,
                      success,
                      failureCategory: failureCategory ?? null,
                    });
                  },
                }),
                AI_ANALYSIS_TIMEOUT_MS,
              );
            } catch (aiErr) {
              if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
              if (analysisJob) {
                const errMsg = aiErr instanceof Error ? aiErr.message : String(aiErr);
                const safeErrMsg = errMsg.replace(/sk-[a-zA-Z0-9_-]{10,}/g, "[KEY_REDACTED]").replace(/AIza[a-zA-Z0-9_-]{30,}/g, "[KEY_REDACTED]").replace(/Bearer\s+[a-zA-Z0-9._-]{10,}/gi, "Bearer [REDACTED]").slice(0, 300);
                await preserveAiAnalyzeProgressOnFailure(analysisJob.id, {
                  analysisSource: "REGEX_FALLBACK",
                  errorMessage: safeErrMsg,
                  status: "FAILED",
                });
              }
              throw aiErr;
            }
            if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }

            const aiResult = aiMeta.result;

            emit({ phase: "saving", message: "Saving analysis results…" });

            // Derive effective extraction method from the uploaded files so each
            // requirement row carries source-traceability for how its text was obtained.
            const effectiveExtractionMethod: string = tenderRecord.files.some(
              (f: { extractionMethod?: string | null; ocrPages?: number | null }) =>
                f.extractionMethod === "ocr" || (f.ocrPages != null && f.ocrPages > 0),
            ) ? "ocr" : "text";

            if (aiMeta.isPartial) {
              // Non-destructive: stage partial result without touching canonical tender data.
              if (analysisJob) {
                await stagePartialResult(analysisJob.id, {
                  requirements: aiResult.requirements,
                  summary: aiResult.summary,
                  chunkResults: aiMeta.chunkResults,
                  contentHash,
                  isPartial: true,
                  completedChunks: aiMeta.completedChunks,
                  totalChunks: aiMeta.totalChunks,
                });
              }
            } else if (await canPromoteToCanonical(analysisJob?.id ?? null, id)) {
              // Full success: promote atomically to canonical. The full
              // client/submission/source-traceability mapping + contamination
              // detection lives in the shared builder so all three analysis
              // paths persist identical canonical metadata.
              const { data: canonicalTenderData } = buildCanonicalAnalysisTenderUpdate(aiResult, {
                clientName: tenderRecord.clientName,
                submissionMethod: tenderRecord.submissionMethod,
                submissionEmails: tenderRecord.submissionEmails,
                notes: tenderRecord.notes,
              });

              // Atomic TOCTOU guard: re-verify inside the transaction that no newer
              // AiJob was created between the outer canPromoteToCanonical check above
              // and this write. If superseded, the tx returns without any writes.
              let streamPromoSuperseded = false;
              await prisma.$transaction(async (tx) => {
                // Serialize all promotion attempts for this tender. The advisory
                // lock prevents a concurrent run from inserting a higher-version
                // AiJob between our version check and the canonical writes.
                await tx.$queryRaw`SELECT pg_advisory_xact_lock(1, hashtext(${id}))`;
                if (analysisJob) {
                  const currentVer = await tx.aiJob.findUnique({
                    where: { id: analysisJob.id },
                    select: { analysisVersion: true },
                  });
                  const newerExists = !currentVer || await tx.aiJob.findFirst({
                    where: { tenderId: id, jobType: "AI_ANALYZE", id: { not: analysisJob.id }, analysisVersion: { gt: currentVer.analysisVersion } },
                    select: { id: true },
                  });
                  if (newerExists) { streamPromoSuperseded = true; return; }
                }
                await tx.tenderRequirement.deleteMany({ where: { tenderId: id } });
                for (const req of aiResult.requirements) {
                  await tx.tenderRequirement.create({
                    data: {
                      tenderId: id, title: req.title, description: req.description,
                      requirementType: req.requirementType, priority: req.priority,
                      exactFileName: req.exactFileName ?? null, requiredQuantity: req.requiredQuantity ?? null,
                      pageLimit: req.pageLimit ?? null, restrictions: req.restrictions ?? null,
                      sectionReference: req.sectionReference ?? null,
                      sourceSectionHeading: req.sourceSectionHeading || req.sectionReference || null,
                      sourcePageNumber: req.sourcePage ?? null, sourceExactQuote: req.sourceQuote ?? null,
                      sourceTenderFileId: (req.sourceFileToken && validTenderFileIds.has(req.sourceFileToken)) ? req.sourceFileToken : null,
                      sourceExtractionMethod: req.sourceExtractionMethod ?? effectiveExtractionMethod,
                      sourceConfidence: req.sourceConfidence ?? (typeof req.sourcePage === "number" && req.sourcePage > 0 ? 0.8 : (typeof req.sourceQuote === "string" && req.sourceQuote.trim().length > 10 ? 0.7 : 0)),
                    },
                  });
                }
                await tx.tender.update({
                  where: { id },
                  data: canonicalTenderData,
                });
              });
              if (!streamPromoSuperseded && analysisJob) {
                await promoteAnalysisToCanonical(analysisJob.id, runId);
              }
            }

            if (analysisJob) {
              analysisJobId = analysisJob.id;
              await prisma.aiJob.update({
                where: { id: analysisJob.id },
                data: {
                  status: aiMeta.isPartial ? "PARTIAL_SUCCESS" : "SUCCEEDED",
                  finishedAt: new Date(),
                  output: JSON.stringify({ isPartial: aiMeta.isPartial, totalChunks: aiMeta.totalChunks, completedChunks: aiMeta.completedChunks, failedChunks: aiMeta.failedChunks, skippedChunks: aiMeta.skippedChunks, chunkProviders: aiMeta.chunkProviders, chunkResults: aiMeta.chunkResults, contentHash, resumedFromJobId: continueJobId, analysisSource: "AI", nextAction: aiMeta.isPartial ? "CONTINUE_AI_ANALYSIS" : null }),
                },
              }).catch(() => {});

              const chunkResults = buildChunkStepResults(aiMeta);
              for (let stepIdx = 0; stepIdx < chunkResults.length; stepIdx++) {
                const step = chunkResults[stepIdx];
                await prisma.aiJobStep.create({
                  data: { jobId: analysisJob.id, stepIndex: stepIdx, stepName: step.stepName, status: step.status, startedAt: new Date(), finishedAt: new Date(), message: step.output },
                }).catch(() => {});
              }
            }
            analysisMeta = aiMeta;
            void persistAllHealthToDb().catch((e: unknown) => {
              logger.error("[ai-analyze/stream] persistAllHealthToDb failed (non-critical):", { detail: e instanceof Error ? e.message : String(e) });
            });

            const fileQualitySnapshots = tenderRecord.files.map((f) => ({
              totalPages: (f as { totalPages?: number | null }).totalPages ?? null,
              extractedPages: (f as { extractedPages?: number | null }).extractedPages ?? null,
              ocrPages: (f as { ocrPages?: number | null }).ocrPages ?? null,
              failedPages: (f as { failedPages?: number | null }).failedPages ?? null,
              extractionScore: (f as { extractionScore?: number | null }).extractionScore ?? null,
            }));
            const textSamples = tenderRecord.files.map((f) => f.extractedText);
            const rawExtractionStatus = deriveExtractionStatus(fileQualitySnapshots, textSamples);
            // When AI analysis was only partial (some chunks failed or the deadline
            // was reached before all chunks completed), cap the persisted status to
            // PARTIAL so downstream gates (Generate Docs, Export) cannot treat an
            // incomplete analysis result as a full trusted analysis — even if the
            // files themselves were perfectly extracted.
            const extractionStatus: ExtractionStatus =
              aiMeta.isPartial && rawExtractionStatus === "FULL_EXTRACTION_AI_ANALYZED"
                ? "PARTIAL_EXTRACTION_AI_ANALYZED"
                : rawExtractionStatus;
            await prisma.tender.update({ where: { id }, data: { analysisExtractionStatus: extractionStatus } }).catch((e: unknown) => {
              logger.error("[ai-analyze/stream] analysisExtractionStatus persist failed — generation gates may use stale status:", { detail: e instanceof Error ? e.message : String(e) });
            });

            analysisResult = {
              ai: true, fallback: false,
              analysisSource: (aiMeta.isPartial ? "PARTIAL_AI" : "AI") as "AI" | "PARTIAL_AI",
              summary: aiResult.summary, requirementCount: aiResult.requirements.length,
              providerDiagnostics: buildProviderDiagnosticsSnapshot(),
            };
          } catch (aiError) {
            if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
            const msg = aiError instanceof Error ? aiError.message : String(aiError);
            const diagnostics = buildAnalysisFallbackDiagnostics(msg);
            logger.error("[ai-analyze/stream] AI failed; regex fallback:", { category: diagnostics.category });
            void persistAllHealthToDb().catch((e: unknown) => {
              logger.error("[ai-analyze/stream] persistAllHealthToDb (fallback) failed (non-critical):", { detail: e instanceof Error ? e.message : String(e) });
            });
            // Non-destructive: stage fallback result without touching canonical tender data.
            const result = analyzeTender(tenderRecord);
            const diagnosticsLine = formatFallbackDiagnosticsLine(diagnostics);
            const providerDiagnostics = buildProviderDiagnosticsSnapshot();
            // When the AiJob was never created (rare transient DB failure on startup),
            // create a minimal tracking record so the fallback draft can be staged
            // rather than silently dropped.
            let streamFallbackJobId = analysisJob?.id ?? null;
            if (!streamFallbackJobId) {
              try {
                const emergencyFb = await prisma.aiJob.create({
                  data: {
                    tenderId: id, userId, jobType: "AI_ANALYZE", status: "RUNNING",
                    startedAt: new Date(),
                    input: JSON.stringify({ streamingEmergencyFallback: true, contentHash }),
                  },
                  select: { id: true },
                });
                streamFallbackJobId = emergencyFb.id;
              } catch { /* accept silent drop as last resort */ }
            }
            if (streamFallbackJobId) {
              await stageFallbackDraft(streamFallbackJobId, {
                requirements: result.requirements,
                summary: result.summary,
                contentHash,
                isPartial: false,
                completedChunks: 0,
                totalChunks: Math.ceil(tenderContent.length / 50_000),
              });
              // Do NOT set output here — preserveAiAnalyzeProgressOnFailure already
              // wrote chunkResults into AiJob.output for resume; overwriting would
              // destroy the saved chunk data.
              await prisma.aiJob.update({
                where: { id: streamFallbackJobId },
                data: { status: "FAILED", finishedAt: new Date() },
              }).catch(() => {});

              // Invalidate dashboard cache when job fails
              invalidateDashboardCache(id);
            }
            analysisResult = { ai: false, fallback: true, analysisSource: "REGEX_FALLBACK", summary: result.summary, requirementCount: result.requirements.length, fallbackDiagnostics: diagnostics, providerDiagnostics, nextAction: "RETRY_AI_ANALYZE_OR_APPROVE_FALLBACK" };
          }
        } else {
          if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
          const result = analyzeTender(tenderRecord);
          const diagnostics = buildAnalysisFallbackDiagnostics("No AI provider configured");
          const diagnosticsLine = formatFallbackDiagnosticsLine(diagnostics);
          emit({ phase: "saving", message: "Saving analysis results…" });
          // Non-destructive: stage fallback draft without touching canonical tender data.
          if (analysisJob) {
            await stageFallbackDraft(analysisJob.id, {
              requirements: result.requirements,
              summary: result.summary,
              contentHash,
              isPartial: false,
              completedChunks: 0,
              totalChunks: Math.ceil(tenderContent.length / 50_000),
            });
            await prisma.aiJob.update({
              where: { id: analysisJob.id },
              data: { status: "FAILED", finishedAt: new Date(), output: JSON.stringify({ analysisSource: "REGEX_FALLBACK", analysisExtractionStatus: "REGEX_FALLBACK_FROM_WEAK_EXTRACTION", contentHash, diagnostics: diagnosticsLine }) },
            }).catch(() => {});

            // Invalidate dashboard cache when job fails
            invalidateDashboardCache(id);
          }
          analysisResult = { ai: false, fallback: true, analysisSource: "REGEX_FALLBACK", summary: result.summary, requirementCount: result.requirements.length, fallbackDiagnostics: diagnostics, providerDiagnostics: buildProviderDiagnosticsSnapshot(), nextAction: "RETRY_AI_ANALYZE_OR_APPROVE_FALLBACK" };
        }

        await logAction({
          userId, action: "AI_ANALYZE", entityType: "Tender", entityId: id,
          description: `Analyzed tender "${tenderRecord.title}" — ${analysisResult.requirementCount} requirements extracted${analysisResult.fallback ? ` using fallback (${analysisResult.fallbackDiagnostics?.category ?? "UNKNOWN"})` : ""} (streaming)`,
          metadata: { ai: analysisResult.ai, fallback: analysisResult.fallback, requirementCount: analysisResult.requirementCount, forcedPoorExtraction: force, streaming: true },
          requestId,
        });

        void createNotification({
          userId, type: "TENDER_ANALYZED", title: `Analysis complete for "${tenderRecord.title}"`,
          body: `${analysisResult.requirementCount} requirements extracted${analysisResult.fallback ? ` (regex fallback: ${analysisResult.fallbackDiagnostics?.category ?? "UNKNOWN"})` : " by AI"}.`,
          entityType: "Tender", entityId: id, link: `/dashboard/tenders/${id}`,
        });

        // Include fallback signals in the SSE complete event so the streaming
        // client can show the retry countdown without a full page reload.
        const sseProviderRetryAfterMs = analysisResult.fallback ? getMinCooldownExpiryMs() : null;
        const sseResumableJobId = (analysisMeta?.isPartial || (analysisMeta && analysisMeta.completedChunks > 0))
          ? (analysisJobId ?? null) : null;
        emit({
          phase: "complete",
          status: analysisResult.fallback ? "FALLBACK" : (analysisMeta?.isPartial ? "AI_ANALYSIS_PARTIAL" : "AI_ANALYZED"),
          requirementCount: analysisResult.requirementCount,
          jobId: analysisJobId,
          message: `Analysis complete — ${analysisResult.requirementCount} requirements extracted`,
          ...(analysisResult.fallback && {
            fallback: true,
            code: analysisResult.fallbackDiagnostics?.category === "NO_PROVIDER_CONFIGURED"
              ? "AI_NO_PROVIDER_CONFIGURED" : "AI_PROVIDERS_EXHAUSTED",
            nextAction: analysisMeta?.isPartial ? "CONTINUE_AI_ANALYSIS" : "RETRY_AI_ANALYZE_OR_APPROVE_FALLBACK",
            providerRetryAfterMs: sseProviderRetryAfterMs,
            resumableJobId: sseResumableJobId,
            providerDiagnostics: buildProviderDiagnosticsSnapshot(),
          }),
        });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const safe = raw.replace(/sk-[a-zA-Z0-9_-]{10,}/g, "[KEY_REDACTED]").replace(/AIza[a-zA-Z0-9_-]{30,}/g, "[KEY_REDACTED]").replace(/Bearer\s+[a-zA-Z0-9._-]{10,}/gi, "Bearer [REDACTED]").slice(0, 300);
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ phase: "error", message: safe })}\n\n`));
        } catch { /* ignore — client may have disconnected */ }
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
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

  // ── Durable background path ──────────────────────────────────────────
  // ?mode=background is the unified durable workflow: enqueues an
  // AI_ANALYZE job and returns 202 immediately. The caller then triggers
  // /api/ai-jobs/run-next?jobType=AI_ANALYZE to start the worker. This
  // escapes the 60s Vercel Hobby cap that bounds the SSE path below.
  const earlyUrl = new URL(req.url);
  if (earlyUrl.searchParams.get("mode") === "background") {
    const { enqueueBackgroundAnalysis } = await import("../../../../../lib/ai-analyze/background-enqueue");
    const { id: tenderId } = await params;
    return enqueueBackgroundAnalysis(tenderId, userId);
  }

  const wantsStream = req.headers.get("accept") === "text/event-stream";
  if (wantsStream) {
    return handleStreamingAnalyze(req, userId, requestId, await params);
  }

  await prismaReady;
  const { id } = await params;
  const reqUrl = new URL(req.url);
  const force = reqUrl.searchParams.get("force") === "true";
  let continueJobId: string | null = reqUrl.searchParams.get("continue");
  let startFromChunk: number | undefined;
  let existingContentHash: string | undefined;
  let previousChunkResults: Array<{ index: number; result: AIAnalysisResult; provider?: string | null }> = [];
  if (continueJobId) {
    const existingJob = await prisma.aiJob.findFirst({
      where: { id: continueJobId, tenderId: id, userId },
    });
    const resumeState = buildResumeState(parseJobOutput(existingJob?.output));
    previousChunkResults = resumeState.previousChunkResults;
    startFromChunk = resumeState.startFromChunk;
    existingContentHash = resumeState.existingContentHash;
  }

  const [tender, company] = await Promise.all([
    prisma.tender.findFirst({
      where: { id, userId },
      include: {
        files: {
          select: {
            id: true, fileName: true, originalFileName: true, mimeType: true, size: true,
            classification: true, extractedText: true, createdAt: true,
            totalPages: true, extractedPages: true, ocrPages: true, failedPages: true,
            extractionScore: true, extractionMethod: true,
          },
        },
      },
    }),
    prisma.company.findUnique({
      where: { userId },
      include: { documents: { select: { category: true, originalFileName: true, extractedText: true }, take: 5, orderBy: { createdAt: "desc" } } },
    }),
  ]);
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  const tenderRecord = tender;
  const validTenderFileIds = new Set(tenderRecord.files.map((f) => f.id));

  const extractionReports = tenderRecord.files.map((file) => ({
    fileName: file.originalFileName || file.fileName,
    quality: assessExtractionQuality(file.extractedText, file.originalFileName || file.fileName),
  }));
  const corruptedExtractionReports = extractionReports.filter((item) => item.quality.corrupted);
  if (corruptedExtractionReports.length > 0) {
    await prisma.tender.update({
      where: { id },
      data: { status: "EXTRACTION_CORRUPTED_AI_SKIPPED", analysisExtractionStatus: "OCR_REQUIRED" },
    }).catch(() => {});
    return NextResponse.json({
      error: "AI analysis skipped: extracted tender text is corrupted/gibberish and requires OCR or re-upload before reliable analysis.",
      code: "EXTRACTION_CORRUPTED_AI_SKIPPED",
      nextAction: "RUN_OCR_OR_UPLOAD_CLEARER_SCAN",
      blockers: corruptedExtractionReports,
      hint: "Do not retry providers until the extracted text is readable; this is an extraction problem, not an AI provider failure.",
    }, { status: 422 });
  }

  const extractionBlockers = extractionReports.filter((item) => item.quality.severity === "FAILED" || item.quality.severity === "POOR");
  if (!force && extractionBlockers.length > 0) {
    return NextResponse.json({
      error: "AI analysis blocked: one or more tender files have poor extraction quality.",
      code: "EXTRACTION_NOT_READY",
      nextAction: "OPEN_EXTRACTION_QUALITY",
      blockers: extractionBlockers,
      hint: "Re-import/OCR/review the file, or retry with ?force=true only when you intentionally accept degraded analysis quality.",
    }, { status: 422 });
  }

  // Check for corrupted extracted text — catches the case where extractors
  // returned thousands of garbage characters (GGG symbols, black squares,
  // broken spacing) that pass the old length-only gate but contain no
  // usable content for AI analysis.
  const textSamples = tenderRecord.files
    .map((f) => f.extractedText)
    .filter((t): t is string => Boolean(t && t.trim().length > 20));
  // Block when ANY file has corrupted text — a single corrupted source contaminates
  // the analysis even when other files extract cleanly (multi-file tender case).
  const isTextCorrupted =
    textSamples.length > 0 && textSamples.some((t) => isExtractionCorrupted(t));
  if (!force && isTextCorrupted) {
    return NextResponse.json({
      error: "AI analysis blocked — extracted text is corrupted",
      code: "EXTRACTION_CORRUPTED_AI_SKIPPED",
      nextAction: "Run OCR extraction or upload a clearer PDF before AI Analyze",
      hint: "The extracted text contains garbage characters (symbol runs, broken spacing, or icon-font glyphs). Set PDF_OCR_ENABLED=true to enable automatic OCR fallback, or retry with ?force=true to proceed with degraded analysis.",
    }, { status: 400 });
  }

  // nsJobIdForFallback and nsContentHashForFallback are set inside the AI try block
  // so the fallback function can stage the result without canonical writes.
  let nsJobIdForFallback: string | null = null;
  let nsContentHashForFallback: string | undefined;

  async function runRegexFallback(errorMessage?: string, diagnostics?: AnalysisFallbackDiagnostics) {
    const result = analyzeTender(tenderRecord);
    const fallbackDiagnostics = diagnostics ?? (errorMessage ? buildAnalysisFallbackDiagnostics(errorMessage) : buildAnalysisFallbackDiagnostics("No AI provider configured"));
    const diagnosticsLine = formatFallbackDiagnosticsLine(fallbackDiagnostics);
    const providerDiagnostics = buildProviderDiagnosticsSnapshot();

    if (nsJobIdForFallback) {
      // Non-destructive: stage the fallback draft without touching canonical tender data.
      await stageFallbackDraft(nsJobIdForFallback, {
        requirements: result.requirements,
        summary: result.summary,
        contentHash: nsContentHashForFallback ?? "",
        isPartial: false,
        completedChunks: 0,
        totalChunks: 0,
      });
    }

    return {
      ai: false,
      fallback: Boolean(errorMessage),
      analysisSource: "REGEX_FALLBACK" as const,
      summary: result.summary,
      requirementCount: result.requirements.length,
      fallbackDiagnostics,
      providerDiagnostics,
      nextAction: "RETRY_AI_ANALYZE_OR_APPROVE_FALLBACK",
    };
  }

  try {
    let analysisResult: {
      ai: boolean;
      fallback: boolean;
      analysisSource?: "AI" | "PARTIAL_AI" | "REGEX_FALLBACK";
      summary: string;
      requirementCount: number;
      fallbackDiagnostics?: AnalysisFallbackDiagnostics;
      providerDiagnostics?: ReturnType<typeof buildProviderDiagnosticsSnapshot>;
      nextAction?: string;
    };
    let analysisJobId: string | null = null;
    let analysisMeta: AnalysisWithMeta | null = null;

    if (isAIEnabled()) {
      try {
        // Shared builder — IDENTICAL content + hash to the streaming path and
        // the durable job service (lib/ai-jobs/analysis-job-service.ts), so all
        // execution paths share one chunk-state identity.
        const tenderContent = buildTenderAnalysisContent(tenderRecord, company);

        // Compute content hash for continuation validation and auto-resume discovery
        const contentHash = computeAnalysisContentHash(tenderContent);
        if (force) {
          await clearAnalyzeCheckpoints(id, userId, contentHash);
        } else {
          await clearAnalyzeCheckpointsForContentHashMismatch(id, userId, contentHash);
          const durableChunks = await getCompletedChunkResults(id, userId, contentHash);
          if (durableChunks.length > 0) {
            previousChunkResults = durableChunks;
            startFromChunk = 0;
            existingContentHash = contentHash;
          }
        }
        if (!continueJobId && !force) {
          const resumableJob = await findLatestResumableAiAnalyzeJob(id, userId, contentHash);
          if (resumableJob) {
            continueJobId = resumableJob.id;
            previousChunkResults = resumableJob.previousChunkResults;
            startFromChunk = 0;
            existingContentHash = contentHash;
          }
        }
        if (existingContentHash && existingContentHash !== contentHash) {
          startFromChunk = undefined;
          previousChunkResults = [];
          continueJobId = null;
        }

        // Clean up stale RUNNING jobs before creating a new one.
        // When a Vercel function is killed by the platform timeout, the job
        // stays RUNNING indefinitely. Mark any RUNNING job older than 90s as
        // FAILED so the UI doesn't show a phantom "in progress" state.
        await prisma.aiJob.updateMany({
          where: {
            tenderId: id,
            userId,
            jobType: "AI_ANALYZE",
            status: "RUNNING",
            startedAt: { lt: new Date(Date.now() - 90_000) },
          },
          data: { status: "FAILED", finishedAt: new Date(), errorMessage: "Timed out (cleaned up by subsequent request)" },
        }).catch(() => {});

        // Create an AiJob record to track this synchronous analysis run
        nsContentHashForFallback = contentHash;
        const nsRunId = crypto.randomUUID();
        // analysisVersion is assigned by the PostgreSQL sequence — no application value needed.

        let analysisJob: { id: string } | null = null;
        try {
          analysisJob = await prisma.aiJob.create({
            data: {
              tenderId: id,
              userId,
              jobType: "AI_ANALYZE",
              status: "RUNNING",
              startedAt: new Date(),
              input: JSON.stringify({
                contentLength: tenderContent.length,
                chunkCount: Math.ceil(tenderContent.length / 50_000),
                contentHash,
              }),
            },
            select: { id: true },
          });
          nsJobIdForFallback = analysisJob?.id ?? null;
        } catch (jobCreateErr) {
          logger.warn("[ai-analyze] Failed to create AiJob record — continuing without job tracking:", { detail: jobCreateErr instanceof Error ? jobCreateErr.message : String(jobCreateErr) });
        }

        // Restore provider cooldown state from DB before analysis.
        // A 2-second timeout prevents a slow DB from blocking the analysis.
        // The in-memory state is still usable without a successful restore.
        await Promise.race([
          restoreHealthFromDb(),
          new Promise<void>((r) => setTimeout(r, 2_000)),
        ]).catch(() => {});

        const deadlineAt = Date.now() + SAFE_DEADLINE_MS;
        const onChunkStartNonStream = async ({ chunkIndex, totalChunks }: { chunkIndex: number; totalChunks: number }) => {
          await upsertAnalyzeChunkStarted({ tenderId: id, userId, contentHash, chunkIndex, totalChunks }).catch((e: unknown) => {
            logger.error("[ai-analyze/non-stream] checkpoint start write failed — chunk resume may retry this chunk:", { detail: e instanceof Error ? e.message : String(e) });
          });
        };
        const onChunkCompleteNonStream = async ({
          completed,
          totalChunks,
          chunkIndex,
          result,
          provider,
        }: {
          completed: Array<{ index: number; result: AIAnalysisResult; provider?: string | null }>;
          totalChunks: number;
          chunkIndex?: number;
          result?: AIAnalysisResult;
          provider?: string | null;
        }) => {
          if (typeof chunkIndex === "number" && result) {
            await upsertAnalyzeChunkSucceeded({ tenderId: id, userId, contentHash, chunkIndex, totalChunks, result, provider }).catch((e: unknown) => {
              logger.error("[ai-analyze/non-stream] checkpoint succeeded write failed — chunk resume may retry this chunk:", { detail: e instanceof Error ? e.message : String(e) });
            });
          }
          if (analysisJob) {
            await prisma.aiJob.update({
              where: { id: analysisJob.id },
              data: {
                output: JSON.stringify(buildAiAnalyzePartialOutput(completed, totalChunks, contentHash)),
              },
            }).catch((e: unknown) => {
              logger.error("[ai-analyze/non-stream] AiJob partial output update failed (non-critical):", { detail: e instanceof Error ? e.message : String(e) });
            });
          }
        };
        const onChunkFailureNonStream = async ({
          chunkIndex,
          totalChunks,
          errorMessage,
          provider,
        }: { chunkIndex: number; totalChunks: number; errorMessage: string; provider?: string | null }) => {
          await upsertAnalyzeChunkFailed({ tenderId: id, userId, contentHash, chunkIndex, totalChunks, errorMessage, provider }).catch((e: unknown) => {
            logger.error("[ai-analyze/non-stream] checkpoint failed write failed — chunk may be retried on resume:", { detail: e instanceof Error ? e.message : String(e) });
          });
        };
        let aiMeta: AnalysisWithMeta;
        try {
          aiMeta = await withTimeout(
            analyzeWithAI(tenderContent, {
              deadlineAt,
              startFromChunk,
              previousChunkResults,
              onChunkStart: onChunkStartNonStream,
              onChunkComplete: onChunkCompleteNonStream,
              onChunkFailure: onChunkFailureNonStream,
              // OBS-004 — fire-and-forget per-tenant AI usage tracking.
              onProviderAttempt: (provider, success, latencyMs, failureCategory) => {
                void recordAiUsage({
                  userId,
                  tenderId: id,
                  provider,
                  useCase: "extraction",
                  latencyMs,
                  success,
                  failureCategory: failureCategory ?? null,
                });
              },
            }),
            AI_ANALYSIS_TIMEOUT_MS,
          );
        } catch (aiErr) {
          // Fail the job before re-throwing
          if (analysisJob) {
            const errMsg = aiErr instanceof Error ? aiErr.message : String(aiErr);
            const safeErrMsg = errMsg.replace(/sk-[a-zA-Z0-9_-]{10,}/g, "[KEY_REDACTED]").replace(/AIza[a-zA-Z0-9_-]{30,}/g, "[KEY_REDACTED]").replace(/Bearer\s+[a-zA-Z0-9._-]{10,}/gi, "Bearer [REDACTED]").slice(0, 300);
            await preserveAiAnalyzeProgressOnFailure(analysisJob.id, {
              analysisSource: "REGEX_FALLBACK",
              errorMessage: safeErrMsg,
              status: "FAILED",
            });
          }
          throw aiErr;
        }
        const aiResult = aiMeta.result;

        const effectiveExtractionMethodNonStreaming: string = tenderRecord.files.some(
          (f: { extractionMethod?: string | null; ocrPages?: number | null }) =>
            f.extractionMethod === "ocr" || (f.ocrPages != null && f.ocrPages > 0),
        ) ? "ocr" : "text";

        if (aiMeta.isPartial) {
          // Non-destructive: stage partial result without touching canonical tender data.
          if (analysisJob) {
            await stagePartialResult(analysisJob.id, {
              requirements: aiResult.requirements,
              summary: aiResult.summary,
              chunkResults: aiMeta.chunkResults,
              contentHash,
              isPartial: true,
              completedChunks: aiMeta.completedChunks,
              totalChunks: aiMeta.totalChunks,
            });
          }
        } else if (await canPromoteToCanonical(analysisJob?.id ?? null, id)) {
          // Full success: promote atomically to canonical via the shared builder
          // (identical canonical metadata + contamination detection across all paths).
          const { data: canonicalTenderDataNonStream } = buildCanonicalAnalysisTenderUpdate(aiResult, {
            clientName: tenderRecord.clientName,
            submissionMethod: tenderRecord.submissionMethod,
            submissionEmails: tenderRecord.submissionEmails,
            notes: tenderRecord.notes,
          });

          // Atomic TOCTOU guard: same pattern as streaming path.
          let nsPromoSuperseded = false;
          await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(1, hashtext(${id}))`;
            if (analysisJob) {
              const currentVer = await tx.aiJob.findUnique({
                where: { id: analysisJob.id },
                select: { analysisVersion: true },
              });
              const newerExists = !currentVer || await tx.aiJob.findFirst({
                where: { tenderId: id, jobType: "AI_ANALYZE", id: { not: analysisJob.id }, analysisVersion: { gt: currentVer.analysisVersion } },
                select: { id: true },
              });
              if (newerExists) { nsPromoSuperseded = true; return; }
            }
            await tx.tenderRequirement.deleteMany({ where: { tenderId: id } });
            for (const req of aiResult.requirements) {
              await tx.tenderRequirement.create({
                data: {
                  tenderId: id,
                  title: req.title,
                  description: req.description,
                  requirementType: req.requirementType,
                  priority: req.priority,
                  exactFileName: req.exactFileName ?? null,
                  requiredQuantity: req.requiredQuantity ?? null,
                  pageLimit: req.pageLimit ?? null,
                  restrictions: req.restrictions ?? null,
                  sectionReference: req.sectionReference ?? null,
                  sourceSectionHeading: req.sourceSectionHeading || req.sectionReference || null,
                  sourcePageNumber: req.sourcePage ?? null,
                  sourceExactQuote: req.sourceQuote ?? null,
                  sourceTenderFileId: (req.sourceFileToken && validTenderFileIds.has(req.sourceFileToken)) ? req.sourceFileToken : null,
                  sourceExtractionMethod: req.sourceExtractionMethod ?? effectiveExtractionMethodNonStreaming,
                  sourceConfidence: req.sourceConfidence ?? (typeof req.sourcePage === "number" && req.sourcePage > 0 ? 0.8 : (typeof req.sourceQuote === "string" && req.sourceQuote.trim().length > 10 ? 0.7 : 0)),
                },
              });
            }
            await tx.tender.update({
              where: { id },
              data: canonicalTenderDataNonStream,
            });
          });
          if (!nsPromoSuperseded && analysisJob) {
            await promoteAnalysisToCanonical(analysisJob.id, nsRunId);
          }
        }

        // Update the AiJob to SUCCEEDED (or PARTIAL_SUCCESS) with chunk metadata.
        // PARTIAL_SUCCESS = some chunks succeeded, some failed/skipped due to deadline.
        if (analysisJob) {
          analysisJobId = analysisJob.id;
          await prisma.aiJob.update({
            where: { id: analysisJob.id },
            data: {
              status: aiMeta.isPartial ? "PARTIAL_SUCCESS" : "SUCCEEDED",
              finishedAt: new Date(),
              output: JSON.stringify({
                isPartial: aiMeta.isPartial,
                totalChunks: aiMeta.totalChunks,
                completedChunks: aiMeta.completedChunks,
                failedChunks: aiMeta.failedChunks,
                skippedChunks: aiMeta.skippedChunks,
                chunkProviders: aiMeta.chunkProviders,
                chunkResults: aiMeta.chunkResults,
                contentHash,
                resumedFromJobId: continueJobId,
                analysisSource: "AI",
                nextAction: aiMeta.isPartial ? "CONTINUE_AI_ANALYSIS" : null,
              }),
            },
          }).catch(() => {});

          // Invalidate dashboard cache when AI job completes
          invalidateDashboardCache(id);

          // Persist per-chunk step records for observability
          const chunkResults = buildChunkStepResults(aiMeta);
          for (let stepIdx = 0; stepIdx < chunkResults.length; stepIdx++) {
            const step = chunkResults[stepIdx];
            await prisma.aiJobStep.create({
              data: {
                jobId: analysisJob.id,
                stepIndex: stepIdx,
                stepName: step.stepName,
                status: step.status,
                startedAt: new Date(),
                finishedAt: new Date(),
                message: step.output,
              },
            }).catch(() => {});
          }
        }
        analysisMeta = aiMeta;
        // Persist updated provider health to DB after analysis completes.
        // Fire-and-forget — never blocks the response.
        void persistAllHealthToDb().catch((e: unknown) => {
          logger.error("[ai-analyze/non-stream] persistAllHealthToDb failed (non-critical):", { detail: e instanceof Error ? e.message : String(e) });
        });

        // Compute and persist the extraction status synchronously so downstream
        // gates (Generate Docs, Export) read the correct status immediately.
        const fileQualitySnapshots = tenderRecord.files.map((f) => ({
          totalPages: (f as { totalPages?: number | null }).totalPages ?? null,
          extractedPages: (f as { extractedPages?: number | null }).extractedPages ?? null,
          ocrPages: (f as { ocrPages?: number | null }).ocrPages ?? null,
          failedPages: (f as { failedPages?: number | null }).failedPages ?? null,
          extractionScore: (f as { extractionScore?: number | null }).extractionScore ?? null,
        }));
        // Pass textSamples so a forced run over corrupted text still persists
        // EXTRACTION_CORRUPTED_AI_SKIPPED (parity with the streaming path) —
        // otherwise a ?force=true analysis could record a clean status and let
        // downstream Generate Docs / Export gates trust corrupted extraction.
        const rawExtractionStatus = deriveExtractionStatus(fileQualitySnapshots, textSamples);
        // When AI analysis was only partial (some chunks failed or the deadline
        // was reached before all chunks completed), cap the persisted status to
        // PARTIAL so downstream gates (Generate Docs, Export) cannot treat an
        // incomplete analysis result as a full trusted analysis — even if the
        // files themselves were perfectly extracted.
        const extractionStatus: ExtractionStatus =
          aiMeta.isPartial && rawExtractionStatus === "FULL_EXTRACTION_AI_ANALYZED"
            ? "PARTIAL_EXTRACTION_AI_ANALYZED"
            : rawExtractionStatus;
        await prisma.tender.update({
          where: { id },
          data: { analysisExtractionStatus: extractionStatus },
        }).catch((e: unknown) => {
          logger.error("[ai-analyze/non-stream] analysisExtractionStatus persist failed — generation gates may use stale status:", { detail: e instanceof Error ? e.message : String(e) });
        });

        analysisResult = {
          ai: true,
          fallback: false,
          analysisSource: (aiMeta.isPartial ? "PARTIAL_AI" : "AI") as "AI" | "PARTIAL_AI",
          summary: aiResult.summary,
          requirementCount: aiResult.requirements.length,
          providerDiagnostics: buildProviderDiagnosticsSnapshot(),
        };
      } catch (aiError) {
        const msg = aiError instanceof Error ? aiError.message : String(aiError);
        const diagnostics = buildAnalysisFallbackDiagnostics(msg);
        logger.error("AI analysis failed; deterministic fallback used:", { category: diagnostics.category, message: diagnostics.message });
        // Persist failure state so the next cold start knows which providers are cooling down.
        void persistAllHealthToDb().catch((e: unknown) => {
          logger.error("[ai-analyze/non-stream] persistAllHealthToDb (fallback) failed (non-critical):", { detail: e instanceof Error ? e.message : String(e) });
        });
        analysisResult = await runRegexFallback(msg, diagnostics);
      }
    } else {
      // No AI provider configured. Create a minimal AiJob so runRegexFallback
      // can call stageFallbackDraft instead of the legacy canonical overwrite.
      // Without this, a deployment with no AI key would destroy a previous
      // trusted AI analysis by taking the legacy deleteMany/canonical-write path.
      if (!nsJobIdForFallback) {
        const textDigest = crypto.createHash("sha256").update(tenderRecord.title ?? "").digest("hex").slice(0, 8);
        const noAiHash = crypto.createHash("sha256").update(`${id}[digest:${textDigest}]`).digest("hex").slice(0, 16);
        nsContentHashForFallback = noAiHash;
        try {
          const noAiJob = await prisma.aiJob.create({
            data: {
              tenderId: id, userId, jobType: "AI_ANALYZE", status: "RUNNING",
              startedAt: new Date(),
              input: JSON.stringify({ noAiProvider: true, contentHash: noAiHash }),
            },
            select: { id: true },
          });
          nsJobIdForFallback = noAiJob.id;
        } catch (jobCreateError) {
          // Job creation failed — throw so canonical requirements are preserved.
          // The legacy deleteMany/canonical-write path must never run when job
          // tracking is unavailable: it would destroy trusted canonical state.
          throw new AiAnalyzeCheckpointPersistenceError(
            "stageFallbackDraft",
            crypto.randomUUID(),
            id,
            null,
            "no-job",
            jobCreateError instanceof Error
              ? jobCreateError
              : new Error("AI Analyze could not create a staging job; canonical requirements were preserved."),
          );
        }
      }
      analysisResult = await runRegexFallback("No AI provider configured", buildAnalysisFallbackDiagnostics("No AI provider configured"));
      if (nsJobIdForFallback) {
        await prisma.aiJob.update({
          where: { id: nsJobIdForFallback },
          data: {
            status: "PARTIAL_SUCCESS",
            finishedAt: new Date(),
            output: JSON.stringify({
              analysisSource: "REGEX_FALLBACK",
              analysisExtractionStatus: "REGEX_FALLBACK_FROM_WEAK_EXTRACTION",
              reason: "No AI provider configured",
              requirementCount: analysisResult.requirementCount,
            }),
          },
        }).catch(() => {});

        // Invalidate dashboard cache when job completes via fallback
        invalidateDashboardCache(id);
      }
    }

    await logAction({
      userId,
      action: "AI_ANALYZE",
      entityType: "Tender",
      entityId: id,
      description: `Analyzed tender "${tenderRecord.title}" — ${analysisResult.requirementCount} requirements extracted${analysisResult.fallback ? ` using fallback (${analysisResult.fallbackDiagnostics?.category ?? "UNKNOWN"})` : ""}`,
      metadata: {
        ai: analysisResult.ai,
        fallback: analysisResult.fallback,
        fallbackDiagnostics: analysisResult.fallbackDiagnostics ?? null,
        providerDiagnostics: analysisResult.providerDiagnostics ?? null,
        requirementCount: analysisResult.requirementCount,
        forcedPoorExtraction: force,
        extractionWarnings: extractionReports.filter((item) => item.quality.severity === "WARNING"),
      },
      requestId,
    });

    const updated = await prisma.tender.findUnique({
      where: { id },
      include: {
        requirements: true,
        files: {
          orderBy: { createdAt: "desc" },
          select: { id: true, fileName: true, originalFileName: true, mimeType: true, size: true, classification: true, createdAt: true },
        },
        complianceGaps: true,
        generatedDocuments: {
          orderBy: [{ exactOrder: "asc" }, { createdAt: "desc" }],
          select: { id: true, name: true, documentType: true, generationStatus: true, validationStatus: true, reviewStatus: true, reviewNotes: true, exactFileName: true, exactOrder: true, contentSummary: true, reviewedExpertCount: true, draftExpertCount: true, reviewedProjectCount: true, draftProjectCount: true },
        },
      },
    });
    const fileTextMetrics = updated ? await prisma.$queryRaw<Array<{ id: string; extractedTextLength: number; isScannedPlaceholder: boolean }>>`
      SELECT
        id,
        COALESCE(char_length("extractedText"), 0)::int AS "extractedTextLength",
        COALESCE("extractedText" LIKE '[Scanned%', false) AS "isScannedPlaceholder"
      FROM "TenderFile"
      WHERE "tenderId" = ${id}
    ` : [];
    const fileTextMetricById = new Map(fileTextMetrics.map((file) => [file.id, file]));
    const updatedForResponse = updated ? {
      ...updated,
      files: updated.files.map((file) => {
        const metric = fileTextMetricById.get(file.id);
        return {
          ...file,
          extractedTextLength: metric?.extractedTextLength ?? 0,
          isScannedPlaceholder: metric?.isScannedPlaceholder ?? false,
        };
      }),
    } : null;

    void createNotification({
      userId,
      type: "TENDER_ANALYZED",
      title: `Analysis complete for "${tenderRecord.title}"`,
      body: `${analysisResult.requirementCount} requirements extracted${analysisResult.fallback ? ` (regex fallback: ${analysisResult.fallbackDiagnostics?.category ?? "UNKNOWN"})` : " by AI"}.`,
      entityType: "Tender",
      entityId: id,
      link: `/dashboard/tenders/${id}`,
    });

    // Surface a stable, machine-readable code when the AI chain failed so the
    // UI can route to "Retry AI Analyze" / "Review AI Provider Health" /
    // "Approve fallback analysis with audit note" actions.
    const fallbackCode = analysisResult.fallback
      ? (analysisResult.fallbackDiagnostics?.category === "NO_PROVIDER_CONFIGURED"
          ? "AI_NO_PROVIDER_CONFIGURED"
          : "AI_PROVIDERS_EXHAUSTED")
      : null;

    // Determine the machine-readable nextAction for the UI:
    //   - Partial AI result → user can continue to get remaining chunks
    //   - Fallback (regex) → user should retry AI analyze or approve fallback
    //   - Full AI success → no action needed
    const responseNextAction = analysisMeta?.isPartial
      ? "CONTINUE_AI_ANALYSIS"
      : analysisResult.fallback
        ? "RETRY_AI_ANALYZE_OR_APPROVE_FALLBACK"
        : null;

    // Build provider attempt chain log for observability.
    // Derives which providers were skipped (cooling down), which were tried,
    // and which succeeded per chunk. This helps operators understand why the
    // chain fell through to regex fallback on a cold start.
    const providerChainLog: Array<{
      provider: string;
      status: "SUCCESS" | "FAILED" | "SKIPPED_COOLDOWN" | "SKIPPED_NOT_CONFIGURED" | "REGEX_FALLBACK";
      durationMs: number;
    }> = [];
    let analysisProvider: string | null = null;
    let analysisProviderStatus: string | null = null;

    if (analysisMeta) {
      // Collect unique providers from chunkProviders (first non-null = dominant)
      const succeededProviders = analysisMeta.chunkProviders.filter((p): p is string => p !== null);
      analysisProvider = succeededProviders[0] ?? null;

      if (analysisProvider) {
        analysisProviderStatus = `AI_ANALYZED_BY_${analysisProvider.toUpperCase()}`;
      }

      if (analysisProvider) {
        const { markProviderAnalysisOK } = await import("../../../../../lib/engine/provider-health-store");
        void markProviderAnalysisOK(analysisProvider).catch(() => {});
      }
      // Log skipped (cooling down) providers from the diagnostics snapshot
      const diagnosticsSnap = analysisResult.providerDiagnostics;
      if (diagnosticsSnap) {
        for (const p of diagnosticsSnap.perProvider) {
          if (!p.configured) {
            providerChainLog.push({ provider: p.provider, status: "SKIPPED_NOT_CONFIGURED", durationMs: 0 });
          } else if (p.coolingDown) {
            providerChainLog.push({ provider: p.provider, status: "SKIPPED_COOLDOWN", durationMs: 0 });
          } else if (succeededProviders.includes(p.provider)) {
            providerChainLog.push({ provider: p.provider, status: "SUCCESS", durationMs: 0 });
          }
        }
      }
    } else if (analysisResult.fallback) {
      analysisProviderStatus = "REGEX_FALLBACK";
      providerChainLog.push({ provider: "regex", status: "REGEX_FALLBACK", durationMs: 0 });
    }

    return NextResponse.json({
      success: true,
      ...analysisResult,
      code: fallbackCode,
      analysisSource: analysisResult.analysisSource ?? null,
      analysisProvider,
      analysisProviderStatus,
      providerChainLog,
      jobId: analysisJobId,
      chunks: analysisMeta ? {
        total: analysisMeta.totalChunks,
        completed: analysisMeta.completedChunks,
        failed: analysisMeta.failedChunks,
        skipped: analysisMeta.skippedChunks,
        isPartial: analysisMeta.isPartial,
      } : null,
      nextAction: responseNextAction,
      // When the AI chain fell back to regex because providers are cooling down,
      // tell the client exactly how long to wait before auto-retrying so it can
      // show a countdown and fire the retry automatically without user input.
      // null  → no providers configured (permanent — don't auto-retry)
      // 0     → a provider is already available (retry immediately)
      // > 0   → ms until soonest provider exits cooldown
      providerRetryAfterMs: analysisResult.fallback ? getMinCooldownExpiryMs() : null,
      // The job ID the client should pass as ?continue= when auto-retrying so
      // analysis resumes from the last successful chunk.
      resumableJobId: (analysisMeta?.isPartial || (analysisMeta && analysisMeta.completedChunks > 0))
        ? (analysisJobId ?? null)
        : null,
      tender: updatedForResponse,
      extractionWarnings: extractionReports.filter((item) => item.quality.severity === "WARNING"),
    });
  } catch (error) {
    if (error instanceof AiAnalyzeCheckpointPersistenceError) {
      logger.error("Analysis route error (checkpoint persistence):", { code: error.code, diagnosticId: error.diagnosticId, operation: error.operation });
      return NextResponse.json(
        {
          error: "Analysis progress could not be saved. Please retry after the database issue is resolved.",
          code: "AI_ANALYZE_CHECKPOINT_PERSISTENCE_FAILED",
          diagnosticId: error.diagnosticId,
        },
        { status: 503 },
      );
    }
    logger.error("Analysis route error:", { detail: error });
    const raw = error instanceof Error ? error.message : "Analysis failed";
    // Sanitize before returning — strip API keys and truncate stack detail
    const safe = raw
      .replace(/sk-[a-zA-Z0-9_-]{10,}/g, "[KEY_REDACTED]")
      .replace(/AIza[a-zA-Z0-9_-]{30,}/g, "[KEY_REDACTED]")
      .replace(/Bearer\s+[a-zA-Z0-9._-]{10,}/gi, "Bearer [REDACTED]")
      .slice(0, 300);
    return NextResponse.json({ error: safe }, { status: 500 });
  }
}
