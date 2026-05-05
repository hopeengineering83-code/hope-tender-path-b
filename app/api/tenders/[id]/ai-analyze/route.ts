import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { analyzeWithAI, isAIEnabled } from "../../../../../lib/ai";
import { analyzeTender } from "../../../../../lib/engine/analysis";
import { logAction } from "../../../../../lib/audit";

// Vercel route timeout — Claude tender analysis needs >10s default.
// 60 = Hobby max; Pro applies its own plan limit when exceeded.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// In-route timeout for the analyzeWithAI() call. This is a SECOND timeout
// layered inside the Vercel maxDuration window — its purpose is to fail
// gracefully (return a deterministic-fallback analysis) before Vercel
// kills the whole function. Default leaves a 10-second buffer below
// maxDuration so the route has time to handle the timeout, run the
// fallback, and respond.
//
// Default raised from 25s → 50s to fit Claude (Tier 1+) which routinely
// takes 25–45s for tender analysis on long source documents. Override
// via AI_ANALYSIS_TIMEOUT_MS (e.g. when on Vercel Pro with maxDuration
// 300, set AI_ANALYSIS_TIMEOUT_MS=240000 to give Claude 4 minutes
// before falling back).
const AI_ANALYSIS_TIMEOUT_MS = (() => {
  const raw = Number(process.env.AI_ANALYSIS_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 5_000 && raw <= 600_000) return raw;
  return 50_000;
})();
const MAX_FILE_CHARS_FOR_AI_ANALYSIS = 3_500;

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

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;

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
        const fileTexts = tenderRecord.files
          .map((f) => f.extractedText
            ? `[FILE: ${f.originalFileName}]\n${f.extractedText.slice(0, MAX_FILE_CHARS_FOR_AI_ANALYSIS)}`
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

          await tx.tender.update({
            where: { id },
            data: {
              analysisSummary: aiResult.summary,
              evaluationMethodology: aiResult.evaluationMethodology || null,
              exactFileNaming: JSON.stringify(aiResult.exactFileNaming),
              exactFileOrder: JSON.stringify(aiResult.exactFileOrder),
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
      metadata: { ai: analysisResult.ai, fallback: analysisResult.fallback, requirementCount: analysisResult.requirementCount },
    });

    const updated = await prisma.tender.findUnique({
      where: { id },
      include: { requirements: true, files: true, complianceGaps: true, generatedDocuments: true },
    });

    return NextResponse.json({ success: true, ...analysisResult, tender: updated });
  } catch (error) {
    console.error("Analysis route error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Analysis failed" }, { status: 500 });
  }
}
