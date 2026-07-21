// Next Required Action panel — server component.
//
// CONSUMES THE CANONICAL WORKFLOW DECISION. This panel must NOT compute its
// own "next action" truth — every other panel (workflow-center, generation
// action, export readiness, submission plan, requirement coverage, authority
// review) reads the same `getCanonicalTenderWorkflowDecision` result so the
// user sees ONE primary blocker, ONE next action, and a coherent set of
// per-stage states.
//
// If you need to add a new stage or change the blocker priority, edit
// `lib/engine/canonical-workflow-decision.ts` — do not branch the truth here.

import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { assessTenderMetadataCompleteness } from "../lib/engine/tender-metadata-completeness";
import { getCanonicalTenderWorkflowDecision } from "../lib/engine/canonical-workflow-decision";
import { getTenderReleaseState } from "../lib/engine/tender-release-state";
import { scoreTone, verdictLabel } from "../lib/ui/tender-release-state-presentation";
import { CheckCircleIcon, WarningIcon, ArrowRightIcon } from "./icons";
import { StatusBadge } from "./status-badge";
import { WorkflowStepLinks } from "./workflow-step-links";

// Labels MUST match the server-side stage labels in
// app/api/tenders/[id]/workflow-center/route.ts and the STEP_LABELS in
// components/workflow-step-links.tsx. All three must agree so the step
// counter, step links, and workflow control center show the same stage names.
const STEPS = [
  "Source Files",
  "Extraction Quality",
  "AI Analyze",
  "Confirm Requirements",
  "Tender Details",
  "Verified Submission Plan",
  "Match Evidence",
  "Generate Documents",
  "Validate and Approve",
  "Export ZIP",
] as const;

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

// STEP_TARGETS was moved to components/workflow-step-links.tsx so both the
// step counter and the step links share the same source of truth. The labels
// above (STEPS) must still match STEP_LABELS in workflow-step-links.tsx.

// Map the canonical decision's nextRequiredAction to the panel's step index.
// This MUST agree with workflow-center's stageStates — both read the same
// decision object, so they cannot disagree.
function stepFromCanonicalAction(action: string): WorkflowStep {
  switch (action) {
    case "UPLOAD_TENDER": return "UPLOAD_TENDER";
    case "FIX_EXTRACTION": return "FIX_EXTRACTION";
    case "RESUME_AI_ANALYZE":
    case "RUN_AI_ANALYZE": return "RUN_AI_ANALYZE";
    case "REVIEW_REQUIREMENTS": return "CONFIRM_REQUIREMENTS";
    case "EDIT_TENDER_METADATA": return "EDIT_TENDER_METADATA";
    case "BUILD_SUBMISSION_PLAN": return "BUILD_SUBMISSION_PLAN";
    case "LINK_VAULT_EVIDENCE": return "MATCH_EVIDENCE";
    case "GENERATE_DOCUMENTS": return "GENERATE_DOCUMENTS";
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
  // SVG icons replace raw Unicode (✓ ⚠ →) for consistent rendering across
  // all browsers and font stacks. Per spec rule 3 & 7.
  if (step === "COMPLETE" || step === "EXPORT_ZIP") return <CheckCircleIcon />;
  if (step === "FIX_EXTRACTION" || step === "CONFIRM_REQUIREMENTS" || step === "VALIDATE_DOCS") return <WarningIcon />;
  return <ArrowRightIcon />;
}

export async function NextActionPanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;

  await prismaReady;

  // Tender is fetched only for metadata advisory (deadline). The canonical
  // decision is the SINGLE source of workflow truth — no local decision logic.
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      id: true, title: true, status: true,
      clientName: true, procuringEntityName: true, country: true,
      clientContactName: true, clientContactEmail: true,
      submissionAddress: true, submissionEmails: true,
      submissionMethod: true, deadline: true, currency: true,
      metadataOverrides: { select: { field: true, fieldState: true, overrideValue: true } },
    },
  }).catch(() => null);

  if (!tender) return null;

  // Fetched alongside the canonical decision (getTenderReleaseState calls the
  // same getCanonicalTenderWorkflowDecision internally, so this adds one
  // extra query, not a second competing truth) so this single card can show
  // tender status + readiness score + verdict together with the next
  // required action — the four other panels that used to render these
  // separately (Recovery Command Center, Tender Release State, Final
  // Submission Control Center) are collapsed into "Advanced diagnostics"
  // below instead of competing with this card.
  const [decision, releaseState] = await Promise.all([
    getCanonicalTenderWorkflowDecision(prisma, userId, tenderId),
    getTenderReleaseState(prisma, tenderId, userId),
  ]);
  if (!decision) return null;

  const step = stepFromCanonicalAction(decision.nextRequiredAction);
  const label = decision.nextRequiredActionLabel;
  const reason = decision.nextRequiredActionReason;
  const blockers = decision.blockerDetails;
  const currentIndex = STEP_INDEX[step];

  // Metadata advisory — never a blocker per the unified runtime model, but
  // still surfaced so the user knows a deadline is approaching/passed.
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
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${stepColor(step)}`} aria-labelledby="next-required-action-title">
      {/* Authoritative status row — tender status, readiness score, and bid
          verdict together, so this is the one place a user checks for "where
          does this tender stand" instead of three separate panels below. */}
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
            {label}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-700">{reason}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Step {Math.min(currentIndex + 1, STEPS.length)} of {STEPS.length}</p>
          <p className="text-lg font-bold text-slate-900">{step === "COMPLETE" ? "Done" : `${currentIndex + 1}/${STEPS.length}`}</p>
        </div>
      </div>

      {/* WorkflowStepLinks renders the current step as the one primary
          action (highlighted/enabled) with the remaining steps shown as
          secondary, non-competing context — see components/workflow-step-links.tsx. */}
      <WorkflowStepLinks currentIndex={currentIndex} />

      {blockers.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm">
          <p className="text-xs font-semibold uppercase text-red-700">Blockers to resolve</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-red-700">
            {blockers.slice(0, 5).map((b) => <li key={b}>{b}</li>)}
          </ul>
        </div>
      )}

      {/* Requirement trust split — surfaces raw-vs-trusted distinction without
          recomputing local truth. The counts come from the canonical decision,
          which itself reads the snapshot's gate-aligned grounding check. */}
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
          <strong>Fix Extraction First.</strong> Run OCR, re-extract, or upload a clearer PDF before running AI Analyze. AI analysis on weak extraction can produce incomplete requirements and unsafe downstream guidance.
        </div>
      )}

      {decision.currentBlockingStage === "REQUIRED_DOCS_NOT_GENERATED" && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-white px-4 py-2.5 text-sm text-emerald-800">
          <strong>All pre-generation gates pass.</strong> You can now generate the proposal. Draft generation proceeds with available data. Optional tender details are omitted from output. Final submission requires strict validation.
        </div>
      )}

      {decision.currentBlockingStage === "EXPORT_ZIP_READY" && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-white px-4 py-2.5 text-sm text-emerald-800">
          <strong>Export ready.</strong> Review the Final Package Manifest below, then click Export to create the submission ZIP.
        </div>
      )}

      {metaReport.deadlinePassed && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          <strong>Submission deadline has passed.</strong> {metaReport.notes.find((n) => n.includes("deadline has passed")) ?? "Confirm with the client whether an extension has been granted before proceeding."}
        </div>
      )}
    </section>
  );
}
