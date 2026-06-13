import { notFound, redirect } from "next/navigation";
import { getSession } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { isAIEnabled } from "../../../../lib/ai";
import { getTenderGenerationReadiness } from "../../../../lib/tender-generation-readiness";
import { getCanonicalTenderReadiness } from "../../../../lib/canonical-tender-readiness";
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
import { ExtractionQualityDashboard } from "../../../../components/extraction-quality-dashboard";
import { AnalysisQualityPanel } from "../../../../components/analysis-quality-panel";
import { MatchingQualityPanel } from "../../../../components/matching-quality-panel";
import { CorruptedMetadataBanner } from "../../../../components/corrupted-metadata-banner";
import { FinalSubmissionControlCenter } from "../../../../components/final-submission-control-center";
import { NextActionPanel } from "../../../../components/next-action-panel";
import { FinalPackageManifestPanel } from "../../../../components/final-package-manifest-panel";
import { AuthorityReviewPanel } from "../../../../components/authority-review-panel";
import { DocumentValidatorPanel } from "../../../../components/document-validator-panel";
import { AIAnalyzeRecoveryPanel } from "../../../../components/ai-analyze-recovery-panel";
import { ClientSubmissionDetailsPanel } from "../../../../components/client-submission-details-panel";
import { EvidenceCoveragePanel } from "../../../../components/evidence-coverage-panel";
import { ComplianceHeatmapPanel } from "../../../../components/compliance-heatmap-panel";
import { TenderHealthScorePanel } from "../../../../components/tender-health-score-panel";
import { AICopilotSuggestionsPanel } from "../../../../components/ai-copilot-suggestions-panel";
import VaultEvidenceSearchPanel from "../../../../components/vault-evidence-search-panel";
import { TenderSharePanel } from "../../../../components/tender-share-panel";
import { AuditTrailPanel } from "../../../../components/audit-trail-panel";
import { TenderChatPanelWrapper } from "../../../../components/tender-chat-panel-wrapper";

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
        select: { id: true, fileName: true, originalFileName: true, mimeType: true, size: true, classification: true, createdAt: true, extractionScore: true, totalPages: true, extractedPages: true, ocrPages: true, failedPages: true },
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
        extractionScore: file.extractionScore ?? null,
        totalPages: file.totalPages ?? null,
        extractedPages: file.extractedPages ?? null,
        ocrPages: file.ocrPages ?? null,
        failedPages: file.failedPages ?? null,
      };
    }),
  };

  const ai = isAIEnabled();
  const generationReadiness = await getTenderGenerationReadiness(prisma, userId, tender.id).catch(() => null);
  const canonicalReadiness = await getCanonicalTenderReadiness(prisma, userId, tender.id).catch(() => null);

  return (
    <>
      <CorruptedMetadataBanner tender={{
        id: tender.id,
        reference: tender.reference,
        clientName: tender.clientName,
        procuringEntityName: (tender as Record<string, unknown>).procuringEntityName as string | null | undefined,
        country: tender.country,
        clientContactName: tender.clientContactName,
      }} />
      <ExecutiveSnapshot tender={tenderForUi} canonicalReadiness={canonicalReadiness} />
      <div id="extraction-quality"><ExtractionQualityDashboard tenderId={tender.id} /></div>
      <NextActionPanel tenderId={tender.id} />
      {ai && <TenderChatPanelWrapper tenderId={tender.id} />}
      <TenderHealthScorePanel tenderId={tender.id} canonicalReadiness={canonicalReadiness} />
      <AICopilotSuggestionsPanel tenderId={tender.id} />
      <BidControlVerdictPanel tenderId={tender.id} />
      <FinalSubmissionControlCenter tenderId={tender.id} generationReadiness={generationReadiness} />
      <AIHealthPanel />
      <div id="run-engine-action"><EngineActionPanel
        tenderId={tender.id}
        vaultReviewedExperts={generationReadiness?.matchingQuality?.vaultReviewedExperts ?? 0}
        vaultReviewedProjects={generationReadiness?.matchingQuality?.vaultReviewedProjects ?? 0}
        lifecycleBlockersExist={(generationReadiness?.blockers?.length ?? 0) > 0}
      /></div>
      <div id="extraction-quality-detail"><ExtractionQualityPanel tenderId={tender.id} /></div>
      <div id="analysis-quality"><AnalysisQualityPanel tenderId={tender.id} /></div>
      <AIAnalyzeRecoveryPanel tenderId={tender.id} />
      <ClientSubmissionDetailsPanel tenderId={tender.id} />
      <div id="matching-quality"><MatchingQualityPanel tenderId={tender.id} /></div>
      <GenerationReadinessPanel tenderId={tender.id} readiness={generationReadiness} />
      <div id="generate-docs-action"><GenerationActionPanel tenderId={tender.id} readiness={generationReadiness} canonicalReadiness={canonicalReadiness} /></div>
      <SubmissionPlanReconciliationPanel tenderId={tender.id} />
      <TenderIntakeDetailPanel tender={tenderForUi} />
      <div id="proposal-evidence-readiness"><ProposalEvidenceReadinessPanel tenderId={tender.id} /></div>
      <EvidenceCoveragePanel tenderId={tender.id} />
      <VaultEvidenceSearchPanel tenderId={tender.id} />

      <AuthorityReviewPanel tenderId={tender.id} />
      <DocumentValidatorPanel tenderId={tender.id} />
      <FinalPackageManifestPanel tenderId={tender.id} />
      <ExportReadinessPanel tenderId={tender.id} />
      <EvaluatorObjectionsPanel tenderId={tender.id} />
      <ComplianceHeatmapPanel tenderId={tender.id} />
      <TenderSharePanel tenderId={tender.id} />
      <AuditTrailPanel tenderId={tender.id} />
      <PricingWorkbookPanel tenderId={tender.id} />
      {ai && <TenderAICopilotPanel tenderId={tender.id} />}
      <div id="legacy-tender-detail-actions">
        <TenderDetail tender={tenderForUi} aiEnabled={ai} canonicalReadiness={canonicalReadiness} />
      </div>
    </>
  );
}
