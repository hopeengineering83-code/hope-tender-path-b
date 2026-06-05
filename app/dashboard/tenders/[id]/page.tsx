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
import { FinalSubmissionControlCenter } from "../../../../components/final-submission-control-center";
import { NextActionPanel } from "../../../../components/next-action-panel";
import { FinalPackageManifestPanel } from "../../../../components/final-package-manifest-panel";
import { DocumentValidatorPanel } from "../../../../components/document-validator-panel";
import { AIAnalyzeRecoveryPanel } from "../../../../components/ai-analyze-recovery-panel";
import { EvidenceCoveragePanel } from "../../../../components/evidence-coverage-panel";
import { ComplianceHeatmapPanel } from "../../../../components/compliance-heatmap-panel";
import { TenderHealthScorePanel } from "../../../../components/tender-health-score-panel";
import VaultEvidenceSearchPanel from "../../../../components/vault-evidence-search-panel";

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
        select: { id: true, fileName: true, originalFileName: true, mimeType: true, size: true, classification: true, createdAt: true },
      },
      requirements: { orderBy: { createdAt: "asc" } },
      complianceGaps: { orderBy: { createdAt: "desc" } },
      generatedDocuments: {
        orderBy: { exactOrder: "asc" },
        select: { id: true, name: true, documentType: true, generationStatus: true, validationStatus: true, reviewStatus: true, reviewNotes: true, exactFileName: true, exactOrder: true, contentSummary: true, reviewedExpertCount: true, draftExpertCount: true, reviewedProjectCount: true, draftProjectCount: true },
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

  const fileTextMetrics = await prisma.$queryRaw<Array<{ id: string; extractedTextLength: number; isScannedPlaceholder: boolean }>>`
    SELECT
      id,
      COALESCE(char_length("extractedText"), 0)::int AS "extractedTextLength",
      COALESCE("extractedText" LIKE '[Scanned%', false) AS "isScannedPlaceholder"
    FROM "TenderFile"
    WHERE "tenderId" = ${tender.id}
  `.catch(() => [] as Array<{ id: string; extractedTextLength: number; isScannedPlaceholder: boolean }>);
  const fileTextMetricById = new Map(fileTextMetrics.map((file) => [file.id, file]));
  const tenderForUi = {
    ...tender,
    files: tender.files.map((file) => {
      const metric = fileTextMetricById.get(file.id);
      return {
        ...file,
        extractedTextLength: metric?.extractedTextLength ?? 0,
        isScannedPlaceholder: metric?.isScannedPlaceholder ?? false,
      };
    }),
  };

  const ai = isAIEnabled();
  const generationReadiness = await getTenderGenerationReadiness(prisma, userId, tender.id).catch(() => null);

  return (
    <>
      <CorruptedMetadataBanner tender={{
        id: tender.id,
        reference: tender.reference,
        clientName: tender.clientName,
        country: tender.country,
        clientContactName: tender.clientContactName,
      }} />
      <ExecutiveSnapshot tender={tenderForUi} />
      <NextActionPanel tenderId={tender.id} />
      <TenderHealthScorePanel tenderId={tender.id} />
      <BidControlVerdictPanel tenderId={tender.id} />
      <FinalSubmissionControlCenter tenderId={tender.id} generationReadiness={generationReadiness} />
      <AIHealthPanel />
      <div id="run-engine-action"><EngineActionPanel
        tenderId={tender.id}
        vaultReviewedExperts={generationReadiness?.matchingQuality?.vaultReviewedExperts ?? 0}
        vaultReviewedProjects={generationReadiness?.matchingQuality?.vaultReviewedProjects ?? 0}
        lifecycleBlockersExist={(generationReadiness?.blockers?.length ?? 0) > 0}
      /></div>
      <ExtractionQualityPanel tenderId={tender.id} />
      <div id="analysis-quality"><AnalysisQualityPanel tenderId={tender.id} /></div>
      <AIAnalyzeRecoveryPanel tenderId={tender.id} />
      <div id="matching-quality"><MatchingQualityPanel tenderId={tender.id} /></div>
      <GenerationReadinessPanel tenderId={tender.id} />
      <div id="generate-docs-action"><GenerationActionPanel tenderId={tender.id} readiness={generationReadiness} /></div>
      <SubmissionPlanReconciliationPanel tenderId={tender.id} />
      <TenderIntakeDetailPanel tender={tenderForUi} />
      <div id="proposal-evidence-readiness"><ProposalEvidenceReadinessPanel tenderId={tender.id} /></div>
      <EvidenceCoveragePanel tenderId={tender.id} />
      <VaultEvidenceSearchPanel tenderId={tender.id} />

      <DocumentValidatorPanel tenderId={tender.id} />
      <FinalPackageManifestPanel tenderId={tender.id} />
      <ExportReadinessPanel tenderId={tender.id} />
      <EvaluatorObjectionsPanel tenderId={tender.id} />
      <ComplianceHeatmapPanel tenderId={tender.id} />
      <PricingWorkbookPanel tenderId={tender.id} />
      {ai && <TenderAICopilotPanel tenderId={tender.id} />}
      <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <span className="font-semibold">Authoritative actions:</span> use the Final Submission Control Center and structured panels above. Only the duplicate legacy buttons are hidden below; other actions remain available.
      </div>
      <div id="legacy-tender-detail-actions">
        <LegacyTenderActionHider targetId="legacy-tender-detail-actions" />
        <TenderDetail tender={tenderForUi} aiEnabled={ai} />
      </div>
    </>
  );
}
