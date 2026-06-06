// Next Required Action panel — server component.
//
// Shows the current workflow step + the single most important action the
// user must take next. Uses the pipeline-diagnostic logic inline (no extra
// HTTP round-trip) so it renders correctly during SSR.
//
// Workflow order:
//   1 Upload Tender   6 Confirm Evidence
//   2 Fix Extraction  7 Generate Docs
//   3 Run AI Analyze  8 Validate Docs
//   4 Confirm Metadata  9 Review Manifest
//   5 Build Plan       10 Export ZIP

import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { assessExtractionQuality } from "../lib/extraction-quality";
import { isExtractionCorrupted } from "../lib/engine/extraction-quality-gate";
import { assessTenderMetadataCompleteness } from "../lib/engine/tender-metadata-completeness";
import { safeParseJsonArray } from "../lib/safe-json";

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
  | "CONFIRM_EVIDENCE"
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
  CONFIRM_EVIDENCE: 5,
  GENERATE_DOCUMENTS: 6,
  VALIDATE_DOCUMENTS: 7,
  REVIEW_MANIFEST: 8,
  EXPORT_ZIP: 9,
  COMPLETE: 10,
};

function stepColor(step: WorkflowStep) {
  if (step === "COMPLETE") return "border-emerald-200 bg-emerald-50";
  if (step === "EXPORT_ZIP" || step === "REVIEW_MANIFEST") return "border-blue-200 bg-blue-50";
  return "border-amber-200 bg-amber-50";
}

function stepIcon(step: WorkflowStep) {
  if (step === "COMPLETE") return "✓";
  if (step === "FIX_EXTRACTION" || step === "CONFIRM_METADATA") return "⚠";
  if (step === "EXPORT_ZIP") return "↓";
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

  // ── Derive pipeline state ─────────────────────────────────────────────────
  const hasFiles = tender.files.length > 0;

  const fileQuality = tender.files.map((f) => {
    const q = assessExtractionQuality(f.extractedText, f.originalFileName || f.fileName);
    return {
      corrupted: f.extractedText ? isExtractionCorrupted(f.extractedText) : false,
      failed: q.severity === "FAILED",
      score: Math.min(f.extractionScore ?? q.score, q.score),
    };
  });
  const anyCorrupted = fileQuality.some((f) => f.corrupted);
  const anyFailed = fileQuality.some((f) => f.failed);
  const avgScore = fileQuality.length > 0
    ? Math.round(fileQuality.reduce((s, f) => s + f.score, 0) / fileQuality.length)
    : 0;
  const extractionOk = hasFiles && !anyCorrupted && !anyFailed && avgScore >= 45;

  const aiAnalyzed = Boolean(tender.analysisSummary);
  const aiAnalyzeOk = aiAnalyzed && tender.analysisExtractionStatus !== "EXTRACTION_CORRUPTED_AI_SKIPPED";

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
  });
  const metadataOk = metaReport.missingCritical.length === 0 &&
    metaReport.placeholderCount === 0 &&
    !tender.metadataContaminated;

  const mandatoryReqs = tender.requirements.filter((r) => r.priority === "MANDATORY");
  const tracedReqs = mandatoryReqs.filter(
    (r) => (r.sourceConfidence ?? 0) > 0 || r.sourcePageNumber != null || (r.sourceExactQuote ?? "").trim().length > 0,
  );
  const requirementsOk = tender.requirements.length > 0 &&
    (mandatoryReqs.length === 0 || tracedReqs.length > 0);

  const planFiles = safeParseJsonArray(tender.exactFileNaming);
  const hasPlan = Array.isArray(planFiles) && planFiles.length > 0;

  const generatedDocs = tender.generatedDocuments.filter((d) => d.generationStatus === "GENERATED");
  const hasGeneratedDocs = generatedDocs.length > 0;
  const validationPassed = generatedDocs.every(
    (d) => d.validationStatus === "PASSED" || d.validationStatus === "VALIDATED",
  );

  // ── Derive next step ──────────────────────────────────────────────────────
  let step: WorkflowStep;
  let label: string;
  let reason: string;
  let blockers: string[] = [];

  if (!hasFiles) {
    step = "UPLOAD_TENDER"; label = "Upload tender document";
    reason = "No tender file has been uploaded. Upload a PDF or DOCX to begin.";
  } else if (!extractionOk) {
    step = "FIX_EXTRACTION"; label = "Fix extraction quality";
    reason = "Tender file extraction quality is too poor to continue.";
    if (anyCorrupted) blockers.push("Extracted text is corrupted — enable OCR or upload a clearer scan");
    if (anyFailed) blockers.push("One or more pages failed to extract");
    if (avgScore < 45) blockers.push(`Average extraction score ${avgScore}/100 is below the 45/100 minimum`);
  } else if (!aiAnalyzeOk) {
    step = "RUN_AI_ANALYZE"; label = "Run AI Analyze";
    reason = !aiAnalyzed
      ? "The tender has not been analyzed yet. Run AI Analyze to extract requirements, client details, and evaluation criteria."
      : "AI Analyze was blocked due to corrupted extraction. Fix extraction and re-run.";
    if (!aiAnalyzed) blockers.push("AI Analyze not run");
    if (tender.analysisExtractionStatus === "EXTRACTION_CORRUPTED_AI_SKIPPED") blockers.push("Analysis skipped: corrupted extraction");
  } else if (!metadataOk) {
    step = "CONFIRM_METADATA"; label = "Confirm tender metadata";
    reason = "Critical metadata fields are missing or contain placeholder text. Fill them before building the submission plan.";
    metaReport.missingCritical.slice(0, 4).forEach((f) => blockers.push(`Missing: ${f.field}`));
    if (tender.metadataContaminated) blockers.push("Client name contains portal noise — needs manual correction");
    if (metaReport.placeholderCount > 0) blockers.push(`${metaReport.placeholderCount} metadata field(s) contain placeholder text`);
  } else if (!requirementsOk) {
    step = "CONFIRM_REQUIREMENTS"; label = "Confirm extracted requirements";
    if (tender.requirements.length === 0) {
      reason = "No requirements were extracted. Re-run AI Analyze or add requirements manually.";
      blockers.push("No requirements extracted");
    } else {
      const untraced = mandatoryReqs.length - tracedReqs.length;
      reason = `${untraced} mandatory requirement(s) lack source page/quote traceability. Run AI Analyze again or use the repair tool.`;
      blockers.push(`${untraced} untraced mandatory requirements`);
    }
  } else if (!hasPlan) {
    step = "BUILD_PLAN"; label = "Build submission plan";
    reason = "No submission plan has been built. Build Plan before generating documents.";
    blockers.push("No submission plan");
  } else if (!hasGeneratedDocs) {
    step = "GENERATE_DOCUMENTS"; label = "Generate proposal documents";
    reason = "All pre-generation gates pass. Click Generate Docs to create the proposal.";
  } else if (!validationPassed || tender.complianceGaps.length > 0) {
    step = "VALIDATE_DOCUMENTS"; label = "Validate and approve generated documents";
    if (!validationPassed) reason = "One or more generated documents have not passed validation. Review and approve each document.";
    else reason = `${tender.complianceGaps.length} unresolved critical compliance gap(s) must be resolved before export.`;
    if (!validationPassed) blockers.push("Documents need validation/approval");
    if (tender.complianceGaps.length > 0) blockers.push(`${tender.complianceGaps.length} critical compliance gap(s)`);
  } else if (tender.status !== "EXPORTED") {
    step = "EXPORT_ZIP"; label = "Export final ZIP package";
    reason = "All gates pass. Review the Final Package Manifest and export the submission ZIP.";
  } else {
    step = "COMPLETE"; label = "Submission package exported";
    reason = "This tender has been exported. Check the Final Package Manifest for the file list.";
  }

  const currentIndex = STEP_INDEX[step];

  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${stepColor(step)}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Next required action</p>
          <h2 className="mt-1 text-xl font-bold text-slate-900">
            <span className="mr-2 text-slate-400">{stepIcon(step)}</span>
            {label}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-700">{reason}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Step {Math.min(currentIndex + 1, STEPS.length)} of {STEPS.length}</p>
          <p className="text-lg font-bold text-slate-900">{step === "COMPLETE" ? "Done" : `${currentIndex + 1}/${STEPS.length}`}</p>
        </div>
      </div>

      {/* Workflow breadcrumb */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {STEPS.map((s, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <span
              key={s}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                done ? "bg-emerald-100 text-emerald-700" :
                active ? "bg-slate-900 text-white" :
                "bg-slate-100 text-slate-400"
              }`}
            >
              {done ? "✓ " : active ? "→ " : ""}{s}
            </span>
          );
        })}
      </div>

      {blockers.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm">
          <p className="text-xs font-semibold uppercase text-red-700">Blockers to resolve</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-red-700">
            {blockers.slice(0, 5).map((b) => <li key={b}>{b}</li>)}
          </ul>
        </div>
      )}

      {step === "GENERATE_DOCUMENTS" && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-white px-4 py-2.5 text-sm text-emerald-800">
          <strong>All pre-generation gates pass.</strong> You can now generate the proposal. Generation is blocked server-side until extraction, analysis, metadata, requirements, source traceability, and plan are all valid.
        </div>
      )}

      {step === "EXPORT_ZIP" && (
        <div className="mt-3 rounded-lg border border-blue-200 bg-white px-4 py-2.5 text-sm text-blue-800">
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
