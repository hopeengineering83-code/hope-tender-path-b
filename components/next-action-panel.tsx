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

import { getSession } from '../lib/auth';
import { prisma, prismaReady } from '../lib/prisma';
import { assessTenderMetadataCompleteness } from '../lib/engine/tender-metadata-completeness';
import { getCanonicalTenderWorkflowDecision } from '../lib/engine/canonical-workflow-decision';
import { CheckCircleIcon, WarningIcon, ArrowRightIcon } from './icons';

const STEPS = [
  'Upload Tender',
  'Fix Extraction',
  'Run AI Analyze',
  'Confirm Requirements',
  'Build Plan',
  'Match Evidence',
  'Generate Docs',
  'Validate & Approve Docs',
  'Review Manifest',
  'Export ZIP',
] as const;

type WorkflowStep =
  | 'UPLOAD_TENDER'
  | 'FIX_EXTRACTION'
  | 'RUN_AI_ANALYZE'
  | 'CONFIRM_REQUIREMENTS'
  | 'BUILD_PLAN'
  | 'MATCH_EVIDENCE'
  | 'GENERATE_DOCUMENTS'
  | 'VALIDATE_DOCUMENTS'
  | 'REVIEW_MANIFEST'
  | 'EXPORT_ZIP'
  | 'COMPLETE';

const STEP_INDEX: Record<WorkflowStep, number> = {
  UPLOAD_TENDER: 0,
  FIX_EXTRACTION: 1,
  RUN_AI_ANALYZE: 2,
  CONFIRM_REQUIREMENTS: 3,
  BUILD_PLAN: 4,
  MATCH_EVIDENCE: 5,
  GENERATE_DOCUMENTS: 6,
  VALIDATE_DOCUMENTS: 7,
  REVIEW_MANIFEST: 8,
  EXPORT_ZIP: 9,
  COMPLETE: 10,
};

const STEP_TARGETS = [
  '#tender-files',
  '#tender-files',
  '#ai-analyze-section',
  '#requirement-coverage',
  '#submission-plan',
  '#requirement-coverage',
  '#generated-documents',
  '#generated-documents',
  '#final-package-manifest',
  '#export-readiness',
] as const;

// Map the canonical decision's nextRequiredAction to the panel's step index.
// This MUST agree with workflow-center's stageStates — both read the same
// decision object, so they cannot disagree.
function stepFromCanonicalAction(action: string): WorkflowStep {
  switch (action) {
    case 'UPLOAD_TENDER':
      return 'UPLOAD_TENDER';
    case 'FIX_EXTRACTION':
      return 'FIX_EXTRACTION';
    case 'RESUME_AI_ANALYZE':
    case 'RUN_AI_ANALYZE':
      return 'RUN_AI_ANALYZE';
    case 'REVIEW_REQUIREMENTS':
      return 'CONFIRM_REQUIREMENTS';
    case 'BUILD_SUBMISSION_PLAN':
      return 'BUILD_PLAN';
    case 'LINK_VAULT_EVIDENCE':
      return 'MATCH_EVIDENCE';
    case 'GENERATE_DOCUMENTS':
      return 'GENERATE_DOCUMENTS';
    case 'FIX_EXPORT_BLOCKERS':
      return 'VALIDATE_DOCUMENTS';
    case 'EXPORT_READY':
      return 'EXPORT_ZIP';
    default:
      return 'UPLOAD_TENDER';
  }
}

function stepColor(step: WorkflowStep) {
  if (step === 'COMPLETE' || step === 'EXPORT_ZIP') return 'border-emerald-200 bg-emerald-50';
  if (
    step === 'RUN_AI_ANALYZE' ||
    step === 'BUILD_PLAN' ||
    step === 'GENERATE_DOCUMENTS' ||
    step === 'REVIEW_MANIFEST' ||
    step === 'MATCH_EVIDENCE'
  )
    return 'border-amber-200 bg-amber-50';
  if (step === 'FIX_EXTRACTION' || step === 'CONFIRM_REQUIREMENTS' || step === 'VALIDATE_DOCUMENTS')
    return 'border-red-200 bg-red-50';
  return 'border-amber-200 bg-amber-50';
}

function stepIcon(step: WorkflowStep) {
  // SVG icons replace raw Unicode (✓ ⚠ →) for consistent rendering across
  // all browsers and font stacks. Per spec rule 3 & 7.
  if (step === 'COMPLETE' || step === 'EXPORT_ZIP') return <CheckCircleIcon />;
  if (step === 'FIX_EXTRACTION' || step === 'CONFIRM_REQUIREMENTS' || step === 'VALIDATE_DOCUMENTS')
    return <WarningIcon />;
  return <ArrowRightIcon />;
}

export async function NextActionPanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;

  await prismaReady;

  // Tender is fetched only for metadata advisory (deadline). The canonical
  // decision is the SINGLE source of workflow truth — no local decision logic.
  const tender = await prisma.tender
    .findFirst({
      where: { id: tenderId, userId },
      select: {
        id: true,
        title: true,
        status: true,
        clientName: true,
        procuringEntityName: true,
        country: true,
        clientContactName: true,
        clientContactEmail: true,
        submissionAddress: true,
        submissionEmails: true,
        submissionMethod: true,
        deadline: true,
        currency: true,
        metadataOverrides: { select: { field: true, fieldState: true, overrideValue: true } },
      },
    })
    .catch(() => null);

  if (!tender) return null;

  const decision = await getCanonicalTenderWorkflowDecision(prisma, userId, tenderId);
  if (!decision) return null;

  const step = stepFromCanonicalAction(decision.nextRequiredAction);
  const label = decision.nextRequiredActionLabel;
  const reason = decision.nextRequiredActionReason;
  const blockers = decision.blockerDetails;
  const currentIndex = STEP_INDEX[step];

  // Metadata advisory — never a blocker per the unified runtime model, but
  // still surfaced so the user knows a deadline is approaching/passed.
  const metaReport = assessTenderMetadataCompleteness(
    {
      clientName: (tender.clientName || tender.procuringEntityName) ?? null,
      country: tender.country ?? null,
      clientContactName: tender.clientContactName ?? null,
      clientContactEmail: tender.clientContactEmail ?? null,
      submissionAddress: tender.submissionAddress ?? null,
      submissionEmails: tender.submissionEmails ?? null,
      submissionMethod: tender.submissionMethod ?? null,
      deadline: tender.deadline ?? null,
      currency: tender.currency ?? null,
      hasSubmissionRules: Boolean(
        tender.submissionMethod || tender.submissionEmails || tender.submissionAddress
      ),
      requirementCount: 0,
    },
    tender.metadataOverrides
  );

  return (
    <section
      className={`mb-4 rounded-2xl border p-5 shadow-sm ${stepColor(step)}`}
      aria-labelledby="next-required-action-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Next required action
          </p>
          <h2 id="next-required-action-title" className="mt-1 text-xl font-bold text-slate-900">
            <span className="mr-2 text-slate-400" aria-hidden="true">
              {stepIcon(step)}
            </span>
            {label}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-700">{reason}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">
            Step {Math.min(currentIndex + 1, STEPS.length)} of {STEPS.length}
          </p>
          <p className="text-lg font-bold text-slate-900">
            {step === 'COMPLETE' ? 'Done' : `${currentIndex + 1}/${STEPS.length}`}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a
          href={STEP_TARGETS[currentIndex] ?? '#tender-files'}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          <ArrowRightIcon /> {label}
        </a>
        <details className="group">
          <summary className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            View all workflow steps
          </summary>
          <nav className="mt-2 flex flex-wrap gap-1.5" aria-label="Tender workflow steps">
            {STEPS.map((s, i) => {
              const done = i < currentIndex;
              const active = i === currentIndex;
              const baseClass = done
                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                : active
                  ? 'bg-slate-900 text-white hover:bg-slate-800'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200';
              return (
                <a
                  key={s}
                  href={STEP_TARGETS[i]}
                  aria-current={active ? 'step' : undefined}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${baseClass}`}
                  title={`Go to ${s}`}
                >
                  <span aria-hidden="true" className="inline-flex items-center">
                    {done ? (
                      <CheckCircleIcon className="mr-0.5" />
                    ) : active ? (
                      <ArrowRightIcon className="mr-0.5" />
                    ) : null}
                  </span>
                  {s}
                </a>
              );
            })}
          </nav>
        </details>
      </div>

      {blockers.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm">
          <p className="text-xs font-semibold uppercase text-red-700">Blockers to resolve</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-red-700">
            {blockers.slice(0, 5).map((b) => (
              <li key={b}>{b}</li>
            ))}
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
            Trusted traced requirements (mandatory): {decision.mandatoryTracedCount}/
            {decision.mandatoryRequirementCount} · Compliance rows:{' '}
            {decision.mandatoryComplianceRowsCount} · FULL/SUBSTANTIAL coverage:{' '}
            {decision.mandatoryFullOrSubstantialCoverageCount}/{decision.mandatoryRequirementCount}
          </p>
        </div>
      )}

      {decision.currentBlockingStage === 'EXTRACTION_UNSAFE' && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-white px-4 py-2.5 text-sm text-amber-800">
          <strong>Fix Extraction First.</strong> Run OCR, re-extract, or upload a clearer PDF before
          running AI Analyze. AI analysis on weak extraction can produce incomplete requirements and
          unsafe downstream guidance.
        </div>
      )}

      {decision.currentBlockingStage === 'REQUIRED_DOCS_NOT_GENERATED' && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-white px-4 py-2.5 text-sm text-emerald-800">
          <strong>All pre-generation gates pass.</strong> You can now generate the proposal. Draft
          generation proceeds with available data. Optional tender details are omitted from output.
          Final submission requires strict validation.
        </div>
      )}

      {decision.currentBlockingStage === 'EXPORT_ZIP_READY' && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-white px-4 py-2.5 text-sm text-emerald-800">
          <strong>Export ready.</strong> Review the Final Package Manifest below, then click Export
          to create the submission ZIP.
        </div>
      )}

      {metaReport.deadlinePassed && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          <strong>Submission deadline has passed.</strong>{' '}
          {metaReport.notes.find((n) => n.includes('deadline has passed')) ??
            'Confirm with the client whether an extension has been granted before proceeding.'}
        </div>
      )}
    </section>
  );
}
