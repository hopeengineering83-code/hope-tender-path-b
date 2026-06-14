import { Tender, TenderRequirement, GeneratedDocument, ComplianceGap, MetadataOverride, TenderFile } from "@prisma/client";
import { assessTenderMetadataCompleteness } from "./engine/tender-metadata-completeness";

export type WorkflowStep =
  | "FIX_EXTRACTION"
  | "RESUME_AI_ANALYZE"
  | "RUN_AI_ANALYZE"
  | "EDIT_METADATA"
  | "REVIEW_REQUIREMENTS"
  | "BUILD_SUBMISSION_PLAN"
  | "GENERATE_DOCUMENTS"
  | "FIX_EXPORT_BLOCKERS"
  | "EXPORT_READY"
  | "COMPLETE";

export interface WorkflowAction {
  step: WorkflowStep;
  label: string;
  reason: string;
  blockers: string[];
  status: "blocked" | "actionable" | "ready" | "complete";
  color: "red" | "amber" | "green" | "blue" | "slate";
}

export interface TenderWorkflowContext {
  tender: Tender & {
    requirements: TenderRequirement[];
    generatedDocuments: GeneratedDocument[];
    complianceGaps: ComplianceGap[];
    metadataOverrides: MetadataOverride[];
    files: TenderFile[];
  };
}

export function resolveNextTenderAction(ctx: TenderWorkflowContext): WorkflowAction {
  const { tender } = ctx;

  const hasFiles = tender.files.length > 0;
  const fileQuality = tender.files.map(f => ({
    corrupted: f.extractedText === "EXTRACTION_CORRUPTED" || (f.extractedText?.length ?? 0) < 50,
    failed: f.extractedText === null || f.extractionMethod === "failed",
    score: f.extractionScore ?? 0,
  }));

  const anyCorrupted = fileQuality.some((f) => f.corrupted);
  const anyFailed = fileQuality.some((f) => f.failed);
  const avgScore = fileQuality.length > 0
    ? Math.round(fileQuality.reduce((s, f) => s + f.score, 0) / fileQuality.length)
    : 0;

  const totalPages = tender.files.reduce((sum, f) => sum + (f.totalPages ?? 0), 0);
  const extractedPages = tender.files.reduce((sum, f) => sum + (f.extractedPages ?? 0), 0);
  const pageCoverage = totalPages > 0 ? (extractedPages / totalPages) : 0;

  const isWeakExtraction = anyCorrupted || anyFailed || avgScore < 45 || (totalPages > 0 && pageCoverage < 0.8);

  const aiAnalyzed = Boolean(tender.analysisSummary);
  const isResumable = tender.status === "AI_ANALYSIS_PARTIAL";
  const isRegexFallback = tender.analysisExtractionStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION";

  const metaReport = assessTenderMetadataCompleteness({
    clientName: (tender.clientName || (tender as any).procuringEntityName) ?? null,
    title: tender.title ?? null,
    reference: tender.reference ?? null,
    country: tender.country ?? null,
    clientContactName: tender.clientContactName ?? null,
    clientContactEmail: tender.clientContactEmail ?? null,
    submissionAddress: tender.submissionAddress ?? null,
    submissionEmails: tender.submissionEmails ?? null,
    submissionMethod: tender.submissionMethod ?? null,
    deadline: tender.deadline ?? null,
    currency: tender.currency ?? null,
    evaluationCriteria: (tender as any).evaluationCriteria ?? null,
    requiredDocuments: (tender as any).requiredDocuments ?? null,
    pageLimit: (tender as any).pageLimit ?? null,
    bidBondAmount: (tender as any).bidBondAmount ?? null,
    mandatorySiteVisit: (tender as any).mandatorySiteVisit ?? null,
    validityDays: (tender as any).validityDays ?? null,
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
  const requirementsTrusted = tender.requirements.length > 0 &&
    (mandatoryReqs.length === 0 || tracedReqs.length > 0) &&
    !isRegexFallback;

  let planFiles: any[] = [];
  try {
    planFiles = JSON.parse(tender.exactFileNaming || "[]");
  } catch (e) {
    planFiles = [];
  }
  const hasPlan = Array.isArray(planFiles) && planFiles.length > 0;

  const generatedDocs = tender.generatedDocuments.filter((d) => d.generationStatus === "GENERATED");
  const hasGeneratedDocs = generatedDocs.length > 0;
  const validationPassed = generatedDocs.every(
    (d) => d.validationStatus === "PASSED" || d.validationStatus === "VALIDATED",
  );

  // 1. Priority order resolution

  // a. FIX_EXTRACTION
  if (!hasFiles || isWeakExtraction) {
    const blockers: string[] = [];
    if (!hasFiles) blockers.push("No tender file uploaded");
    if (anyCorrupted) blockers.push("Extracted text is corrupted");
    if (anyFailed) blockers.push("One or more pages failed to extract");
    if (avgScore < 45 && hasFiles) blockers.push(`Average extraction score ${avgScore}/100 is below minimum`);
    if (totalPages > 0 && pageCoverage < 0.8) blockers.push(`Page coverage (${Math.round(pageCoverage * 100)}%) is below 80% threshold`);

    return {
      step: "FIX_EXTRACTION",
      label: "Fix Extraction First",
      reason: "Tender file extraction quality is too poor to trust AI analysis. Run OCR or re-upload a clearer document.",
      blockers,
      status: "blocked",
      color: "red"
    };
  }

  // b. RESUME_AI_ANALYZE
  if (isResumable) {
    return {
      step: "RESUME_AI_ANALYZE",
      label: "Resume AI Analyze",
      reason: "AI analysis was partially completed before hitting a timeout or interruption.",
      blockers: ["Partial analysis chunks exist"],
      status: "actionable",
      color: "amber"
    };
  }

  // c. RUN_AI_ANALYZE
  if (!aiAnalyzed || isRegexFallback) {
    const label = isRegexFallback ? "Run OCR / Re-extract before AI Analyze" : "Run AI Analyze";
    const reason = isRegexFallback
      ? "Previous analysis used regex fallback because extraction was weak. Requirements and metadata may be incomplete or untrusted."
      : "The tender has not been analyzed yet. Run AI Analyze to extract requirements and metadata.";

    return {
      step: "RUN_AI_ANALYZE",
      label,
      reason,
      blockers: !aiAnalyzed ? ["AI Analyze not run"] : ["Current analysis uses regex fallback"],
      status: "actionable",
      color: isRegexFallback ? "amber" : "blue"
    };
  }

  // d. EDIT_METADATA
  if (!metadataOk) {
    const blockers: string[] = [];
    metaReport.missingCritical.forEach(f => blockers.push(`Missing critical: ${f.field}`));
    if (tender.metadataContaminated) blockers.push("Metadata contains portal noise");
    if (metaReport.placeholderCount > 0) blockers.push(`${metaReport.placeholderCount} placeholder(s) detected`);

    return {
      step: "EDIT_METADATA",
      label: "Edit Metadata",
      reason: "Critical tender details are missing or contain placeholders that would leak into generated documents.",
      blockers,
      status: "actionable",
      color: "amber"
    };
  }

  // e. REVIEW_REQUIREMENTS
  if (!requirementsTrusted) {
    const untraced = mandatoryReqs.length - tracedReqs.length;
    return {
      step: "REVIEW_REQUIREMENTS",
      label: "Review Requirements",
      reason: `${untraced} mandatory requirements lack source tracing or were extracted via untrusted fallback.`,
      blockers: [`${untraced} untraced mandatory requirements`],
      status: "actionable",
      color: "amber"
    };
  }

  // f. BUILD_SUBMISSION_PLAN
  if (!hasPlan) {
    return {
      step: "BUILD_SUBMISSION_PLAN",
      label: "Build Submission Plan",
      reason: "Define which documents need to be generated or included in the final package.",
      blockers: ["No submission plan exists"],
      status: "actionable",
      color: "blue"
    };
  }

  // g. GENERATE_DOCUMENTS
  if (!hasGeneratedDocs) {
    return {
      step: "GENERATE_DOCUMENTS",
      label: "Generate Proposal Documents",
      reason: "All pre-generation gates pass. Generate the initial drafts of your proposal.",
      blockers: [],
      status: "ready",
      color: "green"
    };
  }

  // h. FIX_EXPORT_BLOCKERS
  if (!validationPassed || tender.complianceGaps.length > 0) {
    const blockers: string[] = [];
    if (!validationPassed) blockers.push("Documents need validation/approval");
    if (tender.complianceGaps.length > 0) blockers.push(`${tender.complianceGaps.length} unresolved compliance gap(s)`);

    return {
      step: "FIX_EXPORT_BLOCKERS",
      label: "Fix Export Blockers",
      reason: "Generated documents must be validated and all critical compliance gaps resolved before export.",
      blockers,
      status: "blocked",
      color: "amber"
    };
  }

  // i. EXPORT_READY / COMPLETE
  if (tender.status === "EXPORTED") {
    return {
      step: "COMPLETE",
      label: "Submission Exported",
      reason: "This tender has been successfully exported.",
      blockers: [],
      status: "complete",
      color: "slate"
    };
  }

  return {
    step: "EXPORT_READY",
    label: "Export Ready",
    reason: "All requirements met. You can now export the final submission package.",
    blockers: [],
    status: "ready",
    color: "green"
  };
}
