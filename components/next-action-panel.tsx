// Next Required Action panel — server component.
//
// The canonical workflow decision remains authoritative. A narrow source
// reconciliation layer removes only duplicate-representation extraction
// blockers after a separate canonical source has verified bytes, complete page
// coverage, and acceptable extraction quality.

import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { assessTenderMetadataCompleteness } from "../lib/engine/tender-metadata-completeness";
import { getCanonicalTenderWorkflowDecision } from "../lib/engine/canonical-workflow-decision";
import { presentTwoActionWorkflowDecision } from "../lib/engine/two-action-workflow-presentation";
import { getTenderReleaseState } from "../lib/engine/tender-release-state";
import { getTenderReleaseSnapshot } from "../lib/engine/tender-release-snapshot";
import { assessCanonicalTenderSourceReadiness } from "../lib/tender/canonical-source-files";
import { scoreTone, verdictLabel } from "../lib/ui/tender-release-state-presentation";
import { CheckCircleIcon, WarningIcon, ArrowRightIcon } from "./icons";
import { StatusBadge } from "./status-badge";
import { WorkflowStepLinks } from "./workflow-step-links";
import { TENDER_WORKFLOW_STAGE_LABEL_LIST as STEPS } from "../lib/tender-workflow-stages";

type WorkflowStep =
  | "UPLOAD_TENDER"
  | "FIX_EXTRACTION"
  | "RUN_AI_ANALYZE"
  | "CONFIRM_REQUIREMENTS"
  | "EDIT_TENDER_METADATA"
  | "BUILD_SUBMISSION_PLAN"
  | "MATCH_EVIDENCE"
  | "GENERATE_DOCUMENTS"
  | "VALIDATE_DOCS"
  | "EXPORT_ZIP"
  | "COMPLETE";

const STEP_INDEX: Record<WorkflowStep, number> = {
  UPLOAD_TENDER: 0,
  FIX_EXTRACTION: 1,
  RUN_AI_ANALYZE: 2,
  CONFIRM_REQUIREMENTS: 3,
  EDIT_TENDER_METADATA: 4,
  BUILD_SUBMISSION_PLAN: 5,
  MATCH_EVIDENCE: 6,
  GENERATE_DOCUMENTS: 7,
  VALIDATE_DOCS: 8,
  EXPORT_ZIP: 9,
  COMPLETE: 10,
};

function stepFromCanonicalAction(action: string): WorkflowStep {
  switch (action) {
    case "UPLOAD_TENDER": return "UPLOAD_TENDER";
    case "FIX_EXTRACTION": return "FIX_EXTRACTION";
    case "RESUME_AI_ANALYZE":
    case "RUN_AI_ANALYZE": return "RUN_AI_ANALYZE";
    case "REVIEW_REQUIREMENTS": return "RUN_AI_ANALYZE";
    case "EDIT_TENDER_METADATA": return "EDIT_TENDER_METADATA";
    case "RUN_ENGINE":
    case "BUILD_SUBMISSION_PLAN": return "BUILD_SUBMISSION_PLAN";
    case "LINK_VAULT_EVIDENCE": return "MATCH_EVIDENCE";
    case "GENERATE_DOCUMENTS": return "GENERATE_DOCUMENTS";
    case "AUTOMATIC_PROCESSING":
    case "FIX_EXPORT_BLOCKERS":
    case "VALIDATE_DOCS": return "VALIDATE_DOCS";
    case "EXPORT_READY": return "EXPORT_ZIP";
    default: return "UPLOAD_TENDER";
  }
}

function stepColor(step: WorkflowStep) {
  if (step === "COMPLETE" || step === "EXPORT_ZIP") return "border-emerald-200 bg-emerald-50";
  if (step === "RUN_AI_ANALYZE" || step === "BUILD_SUBMISSION_PLAN" || step === "GENERATE_DOCUMENTS" || step === "MATCH_EVIDENCE") return "border-amber-200 bg-amber-50";
  if (step === "FIX_EXTRACTION" || step === "CONFIRM_REQUIREMENTS" || step === "VALIDATE_DOCS") return "border-red-200 bg-red-50";
  return "border-amber-200 bg-amber-50";
}

function stepIcon(step: WorkflowStep) {
  if (step === "COMPLETE" || step === "EXPORT_ZIP") return <CheckCircleIcon />;
  if (step === "FIX_EXTRACTION" || step === "CONFIRM_REQUIREMENTS" || step === "VALIDATE_DOCS") return <WarningIcon />;
  return <ArrowRightIcon />;
}

export async function NextActionPanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;

  await prismaReady;

  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      id: true, title: true, status: true,
      clientName: true, procuringEntityName: true, country: true,
      clientContactName: true, clientContactEmail: true,
      submissionAddress: true, submissionEmails: true,
      submissionMethod: true, deadline: true, currency: true,
      metadataOverrides: { select: { field: true, fieldState: true, overrideValue: true } },
      files: {
        select: {
          id: true,
          fileName: true,
          originalFileName: true,
          deletionStatus: true,
          contentSha256: true,
          integrityStatus: true,
          extractionScore: true,
          extractionMethod: true,
          totalPages: true,
          extractedPages: true,
          failedPages: true,
          extractedText: true,
          createdAt: true,
        },
      },
    },
  }).catch(() => null);

  if (!tender) return null;

  const [rawDecision, releaseState, snapshot] = await Promise.all([
    getCanonicalTenderWorkflowDecision(prisma, userId, tenderId),
    getTenderReleaseState(prisma, tenderId, userId),
    getTenderReleaseSnapshot(prisma, tenderId, userId).catch(() => null),
  ]);

  const sourceReadiness = assessCanonicalTenderSourceReadiness(tender.files);
  const analysisCurrent = Boolean(
    snapshot?.analysis.state === "AI_SUCCEEDED"
    && snapshot.analysis.contentHashMatch
    && snapshot.analysis.canonicalJobId,
  );

  // The legacy release snapshot may still list a weak/pending duplicate as an
  // extraction blocker. Override only that top-level blocker when a different
  // canonical representation is fully ready; genuine canonical extraction
  // failures continue to block fail-closed.
  const reconciledRawDecision = rawDecision
    && rawDecision.currentBlockingStage === "EXTRACTION_UNSAFE"
    && sourceReadiness.analysisReady
    ? {
        ...rawDecision,
        currentBlockingStage: analysisCurrent ? "NO_CONFIRMED_BUILD_PLAN" as const : "AI_ANALYZE_NOT_RUN" as const,
        nextRequiredAction: analysisCurrent ? "RUN_ENGINE" : "RUN_AI_ANALYZE",
        nextRequiredActionLabel: analysisCurrent ? "Run Engine" : "Run AI Analyze",
        nextRequiredActionReason: analysisCurrent
          ? "Current-revision AI Analyze is complete. Select Run Engine; valid later stages continue automatically."
          : "Canonical extraction is complete. Select AI Analyze to create the current grounded analysis.",
        blockingStageCode: analysisCurrent ? "RUN_ENGINE_REQUIRED" : "AI_ANALYZE_NOT_RUN",
        blockerCodes: rawDecision.blockerCodes.filter((code) => code !== "EXTRACTION_UNSAFE"),
        blockerDetails: rawDecision.blockerDetails.filter((detail) => !/extraction|ocr/i.test(detail)),
        downstreamSuppressedBy: analysisCurrent ? "RUN_ENGINE_REQUIRED" : "AI_ANALYZE_NOT_RUN",
      }
    : rawDecision;

  const decision = presentTwoActionWorkflowDecision(reconciledRawDecision);
  if (!decision) return null;

  const step = stepFromCanonicalAction(decision.nextRequiredAction);
  const blockers = decision.blockerDetails;
  const currentIndex = STEP_INDEX[step];

  const metaReport = assessTenderMetadataCompleteness({
    clientName: (tender.clientName || tender.procuringEntityName) ?? null,
    country: tender.country ?? null,
    clientContactName: tender.clientContactName ?? null,
    clientContactEmail: tender.clientContactEmail ?? null,
    submissionAddress: tender.submissionAddress ?? null,
    submissionEmails: tender.submissionEmails ?? null,
    submissionMethod: tender.submissionMethod ?? null,
    deadline: tender.deadline ?? null,
    currency: tender.currency ?? null,
    hasSubmissionRules: Boolean(tender.submissionMethod || tender.submissionEmails || tender.submissionAddress),
    requirementCount: 0,
  }, tender.metadataOverrides);

  const tone = releaseState?.readinessCalculable && releaseState.readinessScore != null
    ? scoreTone(releaseState.readinessScore)
    : { text: "text-slate-500", bg: "bg-slate-50 border-slate-200", bar: "bg-slate-300" };
  const verdict = verdictLabel(releaseState?.verdict ?? null);

  return (
    <section id="workflow-state" className={`mb-4 rounded-2xl border p-5 shadow-sm ${stepColor(step)}`} aria-labelledby="next-required-action-title">
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-black/5 pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tender status</p>
          <div className="mt-1"><StatusBadge status={tender.status} /></div>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Readiness score</p>
          <p className="mt-1">
            {releaseState?.readinessCalculable && releaseState.readinessScore != null ? (
              <span className={`text-2xl font-bold ${tone.text}`}>{releaseState.readinessScore}<span className="text-sm font-normal text-slate-500"> / 100</span></span>
            ) : (
              <span className="text-sm font-semibold text-slate-500">Not calculated</span>
            )}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bid verdict</p>
          <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${verdict.tone}`}>{verdict.label}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Next required action</p>
          <h2 id="next-required-action-title" className="mt-1 text-xl font-bold text-slate-900">
            <span className="mr-2 text-slate-400" aria-hidden="true">{stepIcon(step)}</span>
            {decision.nextRequiredActionLabel}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-700">{decision.nextRequiredActionReason}</p>
          <p className="mt-2 max-w-2xl text-xs text-slate-600">
            Source verification and extraction are automatic. AI Analyze and Run Engine are the two normal user actions. After Run Engine, matching, Build Plan, generation, validation, finalization and package reconciliation continue on the server.
          </p>
          {sourceReadiness.duplicateFileCount > 0 ? (
            <p className="mt-2 max-w-2xl text-xs text-slate-500">
              {sourceReadiness.duplicateFileCount} duplicate or alternate source representation(s) were excluded from the current workflow decision.
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Step {Math.min(currentIndex + 1, STEPS.length)} of {STEPS.length}</p>
          <p className="text-lg font-bold text-slate-900">{step === "COMPLETE" ? "Done" : `${currentIndex + 1}/${STEPS.length}`}</p>
        </div>
      </div>

      <WorkflowStepLinks currentIndex={currentIndex} currentAction={decision.nextRequiredAction} />

      {blockers.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm">
          <p className="text-xs font-semibold uppercase text-red-700">Blockers to resolve</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-red-700">
            {blockers.slice(0, 5).map((blocker) => <li key={blocker}>{blocker}</li>)}
          </ul>
        </div>
      )}

      {decision.mandatoryRequirementCount > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-white px-4 py-2.5 text-sm text-amber-800">
          <p className="text-xs font-semibold uppercase">Requirement trust split</p>
          <p className="mt-1 text-xs">
            Trusted traced requirements (mandatory): {decision.mandatoryTracedCount}/{decision.mandatoryRequirementCount} · Compliance rows: {decision.mandatoryComplianceRowsCount} · FULL/SUBSTANTIAL coverage: {decision.mandatoryFullOrSubstantialCoverageCount}/{decision.mandatoryRequirementCount}
          </p>
        </div>
      )}

      {decision.currentBlockingStage === "EXTRACTION_UNSAFE" && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-white px-4 py-2.5 text-sm text-amber-800">
          <strong>Fix Extraction First.</strong> Upload a clearer, text-based copy of the canonical source. Extraction reruns automatically; then select AI Analyze.
        </div>
      )}

      {decision.currentBlockingStage === "REQUIRED_DOCS_NOT_GENERATED" && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-white px-4 py-2.5 text-sm text-emerald-800">
          <strong>Run Engine.</strong> Matching, Build Plan creation, proposal generation, validation and finalization continue automatically after the Engine job succeeds.
        </div>
      )}

      {decision.currentBlockingStage === "EXPORT_ZIP_READY" && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-white px-4 py-2.5 text-sm text-emerald-800">
          <strong>Ready to download.</strong> Review the Final Package Manifest, then download the exact reconciled ZIP package.
        </div>
      )}

      {metaReport.deadlinePassed && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          <strong>Submission deadline has passed.</strong> {metaReport.notes.find((note) => note.includes("deadline has passed")) ?? "Confirm with the client whether an extension has been granted before proceeding."}
        </div>
      )}
    </section>
  );
}
