import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { analyzeWithAI, isAIEnabled } from "../../../../../lib/ai";
import { analyzeTender } from "../../../../../lib/engine/analysis";
import { logAction } from "../../../../../lib/audit";

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
            ? `${result.summary}\n\nAI analysis fallback used because AI failed: ${errorMessage}`
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
            ? `[FILE: ${f.originalFileName}]\n${f.extractedText.slice(0, 6000)}`
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

        const aiResult = await analyzeWithAI(tenderContent);

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
        console.error("AI analysis failed; deterministic fallback used:", aiError);
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
