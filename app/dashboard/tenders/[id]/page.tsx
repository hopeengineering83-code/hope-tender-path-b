import { notFound, redirect } from "next/navigation";
import { getSession } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { isAIEnabled } from "../../../../lib/ai";
import { getTenderGenerationReadiness } from "../../../../lib/tender-generation-readiness";
import { TenderDetail } from "./tender-detail";
import { ExecutiveSnapshot } from "./executive-snapshot";
import { TenderIntakeDetailPanel } from "./tender-intake-detail-panel";
import { TenderAICopilotPanel } from "../../../../components/tender-ai-copilot-panel";
import { ExportReadinessPanel } from "../../../../components/export-readiness-panel";
import { EvaluatorObjectionsPanel } from "../../../../components/evaluator-objections-panel";
import { PricingWorkbookPanel } from "../../../../components/pricing-workbook-panel";
import { ProposalEvidenceReadinessPanel } from "../../../../components/proposal-evidence-readiness-panel";
import { GenerationReadinessPanel } from "../../../../components/generation-readiness-panel";
import { GenerationActionPanel } from "../../../../components/generation-action-panel";
import { SubmissionPlanReconciliationPanel } from "../../../../components/submission-plan-reconciliation-panel";
import { BidControlVerdictPanel } from "../../../../components/bid-control-verdict-panel";
import { EngineActionPanel } from "../../../../components/engine-action-panel";
import { AIHealthPanel } from "../../../../components/ai-health-panel";
import { ExtractionQualityPanel } from "../../../../components/extraction-quality-panel";
import { AnalysisQualityPanel } from "../../../../components/analysis-quality-panel";
import { MatchingQualityPanel } from "../../../../components/matching-quality-panel";
import { LegacyTenderActionHider } from "../../../../components/legacy-tender-action-hider";
import { CorruptedMetadataBanner } from "../../../../components/corrupted-metadata-banner";

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
  const generationReadiness = await getTenderGenerationReadiness(prisma, userId, tender.id);

  return (
    <>
      {/* Corrupted-metadata banner — surfaces stored values that fail the
          canonical validators (reference, clientName, country,
          clientContactName). Shows at the very top so users can't miss
          it. The one-click "Clean now" button calls the re-extract
          endpoint which now overwrites invalid stored values (see
          commit 7688111). When all four fields are valid, this returns
          null and renders nothing. */}
      <CorruptedMetadataBanner tender={{
        id: tender.id,
        reference: tender.reference,
        clientName: tender.clientName,
        country: tender.country,
        clientContactName: tender.clientContactName,
      }} />
      <ExecutiveSnapshot tender={tender} />
      <BidControlVerdictPanel tenderId={tender.id} />
      <AIHealthPanel />
      <div id="run-engine-action"><EngineActionPanel tenderId={tender.id} /></div>
      <ExtractionQualityPanel tenderId={tender.id} />
      <AnalysisQualityPanel tenderId={tender.id} />
      <MatchingQualityPanel tenderId={tender.id} />
      <GenerationReadinessPanel tenderId={tender.id} />
      <div id="generate-docs-action"><GenerationActionPanel tenderId={tender.id} readiness={generationReadiness} /></div>
      <SubmissionPlanReconciliationPanel tenderId={tender.id} />
      <TenderIntakeDetailPanel tender={tender} />
      <ProposalEvidenceReadinessPanel tenderId={tender.id} />
      <ExportReadinessPanel tenderId={tender.id} />
      <EvaluatorObjectionsPanel tenderId={tender.id} />
      <PricingWorkbookPanel tenderId={tender.id} />
      {ai && <TenderAICopilotPanel tenderId={tender.id} />}
      <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <span className="font-semibold">Authoritative actions:</span> use the structured panels above for Run Engine and Generate Docs. Only the duplicate legacy buttons are hidden below; other actions remain available.
      </div>
      <div id="legacy-tender-detail-actions">
        <LegacyTenderActionHider targetId="legacy-tender-detail-actions" />
        <TenderDetail tender={tender} aiEnabled={ai} />
      </div>
    </>
  );
}
