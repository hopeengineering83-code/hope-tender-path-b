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

// Vercel route timeout — Claude tender analysis needs >10s default.
// 60 = Hobby max; Pro applies its own plan limit when exceeded.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// In-route timeout for the analyzeWithAI() call. This is a SECOND timeout
// layered inside the Vercel maxDuration window — its purpose is to fail
// gracefully (return a deterministic-fallback analysis) before Vercel
// kills the whole function. Default leaves a buffer below maxDuration so
// the route has time to handle the timeout, run the fallback, and respond.
//
// Tier-aware defaults (matches the pattern used by
// ANTHROPIC_MAX_OUTPUT_TOKENS, MAX_REFINEMENT_ATTEMPTS, etc.):
//
//   Tier 1 (Vercel Hobby, 60s function cap):  50_000   — 50s leaves
//     a 10s buffer for fallback rendering and response. Long tenders
//     on Tier 1 will hit this — that's expected behaviour, the regex
//     fallback takes over.
//
//   Tier 2+ (Vercel Pro, 300s function cap): 180_000   — 3 minutes is
//     enough for Claude to chunk-analyse a 200KB tender body, and leaves
//     2 minutes of buffer for response handling. Pre-this-change, Tier
//     2 Pro deployments hit the 50s ceiling on routine 10-15KB tender
//     PDFs and silently fell through to regex — see the PHARO PLC
//     screenshot ("AI analysis timed out after 50 seconds").
//
//   Tier 3+ (Enterprise):                    240_000   — 4 minutes; same
//     cap as the previously-documented override.
//
// Explicit AI_ANALYSIS_TIMEOUT_MS env var still wins. Range: 5s-600s.
const AI_ANALYSIS_TIMEOUT_MS = (() => {
  const raw = Number(process.env.AI_ANALYSIS_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 5_000 && raw <= 600_000) return raw;
  const tier = (process.env.ANTHROPIC_TIER || "").trim();
  return tier === "1" ? 50_000
    : tier === "3" || tier === "4" ? 240_000
    : 180_000; // Tier 2 default
})();

// Per-file character cap for AI analysis. Pre-this-change: 3,500 chars
// (~25% of a typical 14KB tender PDF), causing the AI to see only the
// first page of a multi-page tender. Result: shallow analysis that
// missed the evaluation criteria, scoring matrix, and submission rules
// (usually located in the middle/end of the document).
//
// New default 12,000 chars/file:
//   - Covers a full 14KB tender PDF (the user's PHARO PLC screenshot)
//     when there is a single file.
//   - For multi-file tenders, the sum stays under
//     ANALYSIS_CHUNK_SOFT_LIMIT (60K) until ~5 files of 12K each, at
//     which point the chunked-analysis path in lib/ai.ts takes over.
//   - Override via TENDER_AI_MAX_FILE_CHARS env var. Range 1,000-50,000.
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

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = rateLimit(`analyze:${userId}`, AI_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded — too many analysis requests. Please wait a minute and retry.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
    );
  }

  await prismaReady;
  const { id } = await params;
  const force = new URL(req.url).searchParams.get("force") === "true";

  const [tender, company] = await Promise.all([
    prisma.tender.findFirst({
      where: { id, userId },
      include: { files: true },
    }),
    prisma.company.findUnique({
      where: { userId },
      include: {
        documents: {
          select: { category: true, originalFileName: true, extractedText: true },
          take: 5,
          orderBy: { createdAt: "desc" },
        },
      },
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

  async function runRegexFallback(errorMessage?: string) {
    const result = analyzeTender(tenderRecord);
    await prisma.$transaction(async (tx) => {
      await tx.tenderRequirement.deleteMany({ where: { tenderId: id } });
      for (const req of result.requirements) {
        await tx.tenderRequirement.create({ data: { tenderId: id, ...req } });
      }
      await tx.tender.update({
        where: { id },
        data: {
          analysisSummary: errorMessage
            ? `${result.summary}\n\nFast fallback used because cloud analysis was unavailable or slow: ${errorMessage}`
            : result.summary,
          exactFileNaming: JSON.stringify(result.exactFileNaming),
          exactFileOrder: JSON.stringify(result.exactFileOrder),
          status: "ANALYZED",
          stage: "ANALYSIS",
        },
      });
    });
    return { ai: false, fallback: Boolean(errorMessage), summary: result.summary, requirementCount: result.requirements.length };
  }

  try {
    let analysisResult;

    if (isAIEnabled()) {
      try {
        // Strip the legitimate "[PDF text extracted from N page(s) using XXX.]"
        // header line that extract-text.ts prepends to multi-page PDFs and
        // OCR'd PDFs. Without this strip, the AI's prompt gets a confusing
        // metadata line where it expects tender content. Same fix as
        // run-tender-engine.ts (PR #244 — root-cause unblock for the
        // "Extracted tender text is only 0 chars" symptom).
        const stripExtractionHeader = (txt: string): string =>
          txt.replace(/^\[(?:PDF text|OCR text)[^\]]*\]\s*\n+/i, "").trim();

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

          // Clear stale "Analysis source: regex fallback (REGEX_FALLBACK_NO_TEXT)"
          // line from notes when this AI run succeeds. Previously the notes
          // field stayed stale because runTenderEngine had stamped a
          // fallback message on first upload (due to the bracket-prefix
          // bug, fixed in PR #244 elsewhere). Even after AI Analyze
          // succeeded, users saw the misleading "0 chars / regex fallback"
          // message in the Notes panel. Surgical fix: replace ONLY the
          // "Analysis source: ..." line, preserve every other line in
          // notes (matching summary, expert/project counts, etc.).
          const existingNotes = (tenderRecord.notes ?? "").split("\n");
          const updatedNotesLines = existingNotes
            .filter((line) => !/^Analysis source:/i.test(line.trim()))
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
        console.error("AI analysis slow or failed; deterministic fallback used:", aiError);
        analysisResult = await runRegexFallback(msg.slice(0, 240));
      }
    } else {
      analysisResult = await runRegexFallback();
    }

    await logAction({
      userId,
      action: "AI_ANALYZE",
      entityType: "Tender",
      entityId: id,
      description: `Analyzed tender "${tenderRecord.title}" — ${analysisResult.requirementCount} requirements extracted${analysisResult.fallback ? " using fallback" : ""}`,
      metadata: { ai: analysisResult.ai, fallback: analysisResult.fallback, requirementCount: analysisResult.requirementCount, forcedPoorExtraction: force, extractionWarnings: extractionReports.filter((item) => item.quality.severity === "WARNING") },
      requestId,
    });

    const updated = await prisma.tender.findUnique({
      where: { id },
      include: { requirements: true, files: true, complianceGaps: true, generatedDocuments: true },
    });

    void createNotification({ userId, type: "TENDER_ANALYZED", title: `Analysis complete for "${tenderRecord.title}"`, body: `${analysisResult.requirementCount} requirements extracted${analysisResult.fallback ? " (regex fallback)" : " by AI"}.`, entityType: "Tender", entityId: id, link: `/dashboard/tenders/${id}` });
    return NextResponse.json({ success: true, ...analysisResult, tender: updated, extractionWarnings: extractionReports.filter((item) => item.quality.severity === "WARNING") });
  } catch (error) {
    console.error("Analysis route error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Analysis failed" }, { status: 500 });
  }
}
