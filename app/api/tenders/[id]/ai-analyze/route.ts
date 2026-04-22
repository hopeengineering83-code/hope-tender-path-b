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
          take: 5, // limit context size
          orderBy: { createdAt: "desc" },
        },
      },
    }),
  ]);
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  try {
    let analysisResult;

    if (isAIEnabled()) {
      // Priority: extractedText from uploaded docs, then metadata
      const fileTexts = tender.files
        .map((f) => f.extractedText
          ? `[FILE: ${f.originalFileName}]\n${f.extractedText.slice(0, 2000)}`
          : `[FILE: ${f.originalFileName} ${f.classification ?? ""}]`)
        .join("\n\n");

      // Include company document context so AI can assess coverage
      const companyContext = company?.documents?.length
        ? `\n\nCOMPANY DOCUMENTS AVAILABLE:\n${company.documents.map((d) => `- ${d.originalFileName} (${d.category})`).join("\n")}`
        : "";

      const tenderContent = [
        `TENDER: ${tender.title}`,
        tender.description ? `DESCRIPTION: ${tender.description}` : null,
        tender.intakeSummary ? `INTAKE NOTES: ${tender.intakeSummary}` : null,
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

    await logAction({
      userId,
      action: "AI_ANALYZE",
      entityType: "Tender",
      entityId: id,
      description: `Analyzed tender "${tender.title}" — ${analysisResult.requirementCount} requirements extracted`,
      metadata: { ai: analysisResult.ai, requirementCount: analysisResult.requirementCount },
    });

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
