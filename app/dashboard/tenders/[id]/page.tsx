import type { ReactNode } from "react";
import { FinalPackageManifestPanel } from "../../../../components/final-package-manifest-panel";
import { SubmissionPlanTruthPanel } from "../../../../components/submission-plan-truth-panel";
import { AuthorityReviewTruthPanel } from "../../../../components/authority-review-truth-panel";
import { MetadataTruthPanel } from "../../../../components/metadata-truth-panel";
import { RequirementTruthBanner } from "../../../../components/requirement-truth-banner";
import { TenderWorkflowActionCenter } from "../../../../components/tender-workflow-action-center";
import { ExtractionSnapshotPanel } from "../../../../components/extraction-snapshot-panel";
import { notFound, redirect } from "next/navigation";
import { getSession } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { isAIEnabled } from "../../../../lib/ai";
import { getTenderGenerationReadinessStrict } from "../../../../lib/tender-generation-readiness-strict";
import { getCanonicalTenderReadiness } from "../../../../lib/canonical-tender-readiness";
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
import { AuthorityReviewPanel } from "../../../../components/authority-review-panel";
import { DocumentValidatorPanel } from "../../../../components/document-validator-panel";
import { AIAnalyzeRecoveryPanel } from "../../../../components/ai-analyze-recovery-panel";
import { AIAnalyzePanel } from "../../../../components/ai-analyze-panel";
import { ClientSubmissionDetailsPanel } from "../../../../components/client-submission-details-panel";
import { EvidenceCoveragePanel } from "../../../../components/evidence-coverage-panel";
import { ComplianceHeatmapPanel } from "../../../../components/compliance-heatmap-panel";
import { TenderHealthScorePanel } from "../../../../components/tender-health-score-panel";
import { AICopilotSuggestionsPanel } from "../../../../components/ai-copilot-suggestions-panel";
import VaultEvidenceSearchPanel from "../../../../components/vault-evidence-search-panel";
import { TenderSharePanel } from "../../../../components/tender-share-panel";
import { AuditTrailPanel } from "../../../../components/audit-trail-panel";
import { TenderChatPanelWrapper } from "../../../../components/tender-chat-panel-wrapper";
import TenderRecoveryCommandCenter from "../../../../components/tender-recovery-command-center";
import { CanonicalReadinessScoreWidget } from "../../../../components/canonical-readiness-score-widget";
import { MetadataCompletionPanel } from "../../../../components/metadata-completion-panel";
import RequirementCoveragePanel from "../../../../components/requirement-coverage-panel";
import { TenderSourceFilesPanel } from "../../../../components/tender-source-files-panel";
import { TenderDownloadActionsPanel } from "../../../../components/tender-download-actions-panel";
import { NextActionPanel } from "../../../../components/next-action-panel";
import { FinalSubmissionControlCenter } from "../../../../components/final-submission-control-center";
import { CorruptedMetadataBanner } from "../../../../components/corrupted-metadata-banner";
import { prisma as prismaClient } from "../../../../lib/prisma";

function WorkflowStage({
  number,
  title,
  description,
  children,
  open = false,
}: {
  number: number;
  title: string;
  description: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details open={open} className="group rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
      <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-4 marker:content-none">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">{number}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-slate-900">{title}</span>
          <span className="mt-0.5 block text-sm text-slate-600">{description}</span>
        </span>
        <span aria-hidden="true" className="mt-1 text-slate-400 transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="space-y-4 border-t border-slate-200 bg-white p-4 sm:p-5">{children}</div>
    </details>
  );
}

export default async function TenderPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const { id } = await params;
  const tender = await prismaClient.tender.findFirst({
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

  const fileTextMetrics = await prismaClient.$queryRaw<Array<{ id: string; extractedTextLength: number; isScannedPlaceholder: boolean }>>`
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
  const generationReadiness = await getTenderGenerationReadinessStrict(prismaClient, userId, tender.id).catch(() => null);
  const canonicalReadiness = await getCanonicalTenderReadiness(prismaClient, userId, tender.id).catch(() => null);

  return (
    <main className="space-y-5" aria-label="Tender workflow workspace">
      <CorruptedMetadataBanner tender={{
        id: tender.id,
        reference: tender.reference,
        clientName: tender.clientName,
        procuringEntityName: tender.procuringEntityName,
        country: tender.country,
        clientContactName: tender.clientContactName,
      }} />

      {canonicalReadiness && <ExecutiveSnapshot snapshot={canonicalReadiness} />}
      <TenderWorkflowActionCenter tenderId={tender.id} />
      <RequirementTruthBanner tenderId={tender.id} />
      <NextActionPanel tenderId={tender.id} />
      <TenderRecoveryCommandCenter tenderId={tender.id} />
      <CanonicalReadinessScoreWidget tenderId={tender.id} />
      <TenderHealthScorePanel tenderId={tender.id} canonicalReadiness={canonicalReadiness} />
      <BidControlVerdictPanel tenderId={tender.id} />
      <FinalSubmissionControlCenter tenderId={tender.id} generationReadiness={generationReadiness} />

      <nav aria-label="Tender workflow stages" className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        Work from Stage 1 through Stage 5. Each major action appears once and uses the canonical server-side readiness gates.
      </nav>

      <WorkflowStage number={1} title="Intake and extraction" description="Manage source documents and confirm submission-critical metadata." open>
        <TenderSourceFilesPanel tenderId={tender.id} initialFiles={tender.files} />
        <ExtractionQualityDashboard tenderId={tender.id} />
        <ExtractionSnapshotPanel tenderId={tender.id} />
        <TenderIntakeDetailPanel tender={tenderForUi} />
        <MetadataTruthPanel tenderId={tender.id} />
        <MetadataCompletionPanel tenderId={tender.id} />
        <ClientSubmissionDetailsPanel tenderId={tender.id} />
        <ExtractionQualityPanel tenderId={tender.id} />
      </WorkflowStage>

      <WorkflowStage number={2} title="Analysis and engine" description="Run the authoritative engine, inspect AI health, and repair incomplete analysis.">
        <AIAnalyzePanel tenderId={tender.id} aiEnabled={ai} />
        <AIHealthPanel />
        <EngineActionPanel
          tenderId={tender.id}
          vaultReviewedExperts={generationReadiness?.matchingQuality?.vaultReviewedExperts ?? 0}
          vaultReviewedProjects={generationReadiness?.matchingQuality?.vaultReviewedProjects ?? 0}
          lifecycleBlockersExist={(generationReadiness?.blockers?.length ?? 0) > 0}
        />
        <AnalysisQualityPanel tenderId={tender.id} />
        <AIAnalyzeRecoveryPanel tenderId={tender.id} />
        <RequirementCoveragePanel tenderId={tender.id} />
        <AICopilotSuggestionsPanel tenderId={tender.id} />
        {ai && <TenderChatPanelWrapper tenderId={tender.id} />}
        {ai && <TenderAICopilotPanel tenderId={tender.id} />}
      </WorkflowStage>

      <WorkflowStage number={3} title="Evidence and matching" description="Verify reviewed experts, projects, requirement coverage, and compliance evidence.">
        <MatchingQualityPanel tenderId={tender.id} />
        <ProposalEvidenceReadinessPanel tenderId={tender.id} />
        <EvidenceCoveragePanel tenderId={tender.id} />
        <VaultEvidenceSearchPanel tenderId={tender.id} />
        <ComplianceHeatmapPanel tenderId={tender.id} />
      </WorkflowStage>

      <WorkflowStage number={4} title="Generation and review" description="Confirm the submission plan, generate through the canonical gate, and complete document review.">
        <GenerationReadinessPanel tenderId={tender.id} readiness={generationReadiness} />
        <GenerationActionPanel tenderId={tender.id} readiness={generationReadiness} canonicalReadiness={canonicalReadiness} />
        <SubmissionPlanTruthPanel tenderId={tender.id} />
        <SubmissionPlanReconciliationPanel tenderId={tender.id} />
        <AuthorityReviewTruthPanel tenderId={tender.id} />
        <AuthorityReviewPanel tenderId={tender.id} />
        <DocumentValidatorPanel tenderId={tender.id} />
        <EvaluatorObjectionsPanel tenderId={tender.id} />
      </WorkflowStage>

      <WorkflowStage number={5} title="Final package and submission" description="Reconcile pricing, inspect the exact manifest, verify export readiness, and release the package.">
        <PricingWorkbookPanel tenderId={tender.id} />
        <FinalPackageManifestPanel tenderId={tender.id} />
        <ExportReadinessPanel tenderId={tender.id} />
        <TenderSharePanel tenderId={tender.id} />
        <AuditTrailPanel tenderId={tender.id} />
      </WorkflowStage>
      <TenderDownloadActionsPanel tenderId={tender.id} />
    </main>
  );
}
