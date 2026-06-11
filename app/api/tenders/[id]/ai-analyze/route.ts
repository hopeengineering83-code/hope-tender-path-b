import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { analyzeWithAI, isAIEnabled, type AnalysisWithMeta, type AIAnalysisResult } from "../../../../../lib/ai";
import { analyzeTender } from "../../../../../lib/engine/analysis";
import { logAction } from "../../../../../lib/audit";
import { rateLimit, AI_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../lib/request-id";
import { createNotification } from "../../../../../lib/notifications";
import { assessExtractionQuality } from "../../../../../lib/extraction-quality";
import { deriveExtractionStatus, isExtractionCorrupted, type TenderFileQuality } from "../../../../../lib/engine/extraction-quality-gate";
import { detectMetadataContamination } from "../../../../../lib/engine/tender-metadata-completeness";
import { isValidClientContact, containsMetadataPlaceholder, isValidCountry, isValidReferenceNumber } from "../../../../../lib/engine/metadata-validators";
import { buildAnalysisFallbackDiagnostics, formatFallbackDiagnosticsLine, type AnalysisFallbackDiagnostics } from "../../../../../lib/engine/analysis-fallback-diagnostics";
import { buildProviderDiagnosticsSnapshot } from "../../../../../lib/ai-provider-health";
import { restoreHealthFromDb, persistAllHealthToDb } from "../../../../../lib/ai-provider-health-db";
import { safeParseJsonObject } from "../../../../../lib/safe-json";

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

const MAX_FILE_CHARS_FOR_AI_ANALYSIS = (() => {
  const raw = Number(process.env.TENDER_AI_MAX_FILE_CHARS);
  if (Number.isFinite(raw) && raw >= 1_000 && raw <= 50_000) return raw;
  return 12_000;
})();

const SECTION_SCAN_CHARS = (() => {
  const raw = Number(process.env.TENDER_AI_SECTION_SCAN_CHARS);
  if (Number.isFinite(raw) && raw >= 500 && raw <= 10_000) return raw;
  return 3_000;
})();

// Soft cap on total tender content sent to AI. Content above this threshold
// is chunked by analyzeWithAI. Setting a max prevents OOM from extremely
// large tenders while still covering multi-file tenders well.
const MAX_TOTAL_AI_CHARS = (() => {
  const raw = Number(process.env.TENDER_AI_MAX_TOTAL_CHARS);
  if (Number.isFinite(raw) && raw >= 10_000 && raw <= 500_000) return raw;
  return 300_000; // 6 × 50K chunks
})();

const SECTION_KEYWORDS = /evaluation|scoring|criteria|submission|deadline|annex|appendix|form[s\s]|financial proposal|technical proposal|envelope|subject line|bid bond|eligibility|qualification|instructions to (bidders?|tenderers?)|evaluation matrix|scoring matrix|award criteria/i;

/**
 * For files larger than maxChars, extracts the first portion PLUS sections
 * near evaluation/submission/scoring keywords. This surfaces critical tender
 * instructions that appear deep in a document rather than always truncating
 * from the start.
 */
function extractRelevantSections(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const head = text.slice(0, Math.floor(maxChars * 0.6));
  const scanBudget = maxChars - head.length;

  // Find positions of keyword-bearing lines beyond the head section
  const tail = text.slice(head.length);
  const snippets: string[] = [];
  let budgetUsed = 0;

  // Walk the tail looking for lines that match section keywords
  let searchPos = 0;
  while (budgetUsed < scanBudget && searchPos < tail.length) {
    const nextMatch = tail.slice(searchPos).search(SECTION_KEYWORDS);
    if (nextMatch === -1) break;

    const matchStart = searchPos + nextMatch;
    // Find the start of the line containing the match
    const lineStart = tail.lastIndexOf("\n", matchStart) + 1;
    // Extract SECTION_SCAN_CHARS around the match
    const snippetStart = Math.max(lineStart, matchStart - 200);
    const snippetEnd = Math.min(tail.length, snippetStart + SECTION_SCAN_CHARS);
    const snippet = tail.slice(snippetStart, snippetEnd);

    if (!head.includes(snippet.slice(0, 50))) {
      snippets.push(snippet);
      budgetUsed += snippet.length;
    }

    searchPos = snippetEnd;
    if (budgetUsed >= scanBudget) break;
  }

  if (snippets.length === 0) return head;
  return `${head}\n\n[... key sections extracted from remainder ...]\n\n${snippets.join("\n\n---\n\n")}`;
}

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

function stripExtractionHeader(txt: string): string {
  return txt.replace(/^\[(?:PDF text|OCR text)[^\]]*\]\s*\n+/i, "").trim();
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

        // Build tender content (same logic as non-streaming path)
        const fileTexts = tenderRecord.files
          .map((f) => f.extractedText
            ? `[FILE: ${f.originalFileName}]\n${extractRelevantSections(stripExtractionHeader(f.extractedText), MAX_FILE_CHARS_FOR_AI_ANALYSIS)}`
            : `[FILE: ${f.originalFileName} ${f.classification ?? ""}]`)
          .join("\n\n");

        const companyContext = company?.documents?.length
          ? `\n\nCOMPANY DOCUMENTS AVAILABLE:\n${company.documents.map((d) => `- ${d.originalFileName} (${d.category})`).join("\n")}`
          : "";

        const tenderContent = [
          `TENDER: ${tenderRecord.title}`,
          tenderRecord.description ? `DESCRIPTION: ${tenderRecord.description.slice(0, 2_000)}` : null,
          tenderRecord.intakeSummary ? `INTAKE NOTES: ${tenderRecord.intakeSummary.slice(0, 2_000)}` : null,
          fileTexts || null,
          companyContext || null,
        ].filter(Boolean).join("\n\n").slice(0, MAX_TOTAL_AI_CHARS);

        const contentHash = crypto.createHash("sha256").update(tenderContent).digest("hex").slice(0, 16);
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

        let analysisJob: { id: string } | null = null;
        try {
          analysisJob = await prisma.aiJob.create({
            data: {
              tenderId: id, userId, jobType: "AI_ANALYZE", status: "RUNNING", startedAt: new Date(),
              input: JSON.stringify({ contentLength: tenderContent.length, chunkCount: Math.ceil(tenderContent.length / 50_000), contentHash }),
            },
            select: { id: true },
          });
        } catch (jobCreateErr) {
          console.warn("[ai-analyze/stream] Failed to create AiJob record:", jobCreateErr instanceof Error ? jobCreateErr.message : String(jobCreateErr));
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
        // analyzeWithAI processes chunks sequentially; we poll progress after
        // the call returns rather than instrumenting the library internals.
        // For multi-chunk tenders we emit a mid-analysis event after a short
        // delay so the UI shows movement.
        let progressTimer: ReturnType<typeof setInterval> | null = null;
        let estimatedChunksDone = 0;
        if (estimatedChunks > 1) {
          progressTimer = setInterval(() => {
            estimatedChunksDone = Math.min(estimatedChunksDone + 1, estimatedChunks - 1);
            emit({ phase: "analyzing", chunk: estimatedChunksDone + 1, totalChunks: estimatedChunks, message: `Analyzing chunk ${estimatedChunksDone + 1} of ${estimatedChunks}…` });
          }, Math.max(3_000, Math.floor(SAFE_DEADLINE_MS / (estimatedChunks + 1))));
        }

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
          const onChunkComplete = analysisJob
            ? async ({ completed, totalChunks }: { completed: Array<{ index: number; result: AIAnalysisResult; provider?: string | null }>; totalChunks: number }) => {
                await prisma.aiJob.update({
                  where: { id: analysisJob!.id },
                  data: {
                    output: JSON.stringify(buildAiAnalyzePartialOutput(completed, totalChunks, contentHash)),
                  },
                }).catch(() => {});
              }
            : undefined;
          try {
            const deadlineAt = Date.now() + SAFE_DEADLINE_MS;
            try {
              aiMeta = await withTimeout(
                analyzeWithAI(tenderContent, { deadlineAt, startFromChunk, previousChunkResults, onChunkComplete }),
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

            await prisma.$transaction(async (tx) => {
              await tx.tenderRequirement.deleteMany({ where: { tenderId: id } });
              for (const req of aiResult.requirements) {
                await tx.tenderRequirement.create({
                  data: {
                    tenderId: id, title: req.title, description: req.description,
                    requirementType: req.requirementType, priority: req.priority,
                    exactFileName: req.exactFileName ?? null, requiredQuantity: req.requiredQuantity ?? null,
                    pageLimit: req.pageLimit ?? null, restrictions: req.restrictions ?? null,
                    sectionReference: req.sectionReference ?? null, sourceSectionHeading: req.sectionReference ?? null,
                    sourcePageNumber: req.sourcePage ?? null, sourceExactQuote: req.sourceQuote ?? null,
                    sourceExtractionMethod: effectiveExtractionMethod,
                    sourceConfidence: typeof req.sourcePage === "number" && req.sourcePage > 0 ? 0.8 : (typeof req.sourceQuote === "string" && req.sourceQuote.trim().length > 10 ? 0.7 : 0),
                  },
                });
              }

              const existingNotes = (tenderRecord.notes ?? "").split("\n");
              const analysisSourceNote = aiMeta.isPartial
                ? `Analysis source: AI (partial, ${aiMeta.completedChunks}/${aiMeta.totalChunks} chunks completed — deadline reached).`
                : "Analysis source: AI (re-run via AI Analyze button).";
              const updatedNotes = existingNotes
                .filter((line) => !/^Analysis source:/i.test(line.trim()) && !/^Analysis fallback diagnostics:/i.test(line.trim()))
                .concat([analysisSourceNote]).join("\n").trim() || null;

              const tenderStatus = aiMeta.isPartial ? "AI_ANALYSIS_PARTIAL" : "AI_ANALYZED";
              const clientNameForContaminationCheck = aiResult.procuringEntityName || tenderRecord.clientName;
              const contamination = detectMetadataContamination(clientNameForContaminationCheck);
              const legalNameContamination = detectMetadataContamination(aiResult.legalClientName);
              const donorAgencyContamination = detectMetadataContamination(aiResult.donorAgency);
              const implementingAgencyContamination = detectMetadataContamination(aiResult.implementingAgency);
              const anyEntityContaminated = contamination.contaminated || legalNameContamination.contaminated || donorAgencyContamination.contaminated || implementingAgencyContamination.contaminated;

              await tx.tender.update({
                where: { id },
                data: {
                  analysisSummary: aiResult.summary,
                  evaluationMethodology: aiResult.evaluationMethodology || null,
                  exactFileNaming: JSON.stringify(aiResult.exactFileNaming),
                  exactFileOrder: JSON.stringify(aiResult.exactFileOrder),
                  ...(aiResult.tenderCategory ? { category: aiResult.tenderCategory } : {}),
                  notes: updatedNotes, status: tenderStatus, stage: "ANALYSIS",
                  ...(aiResult.procuringEntityName != null && !containsMetadataPlaceholder(aiResult.procuringEntityName) ? { procuringEntityName: aiResult.procuringEntityName, ...(!tenderRecord.clientName ? { clientName: aiResult.procuringEntityName } : {}) } : {}),
                  ...(aiResult.legalClientName != null && !containsMetadataPlaceholder(aiResult.legalClientName) ? { legalClientName: aiResult.legalClientName } : {}),
                  ...(aiResult.donorAgency != null && !containsMetadataPlaceholder(aiResult.donorAgency) ? { donorAgency: aiResult.donorAgency } : {}),
                  ...(aiResult.implementingAgency != null && !containsMetadataPlaceholder(aiResult.implementingAgency) ? { implementingAgency: aiResult.implementingAgency } : {}),
                  ...(aiResult.country != null && isValidCountry(aiResult.country) ? { country: aiResult.country } : {}),
                  ...(aiResult.clientAddress != null && !containsMetadataPlaceholder(aiResult.clientAddress) ? { clientAddress: aiResult.clientAddress } : {}),
                  ...(aiResult.clientContactName != null && isValidClientContact(aiResult.clientContactName) ? { clientContactName: aiResult.clientContactName } : {}),
                  ...(aiResult.clientContactTitle != null && !containsMetadataPlaceholder(aiResult.clientContactTitle) ? { clientContactTitle: aiResult.clientContactTitle } : {}),
                  ...(aiResult.clientContactEmail != null && !containsMetadataPlaceholder(aiResult.clientContactEmail) ? { clientContactEmail: aiResult.clientContactEmail } : {}),
                  ...(aiResult.clientContactPhone != null && !containsMetadataPlaceholder(aiResult.clientContactPhone) ? { clientContactPhone: aiResult.clientContactPhone } : {}),
                  ...(aiResult.submissionAddress != null && !containsMetadataPlaceholder(aiResult.submissionAddress) ? { submissionAddress: aiResult.submissionAddress } : {}),
                  ...(aiResult.clientCity != null && !containsMetadataPlaceholder(aiResult.clientCity) ? { clientCity: aiResult.clientCity } : {}),
                  ...(aiResult.clientWebsite != null && !containsMetadataPlaceholder(aiResult.clientWebsite) ? { clientWebsite: aiResult.clientWebsite } : {}),
                  ...(aiResult.submissionEmailSubject != null && !containsMetadataPlaceholder(aiResult.submissionEmailSubject) ? { submissionEmailSubject: aiResult.submissionEmailSubject } : {}),
                  ...(aiResult.preBidChannel != null && !containsMetadataPlaceholder(aiResult.preBidChannel) ? { preBidChannel: aiResult.preBidChannel } : {}),
                  ...(aiResult.preBidMeetingDate != null ? { preBidMeetingDate: new Date(aiResult.preBidMeetingDate) } : {}),
                  ...(aiResult.preBidMeetingLocation != null && !containsMetadataPlaceholder(aiResult.preBidMeetingLocation) ? { preBidMeetingLocation: aiResult.preBidMeetingLocation } : {}),
                  ...(aiResult.clientRepresentative != null && !containsMetadataPlaceholder(aiResult.clientRepresentative) ? { clientRepresentative: aiResult.clientRepresentative } : {}),
                  ...(aiResult.procurementReferenceNumber != null && isValidReferenceNumber(aiResult.procurementReferenceNumber) ? { reference: aiResult.procurementReferenceNumber } : {}),
                  ...(aiResult.submissionMethod != null && !tenderRecord.submissionMethod ? { submissionMethod: aiResult.submissionMethod } : {}),
                  ...(aiResult.submissionEmails != null && !tenderRecord.submissionEmails ? { submissionEmails: aiResult.submissionEmails } : {}),
                  ...(aiResult.clientNameSourcePage !== undefined ? { clientNameSourcePage: aiResult.clientNameSourcePage } : {}),
                  ...(aiResult.clientNameSourceQuote !== undefined ? { clientNameSourceQuote: aiResult.clientNameSourceQuote } : {}),
                  ...(aiResult.submissionEmailSourcePage !== undefined ? { submissionEmailSourcePage: aiResult.submissionEmailSourcePage } : {}),
                  ...(aiResult.contactDetailsSource != null ? { contactDetailsSourceJson: JSON.stringify(aiResult.contactDetailsSource) } : {}),
                  ...(aiResult.submissionMethodSourcePage !== undefined ? { submissionMethodSourcePage: aiResult.submissionMethodSourcePage } : {}),
                  ...(aiResult.submissionMethodSourceQuote !== undefined ? { submissionMethodSourceQuote: aiResult.submissionMethodSourceQuote } : {}),
                  ...(aiResult.submissionAddressSourcePage !== undefined ? { submissionAddressSourcePage: aiResult.submissionAddressSourcePage } : {}),
                  ...(aiResult.submissionAddressSourceQuote !== undefined ? { submissionAddressSourceQuote: aiResult.submissionAddressSourceQuote } : {}),
                  ...(aiResult.evaluationCriteriaSource !== undefined ? { evaluationCriteriaSourceJson: aiResult.evaluationCriteriaSource ? JSON.stringify(aiResult.evaluationCriteriaSource) : null } : {}),
                  metadataContaminated: anyEntityContaminated,
                },
              });
            });

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
            void persistAllHealthToDb().catch(() => {});

            const fileQualitySnapshots = tenderRecord.files.map((f) => ({
              totalPages: (f as { totalPages?: number | null }).totalPages ?? null,
              extractedPages: (f as { extractedPages?: number | null }).extractedPages ?? null,
              ocrPages: (f as { ocrPages?: number | null }).ocrPages ?? null,
              failedPages: (f as { failedPages?: number | null }).failedPages ?? null,
              extractionScore: (f as { extractionScore?: number | null }).extractionScore ?? null,
            }));
            const extractionStatus = deriveExtractionStatus(fileQualitySnapshots);
            void prisma.tender.update({ where: { id }, data: { analysisExtractionStatus: extractionStatus } }).catch(() => {});

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
            console.error("[ai-analyze/stream] AI failed; regex fallback:", { category: diagnostics.category });
            void persistAllHealthToDb().catch(() => {});

            // Run regex fallback inline
            const result = analyzeTender(tenderRecord);
            const diagnosticsLine = formatFallbackDiagnosticsLine(diagnostics);
            const providerDiagnostics = buildProviderDiagnosticsSnapshot();
            await prisma.$transaction(async (tx) => {
              await tx.tenderRequirement.deleteMany({ where: { tenderId: id } });
              for (const req of result.requirements) {
                await tx.tenderRequirement.create({ data: { tenderId: id, ...req } });
              }
              const previousNotes = (tenderRecord.notes ?? "").split("\n").filter((line) => !/^Analysis source:/i.test(line.trim()) && !/^Analysis fallback diagnostics:/i.test(line.trim()));
              const notes = [...previousNotes, `Analysis source: Regex fallback (${diagnostics.category}).`, diagnosticsLine].filter(Boolean).join("\n").trim() || null;
              await tx.tender.update({ where: { id }, data: { analysisSummary: `${result.summary}\n\nFast fallback used because AI analysis did not complete. ${diagnosticsLine}`, exactFileNaming: JSON.stringify(result.exactFileNaming), exactFileOrder: JSON.stringify(result.exactFileOrder), notes, status: "ANALYSIS_REQUIRES_REVIEW", stage: "ANALYSIS", analysisExtractionStatus: "REGEX_FALLBACK_FROM_WEAK_EXTRACTION" } });
            });
            analysisResult = { ai: false, fallback: true, analysisSource: "REGEX_FALLBACK", summary: result.summary, requirementCount: result.requirements.length, fallbackDiagnostics: diagnostics, providerDiagnostics, nextAction: "RETRY_AI_ANALYZE_OR_APPROVE_FALLBACK" };
          }
        } else {
          if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
          const result = analyzeTender(tenderRecord);
          const diagnostics = buildAnalysisFallbackDiagnostics("No AI provider configured");
          const diagnosticsLine = formatFallbackDiagnosticsLine(diagnostics);
          emit({ phase: "saving", message: "Saving analysis results…" });
          await prisma.$transaction(async (tx) => {
            await tx.tenderRequirement.deleteMany({ where: { tenderId: id } });
            for (const req of result.requirements) {
              await tx.tenderRequirement.create({ data: { tenderId: id, ...req } });
            }
            const previousNotes = (tenderRecord.notes ?? "").split("\n").filter((line) => !/^Analysis source:/i.test(line.trim()) && !/^Analysis fallback diagnostics:/i.test(line.trim()));
            const notes = [...previousNotes, `Analysis source: Regex fallback (${diagnostics.category}).`, diagnosticsLine].filter(Boolean).join("\n").trim() || null;
            await tx.tender.update({ where: { id }, data: { analysisSummary: `${result.summary}\n\nFast fallback used because AI analysis did not complete. ${diagnosticsLine}`, exactFileNaming: JSON.stringify(result.exactFileNaming), exactFileOrder: JSON.stringify(result.exactFileOrder), notes, status: "FALLBACK_DRAFT_CREATED", stage: "ANALYSIS", analysisExtractionStatus: "REGEX_FALLBACK_FROM_WEAK_EXTRACTION" } });
          });
          analysisResult = { ai: false, fallback: false, analysisSource: "REGEX_FALLBACK", summary: result.summary, requirementCount: result.requirements.length, fallbackDiagnostics: diagnostics, providerDiagnostics: buildProviderDiagnosticsSnapshot() };
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

        emit({
          phase: "complete",
          status: analysisResult.fallback ? "FALLBACK" : (analysisMeta?.isPartial ? "AI_ANALYSIS_PARTIAL" : "AI_ANALYZED"),
          requirementCount: analysisResult.requirementCount,
          jobId: analysisJobId,
          message: `Analysis complete — ${analysisResult.requirementCount} requirements extracted`,
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
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = rateLimit(`analyze:${userId}`, AI_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded — too many analysis requests. Please wait a minute and retry.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
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

  async function runRegexFallback(errorMessage?: string, diagnostics?: AnalysisFallbackDiagnostics) {
    const result = analyzeTender(tenderRecord);
    const fallbackDiagnostics = diagnostics ?? (errorMessage ? buildAnalysisFallbackDiagnostics(errorMessage) : buildAnalysisFallbackDiagnostics("No AI provider configured"));
    const diagnosticsLine = formatFallbackDiagnosticsLine(fallbackDiagnostics);
    // Provider-specific snapshot so the fallback message is actionable
    // (which providers were tried, which are cooling down, safe category per
    // provider). Sourced from the in-memory health tracker — already redacted,
    // never includes keys, raw provider bodies, prompts, or proposal text.
    const providerDiagnostics = buildProviderDiagnosticsSnapshot();

    await prisma.$transaction(async (tx) => {
      await tx.tenderRequirement.deleteMany({ where: { tenderId: id } });
      for (const req of result.requirements) {
        await tx.tenderRequirement.create({ data: { tenderId: id, ...req } });
      }

      const previousNotes = (tenderRecord.notes ?? "")
        .split("\n")
        .filter((line) => !/^Analysis source:/i.test(line.trim()) && !/^Analysis fallback diagnostics:/i.test(line.trim()));
      const notes = [...previousNotes, `Analysis source: Regex fallback (${fallbackDiagnostics.category}).`, diagnosticsLine].filter(Boolean).join("\n").trim() || null;

      // When no AI chunks succeeded at all the analysis needs human review
      // before it can be trusted. When AI was partially involved (e.g. some
      // chunks succeeded before a timeout and then the fallback covered the
      // rest) we use the lighter FALLBACK_DRAFT_CREATED status instead.
      // calledWithAiChunks is only true when the error came from the catch
      // block of the AI path — i.e. at least the AI path was attempted.
      // In the non-AI path (isAIEnabled() === false) no chunks ran at all.
      const tenderStatus = errorMessage
        ? "ANALYSIS_REQUIRES_REVIEW"
        : "FALLBACK_DRAFT_CREATED";

      await tx.tender.update({
        where: { id },
        data: {
          analysisSummary: `${result.summary}\n\nFast fallback used because AI analysis did not complete. ${diagnosticsLine}`,
          exactFileNaming: JSON.stringify(result.exactFileNaming),
          exactFileOrder: JSON.stringify(result.exactFileOrder),
          notes,
          status: tenderStatus,
          stage: "ANALYSIS",
          analysisExtractionStatus: "REGEX_FALLBACK_FROM_WEAK_EXTRACTION",
        },
      });
    });

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
        const fileTexts = tenderRecord.files
          .map((f) => f.extractedText
            ? `[FILE: ${f.originalFileName}]\n${extractRelevantSections(stripExtractionHeader(f.extractedText), MAX_FILE_CHARS_FOR_AI_ANALYSIS)}`
            : `[FILE: ${f.originalFileName} ${f.classification ?? ""}]`)
          .join("\n\n");

        const companyContext = company?.documents?.length
          ? `\n\nCOMPANY DOCUMENTS AVAILABLE:\n${company.documents.map((d) => `- ${d.originalFileName} (${d.category})`).join("\n")}`
          : "";

        const tenderContent = [
          `TENDER: ${tenderRecord.title}`,
          // Cap description/intakeSummary so they don't crowd out the actual
          // file content. 2K each is enough for context without inflating the
          // total beyond the MAX_TOTAL_AI_CHARS budget.
          tenderRecord.description ? `DESCRIPTION: ${tenderRecord.description.slice(0, 2_000)}` : null,
          tenderRecord.intakeSummary ? `INTAKE NOTES: ${tenderRecord.intakeSummary.slice(0, 2_000)}` : null,
          fileTexts || null,
          companyContext || null,
        ].filter(Boolean).join("\n\n").slice(0, MAX_TOTAL_AI_CHARS);

        // Compute content hash for continuation validation and auto-resume discovery
        const contentHash = crypto.createHash("sha256").update(tenderContent).digest("hex").slice(0, 16);
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
        } catch (jobCreateErr) {
          console.warn("[ai-analyze] Failed to create AiJob record — continuing without job tracking:", jobCreateErr instanceof Error ? jobCreateErr.message : String(jobCreateErr));
        }

        // Restore provider cooldown state from DB before analysis.
        // A 2-second timeout prevents a slow DB from blocking the analysis.
        // The in-memory state is still usable without a successful restore.
        await Promise.race([
          restoreHealthFromDb(),
          new Promise<void>((r) => setTimeout(r, 2_000)),
        ]).catch(() => {});

        const deadlineAt = Date.now() + SAFE_DEADLINE_MS;
        const onChunkCompleteNonStream = analysisJob
          ? async ({ completed, totalChunks }: { completed: Array<{ index: number; result: AIAnalysisResult; provider?: string | null }>; totalChunks: number }) => {
              await prisma.aiJob.update({
                where: { id: analysisJob!.id },
                data: {
                  output: JSON.stringify(buildAiAnalyzePartialOutput(completed, totalChunks, contentHash)),
                },
              }).catch(() => {});
            }
          : undefined;
        let aiMeta: AnalysisWithMeta;
        try {
          aiMeta = await withTimeout(
            analyzeWithAI(tenderContent, { deadlineAt, startFromChunk, previousChunkResults, onChunkComplete: onChunkCompleteNonStream }),
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

        await prisma.$transaction(async (tx) => {
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
                sourceSectionHeading: req.sectionReference ?? null,
                sourcePageNumber: req.sourcePage ?? null,
                sourceExactQuote: req.sourceQuote ?? null,
                sourceExtractionMethod: effectiveExtractionMethodNonStreaming,
                sourceConfidence: typeof req.sourcePage === "number" && req.sourcePage > 0 ? 0.8 : (typeof req.sourceQuote === "string" && req.sourceQuote.trim().length > 10 ? 0.7 : 0),
              },
            });
          }

          const existingNotes = (tenderRecord.notes ?? "").split("\n");
          const analysisSourceNote = aiMeta.isPartial
            ? `Analysis source: AI (partial, ${aiMeta.completedChunks}/${aiMeta.totalChunks} chunks completed — deadline reached).`
            : "Analysis source: AI (re-run via AI Analyze button).";
          const updatedNotesLines = existingNotes
            .filter((line) => !/^Analysis source:/i.test(line.trim()) && !/^Analysis fallback diagnostics:/i.test(line.trim()))
            .concat([analysisSourceNote]);
          const updatedNotes = updatedNotesLines.join("\n").trim() || null;

          // Reflect the actual analysis source in the tender status so the UI
          // and downstream gates can distinguish AI success from partial AI and
          // regex fallback without parsing the notes field.
          //   AI full success   → "AI_ANALYZED"
          //   Partial (deadline) → "AI_ANALYSIS_PARTIAL"
          const tenderStatus = aiMeta.isPartial ? "AI_ANALYSIS_PARTIAL" : "AI_ANALYZED";

          // Contamination check on all entity name fields
          const clientNameForContaminationCheck = aiResult.procuringEntityName || tenderRecord.clientName;
          const contamination = detectMetadataContamination(clientNameForContaminationCheck);
          const legalNameContamination = detectMetadataContamination(aiResult.legalClientName);
          const donorAgencyContamination = detectMetadataContamination(aiResult.donorAgency);
          const implementingAgencyContamination = detectMetadataContamination(aiResult.implementingAgency);
          const anyEntityContaminated = contamination.contaminated || legalNameContamination.contaminated || donorAgencyContamination.contaminated || implementingAgencyContamination.contaminated;

          await tx.tender.update({
            where: { id },
            data: {
              analysisSummary: aiResult.summary,
              evaluationMethodology: aiResult.evaluationMethodology || null,
              exactFileNaming: JSON.stringify(aiResult.exactFileNaming),
              exactFileOrder: JSON.stringify(aiResult.exactFileOrder),
              // Tender-driven classification: when the analysis detected a
              // category, store it on the existing Tender.category column so
              // section planning / readiness / matching adapt to the actual
              // tender type instead of a fixed default. Detection is best-effort
              // — leave the prior value untouched when undetermined.
              ...(aiResult.tenderCategory ? { category: aiResult.tenderCategory } : {}),
              notes: updatedNotes,
              status: tenderStatus,
              stage: "ANALYSIS",
              // Extended client/procuring-entity extraction fields
              // Use != null (not !== undefined) so a null AI result never overwrites user-entered data.
              // Also back-fill the legacy clientName when it's blank — procuringEntityName is
              // the authoritative AI-extracted value; clientName drives generation gating.
              ...(aiResult.procuringEntityName != null && !containsMetadataPlaceholder(aiResult.procuringEntityName) ? {
                procuringEntityName: aiResult.procuringEntityName,
                ...(!tenderRecord.clientName ? { clientName: aiResult.procuringEntityName } : {}),
              } : {}),
              ...(aiResult.legalClientName != null && !containsMetadataPlaceholder(aiResult.legalClientName) ? { legalClientName: aiResult.legalClientName } : {}),
              ...(aiResult.donorAgency != null && !containsMetadataPlaceholder(aiResult.donorAgency) ? { donorAgency: aiResult.donorAgency } : {}),
              ...(aiResult.implementingAgency != null && !containsMetadataPlaceholder(aiResult.implementingAgency) ? { implementingAgency: aiResult.implementingAgency } : {}),
              // Full contact/location fields — only update when AI returned a real value;
              // skip placeholders ("N/A", "unknown", "Bid-Team to confirm", etc.) so they
              // do not overwrite null or previously-confirmed user data.
              ...(aiResult.country != null && isValidCountry(aiResult.country) ? { country: aiResult.country } : {}),
              ...(aiResult.clientAddress != null && !containsMetadataPlaceholder(aiResult.clientAddress) ? { clientAddress: aiResult.clientAddress } : {}),
              ...(aiResult.clientContactName != null && isValidClientContact(aiResult.clientContactName) ? { clientContactName: aiResult.clientContactName } : {}),
              ...(aiResult.clientContactTitle != null && !containsMetadataPlaceholder(aiResult.clientContactTitle) ? { clientContactTitle: aiResult.clientContactTitle } : {}),
              ...(aiResult.clientContactEmail != null && !containsMetadataPlaceholder(aiResult.clientContactEmail) ? { clientContactEmail: aiResult.clientContactEmail } : {}),
              ...(aiResult.clientContactPhone != null && !containsMetadataPlaceholder(aiResult.clientContactPhone) ? { clientContactPhone: aiResult.clientContactPhone } : {}),
              ...(aiResult.submissionAddress != null && !containsMetadataPlaceholder(aiResult.submissionAddress) ? { submissionAddress: aiResult.submissionAddress } : {}),
              ...(aiResult.clientCity != null && !containsMetadataPlaceholder(aiResult.clientCity) ? { clientCity: aiResult.clientCity } : {}),
              ...(aiResult.clientWebsite != null && !containsMetadataPlaceholder(aiResult.clientWebsite) ? { clientWebsite: aiResult.clientWebsite } : {}),
              ...(aiResult.submissionEmailSubject != null && !containsMetadataPlaceholder(aiResult.submissionEmailSubject) ? { submissionEmailSubject: aiResult.submissionEmailSubject } : {}),
              ...(aiResult.preBidChannel != null && !containsMetadataPlaceholder(aiResult.preBidChannel) ? { preBidChannel: aiResult.preBidChannel } : {}),
              ...(aiResult.preBidMeetingDate != null ? { preBidMeetingDate: new Date(aiResult.preBidMeetingDate) } : {}),
              ...(aiResult.preBidMeetingLocation != null && !containsMetadataPlaceholder(aiResult.preBidMeetingLocation) ? { preBidMeetingLocation: aiResult.preBidMeetingLocation } : {}),
              ...(aiResult.clientRepresentative != null && !containsMetadataPlaceholder(aiResult.clientRepresentative) ? { clientRepresentative: aiResult.clientRepresentative } : {}),
              // Procurement reference number — validate it's a real ref (has a digit, ≥3 chars, not a stop-word)
              ...(aiResult.procurementReferenceNumber != null && isValidReferenceNumber(aiResult.procurementReferenceNumber) ? { reference: aiResult.procurementReferenceNumber } : {}),
              // Submission method and emails — only set when AI extracted a value
              // and the DB field is currently blank (preserve user-corrected data)
              ...(aiResult.submissionMethod != null && !tenderRecord.submissionMethod ? { submissionMethod: aiResult.submissionMethod } : {}),
              ...(aiResult.submissionEmails != null && !tenderRecord.submissionEmails ? { submissionEmails: aiResult.submissionEmails } : {}),
              ...(aiResult.clientNameSourcePage !== undefined ? { clientNameSourcePage: aiResult.clientNameSourcePage } : {}),
              ...(aiResult.clientNameSourceQuote !== undefined ? { clientNameSourceQuote: aiResult.clientNameSourceQuote } : {}),
              ...(aiResult.submissionEmailSourcePage !== undefined ? { submissionEmailSourcePage: aiResult.submissionEmailSourcePage } : {}),
              // Per-field source provenance for contact/location fields (CLAUDE.md requirement)
              ...(aiResult.contactDetailsSource != null
                ? { contactDetailsSourceJson: JSON.stringify(aiResult.contactDetailsSource) }
                : {}),
              // Source traceability for submission method and address
              ...(aiResult.submissionMethodSourcePage !== undefined ? { submissionMethodSourcePage: aiResult.submissionMethodSourcePage } : {}),
              ...(aiResult.submissionMethodSourceQuote !== undefined ? { submissionMethodSourceQuote: aiResult.submissionMethodSourceQuote } : {}),
              ...(aiResult.submissionAddressSourcePage !== undefined ? { submissionAddressSourcePage: aiResult.submissionAddressSourcePage } : {}),
              ...(aiResult.submissionAddressSourceQuote !== undefined ? { submissionAddressSourceQuote: aiResult.submissionAddressSourceQuote } : {}),
              // Per-criterion evaluation criteria source
              ...(aiResult.evaluationCriteriaSource !== undefined ? { evaluationCriteriaSourceJson: aiResult.evaluationCriteriaSource ? JSON.stringify(aiResult.evaluationCriteriaSource) : null } : {}),
              // Flag contaminated entity name so the export gate can block
              metadataContaminated: anyEntityContaminated,
            },
          });
        });

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
        void persistAllHealthToDb().catch(() => {});

        // Compute and persist the extraction status so downstream gates
        // (Generate Docs, Export) can inspect it without re-deriving.
        const fileQualitySnapshots = tenderRecord.files.map((f) => ({
          totalPages: (f as { totalPages?: number | null }).totalPages ?? null,
          extractedPages: (f as { extractedPages?: number | null }).extractedPages ?? null,
          ocrPages: (f as { ocrPages?: number | null }).ocrPages ?? null,
          failedPages: (f as { failedPages?: number | null }).failedPages ?? null,
          extractionScore: (f as { extractionScore?: number | null }).extractionScore ?? null,
        }));
        const extractionStatus = deriveExtractionStatus(fileQualitySnapshots);
        void prisma.tender.update({
          where: { id },
          data: { analysisExtractionStatus: extractionStatus },
        }).catch(() => {});

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
        console.error("AI analysis failed; deterministic fallback used:", { category: diagnostics.category, message: diagnostics.message });
        // Persist failure state so the next cold start knows which providers are cooling down.
        void persistAllHealthToDb().catch(() => {});
        analysisResult = await runRegexFallback(msg, diagnostics);
      }
    } else {
      analysisResult = await runRegexFallback(undefined, buildAnalysisFallbackDiagnostics("No AI provider configured"));
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
      tender: updatedForResponse,
      extractionWarnings: extractionReports.filter((item) => item.quality.severity === "WARNING"),
    });
  } catch (error) {
    console.error("Analysis route error:", error);
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
