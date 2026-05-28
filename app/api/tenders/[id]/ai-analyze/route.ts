import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { analyzeWithAI, isAIEnabled } from "../../../../../lib/ai";
import { analyzeTender } from "../../../../../lib/engine/analysis";
import { logAction } from "../../../../../lib/audit";
import { rateLimit, AI_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../lib/request-id";
import { createNotification } from "../../../../../lib/notifications";
import { assessExtractionQuality } from "../../../../../lib/extraction-quality";
import { buildAnalysisFallbackDiagnostics, formatFallbackDiagnosticsLine, type AnalysisFallbackDiagnostics } from "../../../../../lib/engine/analysis-fallback-diagnostics";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const AI_ANALYSIS_TIMEOUT_MS = (() => {
  const raw = Number(process.env.AI_ANALYSIS_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 5_000 && raw <= 600_000) return raw;
  const tier = (process.env.ANTHROPIC_TIER || "").trim();
  return tier === "1" ? 50_000 : tier === "3" || tier === "4" ? 240_000 : 180_000;
})();

const MAX_FILE_CHARS_FOR_AI_ANALYSIS = (() => {
  const raw = Number(process.env.TENDER_AI_MAX_FILE_CHARS);
  if (Number.isFinite(raw) && raw >= 1_000 && raw <= 50_000) return raw;
  return 12_000;
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

function stripExtractionHeader(txt: string): string {
  return txt.replace(/^\[(?:PDF text|OCR text)[^\]]*\]\s*\n+/i, "").trim();
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

  await prismaReady;
  const { id } = await params;
  const force = new URL(req.url).searchParams.get("force") === "true";

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
    };
  }

  try {
    let analysisResult: {
      ai: boolean;
      fallback: boolean;
      summary: string;
      requirementCount: number;
      fallbackDiagnostics?: AnalysisFallbackDiagnostics;
    };

    if (isAIEnabled()) {
      try {
        const fileTexts = tenderRecord.files
          .map((f) => f.extractedText
            ? `[FILE: ${f.originalFileName}]\n${stripExtractionHeader(f.extractedText).slice(0, MAX_FILE_CHARS_FOR_AI_ANALYSIS)}`
            : `[FILE: ${f.originalFileName} ${f.classification ?? ""}]`)
          .join("\n\n");

        const companyContext = company?.documents?.length
          ? `\n\nCOMPANY DOCUMENTS AVAILABLE:\n${company.documents.map((d) => `- ${d.originalFileName} (${d.category})`).join("\n")}`
          : "";

        const tenderContent = [
          `TENDER: ${tenderRecord.title}`,
          tenderRecord.description ? `DESCRIPTION: ${tenderRecord.description}` : null,
          tenderRecord.intakeSummary ? `INTAKE NOTES: ${tenderRecord.intakeSummary}` : null,
          fileTexts || null,
          companyContext || null,
        ].filter(Boolean).join("\n\n");

        const aiResult = await withTimeout(analyzeWithAI(tenderContent), AI_ANALYSIS_TIMEOUT_MS);

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
          const updatedNotesLines = existingNotes
            .filter((line) => !/^Analysis source:/i.test(line.trim()) && !/^Analysis fallback diagnostics:/i.test(line.trim()))
            .concat(["Analysis source: AI (re-run via AI Analyze button)."]);
          const updatedNotes = updatedNotesLines.join("\n").trim() || null;

          await tx.tender.update({
            where: { id },
            data: {
              analysisSummary: aiResult.summary,
              evaluationMethodology: aiResult.evaluationMethodology || null,
              exactFileNaming: JSON.stringify(aiResult.exactFileNaming),
              exactFileOrder: JSON.stringify(aiResult.exactFileOrder),
              notes: updatedNotes,
              status: "ANALYZED",
              stage: "ANALYSIS",
            },
          });
        });

        analysisResult = { ai: true, fallback: false, summary: aiResult.summary, requirementCount: aiResult.requirements.length };
      } catch (aiError) {
        const msg = aiError instanceof Error ? aiError.message : String(aiError);
        const diagnostics = buildAnalysisFallbackDiagnostics(msg);
        console.error("AI analysis failed; deterministic fallback used:", { category: diagnostics.category, message: diagnostics.message });
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
        requirementCount: analysisResult.requirementCount,
        forcedPoorExtraction: force,
        extractionWarnings: extractionReports.filter((item) => item.quality.severity === "WARNING"),
      },
      requestId,
    });

    const updated = await prisma.tender.findUnique({ where: { id }, include: { requirements: true, files: true, complianceGaps: true, generatedDocuments: true } });

    void createNotification({
      userId,
      type: "TENDER_ANALYZED",
      title: `Analysis complete for "${tenderRecord.title}"`,
      body: `${analysisResult.requirementCount} requirements extracted${analysisResult.fallback ? ` (regex fallback: ${analysisResult.fallbackDiagnostics?.category ?? "UNKNOWN"})` : " by AI"}.`,
      entityType: "Tender",
      entityId: id,
      link: `/dashboard/tenders/${id}`,
    });

    return NextResponse.json({
      success: true,
      ...analysisResult,
      tender: updated,
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
