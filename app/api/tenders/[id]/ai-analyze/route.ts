import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { analyzeWithAI, isAIEnabled, type AnalysisWithMeta } from "../../../../../lib/ai";
import { analyzeTender } from "../../../../../lib/engine/analysis";
import { logAction } from "../../../../../lib/audit";
import { rateLimit, AI_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../lib/request-id";
import { createNotification } from "../../../../../lib/notifications";
import { assessExtractionQuality } from "../../../../../lib/extraction-quality";
import { buildAnalysisFallbackDiagnostics, formatFallbackDiagnosticsLine, type AnalysisFallbackDiagnostics } from "../../../../../lib/engine/analysis-fallback-diagnostics";
import { buildProviderDiagnosticsSnapshot } from "../../../../../lib/ai-provider-health";
import { restoreHealthFromDb, persistAllHealthToDb } from "../../../../../lib/ai-provider-health-db";

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

// SAFE_DEADLINE_MS must stay within maxDuration (60s). On Vercel Hobby the
// platform hard-kills the function at 60s regardless of AI_ANALYSIS_TIMEOUT_MS.
// The outer withTimeout races against AI_ANALYSIS_TIMEOUT_MS but the inner
// deadlineAt caps chunk processing at SAFE_DEADLINE_MS so we always return
// a partial result rather than being killed mid-write.
const SAFE_DEADLINE_MS = Math.min(48_000, (maxDuration - 12) * 1_000);

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

  await prismaReady;
  const { id } = await params;
  const reqUrl = new URL(req.url);
  const force = reqUrl.searchParams.get("force") === "true";
  const continueJobId = reqUrl.searchParams.get("continue");
  let startFromChunk: number | undefined;
  let existingContentHash: string | undefined;
  if (continueJobId) {
    const existingJob = await prisma.aiJob.findFirst({
      where: { id: continueJobId, tenderId: id, userId },
    });
    if (existingJob?.output) {
      try {
        const savedOutput = JSON.parse(existingJob.output) as { completedChunks?: number; contentHash?: string };
        startFromChunk = savedOutput.completedChunks ?? 0;
        existingContentHash = savedOutput.contentHash;
      } catch { /* ignore parse errors — do a full re-run */ }
    }
  }

  const [tender, company] = await Promise.all([
    prisma.tender.findFirst({ where: { id, userId }, include: { files: true } }),
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

      await tx.tender.update({
        where: { id },
        data: {
          analysisSummary: `${result.summary}\n\nFast fallback used because AI analysis did not complete. ${diagnosticsLine}`,
          exactFileNaming: JSON.stringify(result.exactFileNaming),
          exactFileOrder: JSON.stringify(result.exactFileOrder),
          notes,
          status: "ANALYZED",
          stage: "ANALYSIS",
        },
      });
    });

    return {
      ai: false,
      fallback: Boolean(errorMessage),
      summary: result.summary,
      requirementCount: result.requirements.length,
      fallbackDiagnostics,
      providerDiagnostics,
    };
  }

  try {
    let analysisResult: {
      ai: boolean;
      fallback: boolean;
      summary: string;
      requirementCount: number;
      fallbackDiagnostics?: AnalysisFallbackDiagnostics;
      providerDiagnostics?: ReturnType<typeof buildProviderDiagnosticsSnapshot>;
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

        // Compute content hash for continuation validation
        const contentHash = crypto.createHash("sha256").update(tenderContent).digest("hex").slice(0, 16);
        // Validate content hash if continuing from a previous job
        if (existingContentHash && existingContentHash !== contentHash) {
          // Content changed — do a full re-run, ignore startFromChunk
          startFromChunk = undefined;
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
        let aiMeta: AnalysisWithMeta;
        try {
          aiMeta = await withTimeout(
            analyzeWithAI(tenderContent, { deadlineAt, startFromChunk }),
            AI_ANALYSIS_TIMEOUT_MS,
          );
        } catch (aiErr) {
          // Fail the job before re-throwing
          if (analysisJob) {
            const errMsg = aiErr instanceof Error ? aiErr.message : String(aiErr);
            const safeErrMsg = errMsg.replace(/sk-[a-zA-Z0-9_-]{10,}/g, "[KEY_REDACTED]").replace(/AIza[a-zA-Z0-9_-]{30,}/g, "[KEY_REDACTED]").replace(/Bearer\s+[a-zA-Z0-9._-]{10,}/gi, "Bearer [REDACTED]").slice(0, 300);
            await prisma.aiJob.update({
              where: { id: analysisJob.id },
              data: {
                status: "FAILED",
                finishedAt: new Date(),
                output: JSON.stringify({
                  analysisSource: "REGEX_FALLBACK",
                  nextAction: "RETRY_AI_ANALYZE",
                }),
                errorMessage: safeErrMsg,
              },
            }).catch(() => {});
          }
          throw aiErr;
        }
        const aiResult = aiMeta.result;

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
              status: "ANALYZED",
              stage: "ANALYSIS",
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
                contentHash,
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

        analysisResult = {
          ai: true,
          fallback: false,
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
      analysisResult = await runRegexFallback("No AI provider configured", buildAnalysisFallbackDiagnostics("No AI provider configured"));
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

    return NextResponse.json({
      success: true,
      ...analysisResult,
      code: fallbackCode,
      jobId: analysisJobId,
      chunks: analysisMeta ? {
        total: analysisMeta.totalChunks,
        completed: analysisMeta.completedChunks,
        failed: analysisMeta.failedChunks,
        skipped: analysisMeta.skippedChunks,
        isPartial: analysisMeta.isPartial,
      } : null,
      nextAction: analysisMeta?.isPartial ? "CONTINUE_AI_ANALYSIS" : null,
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
