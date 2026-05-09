import { notFound, redirect } from "next/navigation";
import { getSession } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { isAIEnabled } from "../../../../lib/ai";
import { TenderDetail } from "./tender-detail";
import { ExecutiveSnapshot } from "./executive-snapshot";
import { TenderAICopilotPanel } from "../../../../components/tender-ai-copilot-panel";
import { ExportReadinessPanel } from "../../../../components/export-readiness-panel";

export default async function TenderPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const { id } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id, userId },
    include: {
      files: {
        orderBy: { createdAt: "desc" },
        select: { id: true, fileName: true, originalFileName: true, mimeType: true, size: true, classification: true, extractedText: true, createdAt: true },
      },
      requirements: { orderBy: { createdAt: "asc" } },
      complianceGaps: { orderBy: { createdAt: "desc" } },
      generatedDocuments: {
        orderBy: { exactOrder: "asc" },
        select: { id: true, name: true, documentType: true, generationStatus: true, validationStatus: true, reviewStatus: true, reviewNotes: true, exactFileName: true, exactOrder: true, contentSummary: true },
      },
      expertMatches: {
        orderBy: { score: "desc" },
        include: { expert: { select: { id: true, fullName: true, title: true, yearsExperience: true, disciplines: true, sectors: true, trustLevel: true } } },
      },
      projectMatches: {
        orderBy: { score: "desc" },
        include: { project: { select: { id: true, name: true, clientName: true, country: true, sector: true, contractValue: true, currency: true, trustLevel: true } } },
      },
      complianceMatrix: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!tender) notFound();

  const ai = isAIEnabled();

  return (
    <>
      <ExecutiveSnapshot tender={tender} />
      <ExportReadinessPanel tenderId={tender.id} />
      {ai && <TenderAICopilotPanel tenderId={tender.id} />}
      <TenderDetail tender={tender} aiEnabled={ai} />
    </>
  );
}
