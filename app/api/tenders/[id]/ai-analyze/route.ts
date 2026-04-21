import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { analyzeWithAI, isAIEnabled } from "../../../../../lib/ai";
import { analyzeTender } from "../../../../../lib/engine/analysis";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;

  const tender = await prisma.tender.findFirst({
    where: { id, userId },
    include: { files: true },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  try {
    let analysisResult;

    if (isAIEnabled()) {
      const tenderContent = [
        tender.title,
        tender.description,
        tender.intakeSummary,
        ...tender.files.map((f) => `${f.originalFileName} ${f.classification ?? ""}`),
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

      analysisResult = { ai: true, summary: aiResult.summary, requirementCount: aiResult.requirements.length };
    } else {
      // Fallback: regex-based analysis
      const result = analyzeTender(tender);
      await prisma.$transaction(async (tx) => {
        await tx.tenderRequirement.deleteMany({ where: { tenderId: id } });
        for (const req of result.requirements) {
          await tx.tenderRequirement.create({
            data: { tenderId: id, ...req },
          });
        }
        await tx.tender.update({
          where: { id },
          data: {
            analysisSummary: result.summary,
            exactFileNaming: JSON.stringify(result.exactFileNaming),
            exactFileOrder: JSON.stringify(result.exactFileOrder),
            status: "ANALYZED",
            stage: "ANALYSIS",
          },
        });
      });
      analysisResult = { ai: false, summary: result.summary, requirementCount: result.requirements.length };
    }

    const updated = await prisma.tender.findUnique({
      where: { id },
      include: { requirements: true, files: true, complianceGaps: true, generatedDocuments: true },
    });

    return NextResponse.json({ success: true, ...analysisResult, tender: updated });
  } catch (error) {
    console.error("AI analysis error:", error);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
