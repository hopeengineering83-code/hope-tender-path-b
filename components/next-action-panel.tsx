// Next Required Action panel — server component.
//
// Shows the current workflow step + the single most important action the
// user must take next. Uses the shared tender-next-action resolver so visible
// UI guidance cannot contradict extraction/analysis readiness.

import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { assessExtractionQuality } from "../lib/extraction-quality";
import { isExtractionCorrupted } from "../lib/engine/extraction-quality-gate";
import { assessTenderMetadataCompleteness } from "../lib/engine/tender-metadata-completeness";
import { safeParseJsonArray } from "../lib/safe-json";
import { resolveTenderNextAction, type TenderNextActionPrimary } from "../lib/tender-next-action";

const STEPS = [
  "Upload Tender",
  "Fix Extraction",
  "Run AI Analyze",
  "Confirm Metadata",
  "Confirm Requirements",
  "Build Plan",
  "Generate Docs",
  "Validate & Approve Docs",
  "Review Manifest",
  "Export ZIP",
] as const;

type WorkflowStep =
  | "UPLOAD_TENDER"
  | "FIX_EXTRACTION"
  | "RUN_AI_ANALYZE"
  | "CONFIRM_METADATA"
  | "CONFIRM_REQUIREMENTS"
  | "BUILD_PLAN"
  | "GENERATE_DOCUMENTS"
  | "VALIDATE_DOCUMENTS"
  | "REVIEW_MANIFEST"
  | "EXPORT_ZIP"
  | "COMPLETE";

const STEP_INDEX: Record<WorkflowStep, number> = {
  UPLOAD_TENDER: 0,
  FIX_EXTRACTION: 1,
  RUN_AI_ANALYZE: 2,
  CONFIRM_METADATA: 3,
  CONFIRM_REQUIREMENTS: 4,
  BUILD_PLAN: 5,
  GENERATE_DOCUMENTS: 6,
  VALIDATE_DOCUMENTS: 7,
  REVIEW_MANIFEST: 8,
  EXPORT_ZIP: 9,
  COMPLETE: 10,
};

const STEP_TARGETS = [
  "#tender-files",
  "#tender-files",
  "#ai-analyze-section",
  "#tender-edit-form",
  "#requirement-coverage",
  "#submission-plan-completeness",
  "#generated-documents",
  "#generated-documents",
  "#final-package-manifest",
  "#export-package",
] as const;

function stepFromPrimary(primary: TenderNextActionPrimary): WorkflowStep {
  switch (primary) {
    case "UPLOAD_TENDER": return "UPLOAD_TENDER";
    case "FIX_EXTRACTION": return "FIX_EXTRACTION";
    case "RESUME_AI_ANALYZE":
    case "RUN_AI_ANALYZE": return "RUN_AI_ANALYZE";
    case "EDIT_METADATA": return "CONFIRM_METADATA";
    case "REVIEW_REQUIREMENTS": return "CONFIRM_REQUIREMENTS";
    case "BUILD_SUBMISSION_PLAN": return "BUILD_PLAN";
    case "GENERATE_DOCUMENTS": return "GENERATE_DOCUMENTS";
    case "FIX_EXPORT_BLOCKERS": return "VALIDATE_DOCUMENTS";
    case "EXPORT_READY": return "EXPORT_ZIP";
  }
}

function stepColor(step: WorkflowStep) {
  if (step === "COMPLETE" || step === "EXPORT_ZIP") return "border-emerald-200 bg-emerald-50";
  if (step === "RUN_AI_ANALYZE" || step === "BUILD_PLAN" || step === "GENERATE_DOCUMENTS" || step === "REVIEW_MANIFEST") return "border-amber-200 bg-amber-50";
  if (step === "FIX_EXTRACTION" || step === "CONFIRM_REQUIREMENTS" || step === "VALIDATE_DOCUMENTS") return "border-red-200 bg-red-50";
  return "border-amber-200 bg-amber-50";
}

function stepIcon(step: WorkflowStep) {
  if (step === "COMPLETE" || step === "EXPORT_ZIP") return "✓";
  if (step === "FIX_EXTRACTION" || step === "CONFIRM_REQUIREMENTS" || step === "VALIDATE_DOCUMENTS") return "⚠";
  return "→";
}

export async function NextActionPanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;

  await prismaReady;

  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      id: true, title: true, status: true,
      analysisSummary: true, analysisExtractionStatus: true,
      metadataContaminated: true,
      clientName: true, procuringEntityName: true, country: true,
      clientContactName: true, clientContactEmail: true,
      submissionAddress: true, submissionEmails: true,
      submissionMethod: true, deadline: true, currency: true,
      exactFileNaming: true,
      metadataOverrides: {
        select: { field: true, fieldState: true, overrideValue: true },
      },
      files: {
        select: {
          extractedText: true, originalFileName: true, fileName: true,
          totalPages: true, extractedPages: true, ocrPages: true,
          failedPages: true, extractionScore: true,
        },
      },
      requirements: {
        select: {
          id: true, priority: true,
          sourceConfidence: true, sourcePageNumber: true, sourceExactQuote: true,
        },
      },
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        select: { id: true, generationStatus: true, validationStatus: true },
      },
      complianceGaps: {
        where: { isResolved: false, severity: "CRITICAL" },
        select: { id: true },
      },
    },
  }).catch(() => null);

  if (!tender) return null;

  const latestPartialAnalysisJob = await prisma.aiJob.findFirst({
    where: { tenderId, userId, jobType: "AI_ANALYZE", status: "PARTIAL_SUCCESS" },
    orderBy: [{ finishedAt: "desc" }, { startedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  }).catch(() => null);

  const hasFiles = tender.files.length > 0;
  const fileQuality = tender.files.map((f) => {
    const q = assessExtractionQuality(f.extractedText, f.originalFileName || f.fileName);
    const totalPages = f.totalPages ?? 0;
    const extractedPages = f.extractedPages ?? 0;
    const failedPages = f.failedPages ?? 0;
    const pageCoveragePercent = totalPages > 0 ? Math.round((extractedPages / totalPages) * 100) : null;
    return {
      corrupted: f.extractedText ? isExtractionCorrupted(f.extractedText) : false,
      failed: q.severity === "FAILED" || failedPages > 0,
      weak: q.severity === "POOR" || q.severity === "WARNING",
      score: Math.min(f.extractionScore ?? q.score, q.score),
      pageCoveragePercent,
      partialCoverage: totalPages > 0 && extractedPages < totalPages,
    };
  });
  const anyCorrupted = fileQuality.some((f) => f.corrupted);
  const anyFailed = fileQuality.some((f) => f.failed);
  const anyWeak = fileQuality.some((f) => f.weak);
  const anyPartialCoverage = fileQuality.some((f) => f.partialCoverage);
  const avgScore = fileQuality.length > 0
    ? Math.round(fileQuality.reduce((s, f) => s + f.score, 0) / fileQuality.length)
    : 0;
  const pageCoverageValues = fileQuality
    .map((f) => f.pageCoveragePercent)
    .filter((v): v is number => typeof v === "number");
  const minPageCoveragePercent = pageCoverageValues.length > 0 ? Math.min(...pageCoverageValues) : undefined;

  const aiAnalyzed = Boolean(tender.analysisSummary);
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
    requirementCount: tender.requirements.length,
  }, tender.metadataOverrides);
  const metadataOk = metaReport.missingCritical.length === 0 &&
    metaReport.placeholderCount === 0 &&
    !tender.metadataContaminated;

  const mandatoryReqs = tender.requirements.filter((r) => r.priority === "MANDATORY" || r.priority === "CRITICAL");
  const tracedReqs = mandatoryReqs.filter(
    (r) => (r.sourceConfidence ?? 0) > 0 || r.sourcePageNumber != null || (r.sourceExactQuote ?? "").trim().length > 0,
  );
  const allTracedReqs = tender.requirements.filter(
    (r) => (r.sourceConfidence ?? 0) > 0 || r.sourcePageNumber != null || (r.sourceExactQuote ?? "").trim().length > 0,
  );

  const planFiles = safeParseJsonArray(tender.exactFileNaming);
  const hasPlan = Array.isArray(planFiles) && planFiles.length > 0;

  const generatedDocs = tender.generatedDocuments.filter((d) => d.generationStatus === "GENERATED");
  const hasGeneratedDocs = generatedDocs.length > 0;
  const validationPassed = generatedDocs.every(
    (d) => d.validationStatus === "PASSED" || d.validationStatus === "VALIDATED",
  );

  const decision = resolveTenderNextAction({
    hasFiles,
    extraction: {
      corrupted: anyCorrupted || tender.analysisExtractionStatus === "EXTRACTION_CORRUPTED_AI_SKIPPED",
      poor: anyFailed || anyWeak || avgScore < 80,
      ocrRequired: tender.analysisExtractionStatus === "OCR_REQUIRED",
      partial: anyPartialCoverage || tender.analysisExtractionStatus === "PARTIAL_EXTRACTION_AI_ANALYZED",
      pageCoveragePercent: minPageCoveragePercent,
      averageScore: avgScore,
    },
    resumableAnalysisAvailable: Boolean(latestPartialAnalysisJob),
    aiAnalysis: {
      exists: aiAnalyzed,
      trusted: aiAnalyzed && tender.analysisExtractionStatus !== "REGEX_FALLBACK_FROM_WEAK_EXTRACTION" && tender.analysisExtractionStatus !== "EXTRACTION_CORRUPTED_AI_SKIPPED",
      status: tender.analysisExtractionStatus ?? null,
      regexFallback: tender.analysisExtractionStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION",
      partial: tender.analysisExtractionStatus === "AI_ANALYSIS_PARTIAL",
    },
    metadata: {
      trusted: metadataOk,
      missingFields: metaReport.missingCritical.map((f) => f.field),
      contaminated: tender.metadataContaminated,
      placeholderCount: metaReport.placeholderCount,
    },
    requirements: {
      rawCount: tender.requirements.length,
      trustedTracedCount: allTracedReqs.length,
      mandatoryCount: mandatoryReqs.length,
      mandatoryTracedCount: tracedReqs.length,
    },
    submissionPlanBuilt: hasPlan,
    documents: {
      current: hasGeneratedDocs && validationPassed,
      hasGeneratedDocuments: hasGeneratedDocs,
      stale: false,
    },
    exportBlockersCount: tender.complianceGaps.length + (validationPassed ? 0 : 1),
    exported: tender.status === "EXPORTED",
  });

  const step = stepFromPrimary(decision.primary);
  const label = decision.label;
  const reason = decision.reason;
  const blockers = decision.blockers;
  const currentIndex = STEP_INDEX[step];

  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${stepColor(step)}`} aria-labelledby="next-required-action-title">
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

      <nav className="mt-4 flex flex-wrap gap-1.5" aria-label="Tender workflow shortcuts">
        {STEPS.map((s, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          const doneClass = decision.primary === "FIX_EXTRACTION" || decision.primary === "REVIEW_REQUIREMENTS"
            ? "bg-slate-100 text-slate-500 hover:bg-slate-200"
            : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200";
          const baseClass = done ? doneClass :
            active ? "bg-slate-900 text-white hover:bg-slate-800" :
            "bg-slate-100 text-slate-500 hover:bg-slate-200";
          return (
            <a
              key={s}
              href={STEP_TARGETS[i]}
              aria-current={active ? "step" : undefined}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${baseClass}`}
              title={`Go to ${s}`}
            >
              <span aria-hidden="true">{done ? "✓ " : active ? "→ " : ""}</span>{s}
            </a>
          );
        })}
      </nav>

      {decision.rawVsTrustedRequirements && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-white px-4 py-2.5 text-sm text-amber-800">
          <p className="text-xs font-semibold uppercase">Requirement trust split</p>
          <p className="mt-1 text-xs">
            Raw fallback requirements: {decision.rawVsTrustedRequirements.raw} · Trusted traced requirements: {decision.rawVsTrustedRequirements.trusted} · Mandatory traced: {decision.rawVsTrustedRequirements.mandatoryTraced}/{decision.rawVsTrustedRequirements.mandatory}
          </p>
        </div>
      )}

      {blockers.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm">
          <p className="text-xs font-semibold uppercase text-red-700">Blockers to resolve</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-red-700">
            {blockers.slice(0, 5).map((b) => <li key={b}>{b}</li>)}
          </ul>
        </div>
      )}

      {decision.primary === "FIX_EXTRACTION" && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-white px-4 py-2.5 text-sm text-amber-800">
          <strong>Fix Extraction First.</strong> Run OCR, re-extract, or upload a clearer PDF before running AI Analyze. AI analysis on weak extraction can produce incomplete requirements and unsafe downstream guidance.
        </div>
      )}

      {decision.primary === "GENERATE_DOCUMENTS" && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-white px-4 py-2.5 text-sm text-emerald-800">
          <strong>All pre-generation gates pass.</strong> You can now generate the proposal. Generation is blocked server-side until extraction, analysis, metadata, requirements, source traceability, and plan are all valid.
        </div>
      )}

      {decision.primary === "EXPORT_READY" && (
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
