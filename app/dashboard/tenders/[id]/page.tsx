import type { ReactNode } from "react";
import Link from "next/link";
import { FinalPackageManifestPanel } from "../../../../components/final-package-manifest-panel";
import { ArrowRightIcon, ChevronDownIcon } from "../../../../components/icons";
import { SubmissionPlanTruthPanel } from "../../../../components/submission-plan-truth-panel";
import { SubmissionPlanCompletenessPanel } from "../../../../components/submission-plan-completeness-panel";
// ClientSubmissionDetailsPanel is intentionally NOT imported here — it was
// found to be a duplicate of TenderIntakeDetailPanel in the normal Stage 1
// workflow (see tests/generic-tender-ui-defects.test.ts "defect 3"). It
// remains available as a component file for a future Final Submission Check
// or admin-diagnostics surface, but must not appear in the normal draft
// workflow.
import { RequirementTruthBanner } from "../../../../components/requirement-truth-banner";
import { notFound, redirect } from "next/navigation";
import { getSession, getCurrentUser } from "../../../../lib/auth";
import { canMutateTender } from "../../../../lib/recovery-command-actions";
import { prismaReady } from "../../../../lib/prisma";
import { isAIEnabled } from "../../../../lib/ai";
import { getTenderGenerationReadinessStrict } from "../../../../lib/tender-generation-readiness-strict";
import { getCanonicalTenderReadiness } from "../../../../lib/canonical-tender-readiness";
import { TenderIntakeDetailPanel } from "./tender-intake-detail-panel";
import { TenderAICopilotPanel } from "../../../../components/tender-ai-copilot-panel";
import { ExportReadinessPanel } from "../../../../components/export-readiness-panel";
import { EvaluatorObjectionsPanel } from "../../../../components/evaluator-objections-panel";
import { PricingWorkbookPanel } from "../../../../components/pricing-workbook-panel";
import { GenerationReadinessPanel } from "../../../../components/generation-readiness-panel";
import { GenerationActionPanel } from "../../../../components/generation-action-panel";
import { AIHealthPanel } from "../../../../components/ai-health-panel";
import { ExtractionQualityPanel } from "../../../../components/extraction-quality-panel";
import { AnalysisQualityPanel } from "../../../../components/analysis-quality-panel";
import { MatchingSelectedEvidencePanel, type SelectedEvidenceCandidate } from "../../../../components/matching-selected-evidence-panel";
import { AuthorityReviewPanel } from "../../../../components/authority-review-panel";
import { DocumentValidatorPanel } from "../../../../components/document-validator-panel";
import { AIAnalyzeRecoveryPanel } from "../../../../components/ai-analyze-recovery-panel";
import { AIAnalyzePanel } from "../../../../components/ai-analyze-panel";
import { AICopilotSuggestionsPanel } from "../../../../components/ai-copilot-suggestions-panel";
import { TenderSharePanel } from "../../../../components/tender-share-panel";
import { AuditTrailPanel } from "../../../../components/audit-trail-panel";
import { TenderChatPanelWrapper } from "../../../../components/tender-chat-panel-wrapper";
import RequirementCoveragePanel from "../../../../components/requirement-coverage-panel";
import { TenderSourceFilesPanel } from "../../../../components/tender-source-files-panel";
import { NextActionPanel } from "../../../../components/next-action-panel";
import { ClientEntityWarningBanner } from "../../../../components/corrupted-metadata-banner";
import { BidStrategyPanel } from "../../../../components/bid-strategy-panel";
import TenderControlsPanel from "../../../../components/tender-controls-panel";
import { prisma as prismaClient } from "../../../../lib/prisma";
import {
  TENDER_PACKAGE_INTAKE_OPERATION,
  parseTenderPackageSessionResult,
} from "../../../../lib/tender-package-intake-session";

function Disclosure({
  title,
  description,
  children,
  defaultOpen = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
      <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-4 marker:content-none">
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-slate-900">{title}</span>
          <span className="mt-0.5 block text-sm text-slate-600">{description}</span>
        </span>
        <span aria-hidden="true" className="mt-1 text-slate-400 transition-transform group-open:rotate-180"><ChevronDownIcon /></span>
      </summary>
      <div className="space-y-4 border-t border-slate-200 bg-white p-4 sm:p-5">{children}</div>
    </details>
  );
}

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
    <details
      id={`workflow-stage-${number}`}
      open={open}
      className="group scroll-mt-24 rounded-2xl border border-slate-200 bg-slate-50 shadow-sm"
    >
      <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-4 marker:content-none">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">{number}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-slate-900">{title}</span>
          <span className="mt-0.5 block text-sm text-slate-600">{description}</span>
        </span>
        <span aria-hidden="true" className="mt-1 text-slate-400 transition-transform group-open:rotate-180"><ChevronDownIcon /></span>
      </summary>
      <div className="space-y-4 border-t border-slate-200 bg-white p-4 sm:p-5">{children}</div>
    </details>
  );
}

export default async function TenderPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;
  const currentUser = await getCurrentUser();
  const canMutate = canMutateTender(currentUser?.role);

  const { id } = await params;
  const tender = await prismaClient.tender.findFirst({
    where: { id, userId },
    include: {
      files: {
        orderBy: { createdAt: "desc" },
        select: { id: true, fileName: true, originalFileName: true, mimeType: true, size: true, classification: true, createdAt: true, storagePath: true, extractionScore: true, totalPages: true, extractedPages: true, ocrPages: true, failedPages: true },
      },
      requirements: { orderBy: { createdAt: "asc" } },
      complianceGaps: { orderBy: { createdAt: "desc" } },
      generatedDocuments: {
        orderBy: { exactOrder: "asc" },
        select: { id: true, name: true, documentType: true, generationStatus: true, validationStatus: true, reviewStatus: true, reviewNotes: true, exactFileName: true, exactOrder: true, storagePath: true, contentSummary: true, reviewedExpertCount: true, draftExpertCount: true, reviewedProjectCount: true, draftProjectCount: true },
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
      metadataOverrides: {
        select: { field: true, fieldState: true, overrideValue: true },
      },
    },
  });

  if (!tender) notFound();

  const fileTextMetrics = await prismaClient.$queryRaw<Array<{ id: string; extractedTextLength: number; isScannedPlaceholder: boolean; fileContentLength: number }>>`
    SELECT
      id,
      COALESCE(char_length("extractedText"), 0)::int AS "extractedTextLength",
      COALESCE("extractedText" LIKE '[Scanned%', false) AS "isScannedPlaceholder",
      ("fileContent" IS NOT NULL)::int AS "fileContentLength"
    FROM "TenderFile"
    WHERE "tenderId" = ${tender.id}
  `.catch(() => [] as Array<{ id: string; extractedTextLength: number; isScannedPlaceholder: boolean; fileContentLength: number }>);
  const fileTextMetricById = new Map(fileTextMetrics.map((file) => [file.id, file]));
  const tenderForUi = {
    ...tender,
    files: tender.files.map((file) => {
      const metric = fileTextMetricById.get(file.id);
      return {
        ...file,
        extractedTextLength: metric?.extractedTextLength ?? 0,
        isScannedPlaceholder: metric?.isScannedPlaceholder ?? false,
        hasInlineFileContent: (metric?.fileContentLength ?? 0) > 0,
        extractionScore: file.extractionScore ?? null,
        totalPages: file.totalPages ?? null,
        extractedPages: file.extractedPages ?? null,
        ocrPages: file.ocrPages ?? null,
        failedPages: file.failedPages ?? null,
      };
    }),
  };

  const generatedContentMetrics = await prismaClient.$queryRaw<Array<{ id: string; fileContentLength: number }>>`
    SELECT id, ("fileContent" IS NOT NULL)::int AS "fileContentLength"
    FROM "GeneratedDocument"
    WHERE "tenderId" = ${tender.id}
  `.catch(() => [] as Array<{ id: string; fileContentLength: number }>);
  const generatedContentMetricById = new Map(generatedContentMetrics.map((doc) => [doc.id, doc]));
  tenderForUi.generatedDocuments = tenderForUi.generatedDocuments.map((doc) => ({
    ...doc,
    hasInlineFileContent: (generatedContentMetricById.get(doc.id)?.fileContentLength ?? 0) > 0,
  }));

  const ai = isAIEnabled();
  // FIX 7: Removed unscoped `succeededAnalysisJob` and `succeededEngineJob`
  // queries — they were legacy readiness sources that could be confused by
  // stale/deleted/superseded/duplicate historical jobs. The single canonical
  // readiness service (getCanonicalTenderReadiness) is now the only source
  // of truth for analysisCurrent/engineCurrent/etc. We still query
  // `activeAnalysisJob` and `activeEngineJob` (QUEUED/RUNNING only) to surface
  // the "in-flight" indicator on the page — that is current-state, not
  // historical truth, and is not used as a workflow authority.
  const [generationReadiness, canonicalReadiness, activeAnalysisJob, activeEngineJob, activeIntakeRun] = await Promise.all([
    getTenderGenerationReadinessStrict(prismaClient, userId, tender.id).catch(() => null),
    getCanonicalTenderReadiness(prismaClient, userId, tender.id).catch(() => null),
    prismaClient.aiJob.findFirst({
      where: {
        userId,
        tenderId: tender.id,
        jobType: "AI_ANALYZE",
        status: { in: ["QUEUED", "RUNNING"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }).catch(() => null),
    prismaClient.aiJob.findFirst({
      where: {
        userId,
        tenderId: tender.id,
        jobType: "ENGINE_RUN",
        status: { in: ["QUEUED", "RUNNING"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }).catch(() => null),
    prismaClient.tenderWorkflowRun.findFirst({
      where: {
        tenderId: tender.id,
        operation: TENDER_PACKAGE_INTAKE_OPERATION,
        status: "QUEUED",
      },
      orderBy: { createdAt: "desc" },
      select: { resultJson: true },
    }).catch(() => null),
  ]);
  const activeIntakeSession = parseTenderPackageSessionResult(activeIntakeRun?.resultJson);

  // ─── Truthful workflow state derived from ONE canonical readiness service ──
  //
  // FIX 7: Removed legacy per-file `extractionScore` booleans and unscoped
  // succeededAnalysisJob/succeededEngineJob queries. The single canonical
  // readiness service (getCanonicalTenderReadiness) drives every workflow
  // decision: AI Analyze panel, Analysis Quality panel, Run Engine panel,
  // Next Action, workflow navigation, generation readiness, export readiness,
  // API authorization, worker authorization. Stale/deleted/superseded/
  // duplicate historical jobs or files can no longer become a second truth
  // source.
  //
  // The canonical service exposes `readyForAnalysis` (extraction + byte
  // integrity complete and not corrupted), `matchingComplete` (Engine has
  // produced a current-revision match set), `readyForFullProposal` (Engine
  // + Build Plan + generation all current), and per-module `state` strings.
  // We derive the panel props from those — never from raw AiJob queries.
  const extractionModuleState = canonicalReadiness?.modules?.extraction?.state ?? "NOT_RUN";
  const analysisModuleState = canonicalReadiness?.modules?.analysis?.state ?? "NOT_RUN";
  const matchingModuleState = canonicalReadiness?.modules?.matching?.state ?? "NOT_RUN";

  // sourceIntegrityValid: true when the canonical extraction module reports
  // byte integrity is valid for all active files (no extraction BLOCKED/STALE).
  const sourceIntegrityValid = Boolean(canonicalReadiness?.readyForAnalysis)
    && extractionModuleState !== "BLOCKED";

  // extractionComplete: true when the canonical extraction module has reached
  // a READY state (text was successfully extracted from at least one file).
  const extractionComplete = extractionModuleState === "READY"
    || extractionModuleState === "WARNING";

  // analysisComplete: true when the canonical analysis module is READY (the
  // current-revision AI_ANALYZE job has SUCCEEDED and been promoted).
  const analysisComplete = analysisModuleState === "READY"
    || analysisModuleState === "WARNING";

  // engineRunning: true when an ENGINE_RUN job is QUEUED or RUNNING but the
  // canonical matching module has not yet reached READY (Engine still in
  // flight). engineComplete: true when the canonical matching module reports
  // READY (Engine has SUCCEEDED for the current source revision).
  const engineComplete = matchingModuleState === "READY"
    || matchingModuleState === "WARNING";
  const engineRunning = Boolean(activeEngineJob) && !engineComplete;

  return (
    <section className="space-y-5" aria-label="Tender workflow workspace">
      <ClientEntityWarningBanner tender={{
        id: tender.id,
        reference: tender.reference,
        clientName: tender.clientName,
        procuringEntityName: tender.procuringEntityName,
        country: tender.country,
        clientContactName: tender.clientContactName,
      }} canMutate={canMutate} />

      <RequirementTruthBanner tenderId={tender.id} />
      <NextActionPanel tenderId={tender.id} />

      <WorkflowStage number={1} title="Intake and extraction" open description="Manage source documents, automatic extraction quality, and submission-critical Tender Details.">
        <TenderSourceFilesPanel
          tenderId={tender.id}
          initialFiles={tender.files}
          canMutate={canMutate}
          activeIntakeSession={activeIntakeSession}
        />
        <Disclosure
          title="Extraction quality"
          description="One canonical report for page coverage, OCR availability, weak or failed pages, and extraction readiness."
        >
          <div id="extraction-quality" className="scroll-mt-24">
            <ExtractionQualityPanel tenderId={tender.id} />
          </div>
        </Disclosure>
        <TenderIntakeDetailPanel tender={tenderForUi} />
        <Disclosure
          title="Tender controls"
          description="Track addenda, clarifications, questions, milestones, tasks, risks, and commercial assumptions raised over the life of this tender."
        >
          <TenderControlsPanel tenderId={tender.id} />
        </Disclosure>
      </WorkflowStage>

      <WorkflowStage number={2} title="Analysis and engine" description="Extraction completes automatically. Select AI Analyze, review the grounded result, then select Run Engine; every valid later stage continues automatically.">
        <AIAnalyzePanel
          tenderId={tender.id}
          initialContinueJobId={activeAnalysisJob?.id ?? null}
          aiEnabled={ai}
          canMutate={canMutate}
          analysisAlreadySucceeded={analysisComplete}
          extractionComplete={extractionComplete}
          sourceIntegrityValid={sourceIntegrityValid}
          hasActiveJob={Boolean(activeAnalysisJob)}
        />
        <AnalysisQualityPanel tenderId={tender.id} />
        <RequirementCoveragePanel tenderId={tender.id} canMutate={canMutate} />
        <BidStrategyPanel tenderId={tender.id} />
        <Disclosure
          title="AI diagnostics and assistance"
          description="Provider health, recovery information, suggestions, chat, and Copilot are secondary aids—not separate workflow authorities."
        >
          <AIHealthPanel />
          <AIAnalyzeRecoveryPanel tenderId={tender.id} />
          <AICopilotSuggestionsPanel tenderId={tender.id} />
          {ai && <TenderChatPanelWrapper tenderId={tender.id} canMutate={canMutate} />}
          {ai && <TenderAICopilotPanel tenderId={tender.id} canMutate={canMutate} />}
        </Disclosure>
      </WorkflowStage>

      <WorkflowStage number={3} title="Evidence and matching" description="After Run Engine, inspect the persisted company-owned evidence selected automatically for this tender.">
        <MatchingSelectedEvidencePanel
          tenderId={tender.id}
          canMutate={canMutate}
          analysisComplete={analysisComplete}
          engineRunning={engineRunning}
          engineComplete={engineComplete}
          experts={tender.expertMatches.map((m): SelectedEvidenceCandidate => ({
            id: m.id,
            name: m.expert.fullName,
            subtitle: m.expert.title,
            score: m.score,
            rationale: m.rationale,
            isSelected: m.isSelected,
            trustLevel: m.expert.trustLevel,
          }))}
          projects={tender.projectMatches.map((m): SelectedEvidenceCandidate => ({
            id: m.id,
            name: m.project.name,
            subtitle: m.project.clientName,
            score: m.score,
            rationale: m.rationale,
            isSelected: m.isSelected,
            trustLevel: m.project.trustLevel,
          }))}
        />
      </WorkflowStage>

      <WorkflowStage number={4} title="Generation and review" description="Run Engine owns Build Plan verification, matching, generation, validation, and finalization automatically. Review status and resolve only genuine source, quality, or legal blockers.">
        <GenerationActionPanel tenderId={tender.id} readiness={generationReadiness} canonicalReadiness={canonicalReadiness} canMutate={canMutate} />
        <SubmissionPlanTruthPanel tenderId={tender.id} />
        <AuthorityReviewPanel tenderId={tender.id} />
        <DocumentValidatorPanel tenderId={tender.id} />
        <Disclosure
          title="Generation and review diagnostics"
          description="Detailed readiness, reconciliation, and evaluator simulation remain available without adding another normal workflow action."
        >
          <GenerationReadinessPanel tenderId={tender.id} readiness={generationReadiness} />
          <SubmissionPlanCompletenessPanel tenderId={tender.id} canMutate={canMutate} />
          <EvaluatorObjectionsPanel tenderId={tender.id} canMutate={canMutate} />
        </Disclosure>
      </WorkflowStage>

      <WorkflowStage number={5} title="Final package and submission" description="Reconcile pricing, inspect the exact manifest, verify export readiness, and download the released package.">
        <PricingWorkbookPanel tenderId={tender.id} canMutate={canMutate} />
        <FinalPackageManifestPanel tenderId={tender.id} />
        <ExportReadinessPanel tenderId={tender.id} canMutate={canMutate} />
        <TenderSharePanel tenderId={tender.id} canMutate={canMutate} />
        <Disclosure
          title="Submission audit trail"
          description="Open the historical activity record only when an audit or handoff review requires it."
        >
          <AuditTrailPanel tenderId={tender.id} />
        </Disclosure>
      </WorkflowStage>

      <Disclosure
        title="Diagnostics and audit"
        description="Open the separate read-only Command Center only when you need full blocker, export, pricing, version, objection, or background-job detail."
      >
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-700">
            The Command Center reads the same canonical release state as the status card above. It does not add a second next action, mutation owner, readiness score, or final-ZIP decision to this workspace.
          </p>
          <Link
            href={`/dashboard/tenders/${tender.id}/command-center`}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white no-underline hover:bg-slate-800"
          >
            Open read-only Command Center <ArrowRightIcon />
          </Link>
        </div>
      </Disclosure>
    </section>
  );
}
