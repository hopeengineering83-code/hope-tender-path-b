import { PrismaClient, TenderRequirement, TenderFile } from "@prisma/client";
import { ANALYSIS_APPROVAL_GAP_TITLE } from "../analysis-source";

export type TenderAnalysisState =
  | "NOT_STARTED"
  | "RUNNING"
  | "AI_SUCCEEDED"
  | "PARTIAL_AI_NEEDS_REVIEW"
  | "REGEX_FALLBACK_UNAPPROVED"
  | "HUMAN_APPROVED_FALLBACK"
  | "SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED"
  | "FAILED"
  | "SUPERSEDED";

export type AnalysisResolverResult = {
  state: TenderAnalysisState;
  latestJobId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  analysisSource: "AI" | "REGEX_FALLBACK" | "UNKNOWN";
  successfulProvider: string | null;
  attemptedProviders: string[];
  providerFailureCategories: Record<string, string>;
  requirementsExtracted: number;
  requirementsPersisted: number;
  sourceReferencesCreated: number;
  metadataFieldsPersisted: number;
  completedChunks: number;
  totalChunks: number;
  resumableJobId: string | null;
  nextAction: string | null;
  safeDiagnosticSummary: string;
};

export async function resolveTenderAnalysisState(
  prisma: PrismaClient,
  tenderId: string
): Promise<AnalysisResolverResult> {
  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    include: {
      requirements: true,
      files: true,
      complianceGaps: {
        where: { title: ANALYSIS_APPROVAL_GAP_TITLE, severity: "ADVISORY", isResolved: true }
      }
    }
  });

  if (!tender) {
    throw new Error("Tender not found");
  }

  const latestJob = await prisma.aiJob.findFirst({
    where: { tenderId, jobType: "AI_ANALYZE" },
    orderBy: { createdAt: "desc" },
    include: { steps: true }
  });

  const chunks = await prisma.aiAnalyzeChunk.findMany({
    where: { tenderId },
    orderBy: { chunkIndex: "asc" }
  });

  const requirements = tender.requirements;
  const isApprovedFallback = tender.complianceGaps.length > 0;

  // Default result
  const result: AnalysisResolverResult = {
    state: "NOT_STARTED",
    latestJobId: latestJob?.id ?? null,
    startedAt: latestJob?.startedAt ?? null,
    finishedAt: latestJob?.finishedAt ?? null,
    analysisSource: "UNKNOWN",
    successfulProvider: null,
    attemptedProviders: [],
    providerFailureCategories: {},
    requirementsExtracted: 0,
    requirementsPersisted: requirements.length,
    sourceReferencesCreated: requirements.filter(r => Boolean(r.sourceTenderFileId || r.sourcePageNumber || r.sourceExactQuote)).length,
    metadataFieldsPersisted: 0,
    completedChunks: chunks.filter(c => c.status === "SUCCEEDED").length,
    totalChunks: chunks.length > 0 ? chunks[0].totalChunks : 0,
    resumableJobId: null,
    nextAction: null,
    safeDiagnosticSummary: "The analysis process has not been started for this tender."
  };

  // Metadata count
  let metaCount = 0;
  if (tender.title) metaCount++;
  if (tender.clientName || tender.procuringEntityName) metaCount++;
  if (tender.reference) metaCount++;
  if (tender.deadline) metaCount++;
  result.metadataFieldsPersisted = metaCount;

  // Check for detected sections in files
  let sectionsDetected = false;
  for (const file of tender.files) {
    try {
        const pageStatus = JSON.parse(file.pageStatusJson || "[]");
        if (Array.isArray(pageStatus)) {
            if (pageStatus.some(p => p.hasSubmissionInstructions || p.hasEvaluationCriteria || p.hasRequiredDocuments)) {
                sectionsDetected = true;
                break;
            }
        }
    } catch (e) {}
  }

  // If no job and no chunks, check legacy notes
  if (!latestJob && chunks.length === 0) {
    if (/analysis\s+source:\s*regex\s+fallback/i.test(tender.notes ?? "")) {
        if (isApprovedFallback) {
            result.state = "HUMAN_APPROVED_FALLBACK";
            result.analysisSource = "REGEX_FALLBACK";
            result.safeDiagnosticSummary = "The current analysis uses a rule-based fallback which has been reviewed and approved.";
        } else {
            result.state = "REGEX_FALLBACK_UNAPPROVED";
            result.analysisSource = "REGEX_FALLBACK";
            result.nextAction = "RETRY_AI_ANALYZE_OR_APPROVE_FALLBACK";
            result.safeDiagnosticSummary = "The current analysis used a simple fallback because AI was unavailable. Please review and approve it, or retry AI analysis.";
        }
        return result;
    }
    if (/analysis\s+source:\s*ai/i.test(tender.notes ?? "")) {
        result.state = "AI_SUCCEEDED";
        result.analysisSource = "AI";
        result.safeDiagnosticSummary = "AI analysis was completed successfully.";
        return result;
    }

    if (sectionsDetected && requirements.length === 0) {
        result.state = "SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED";
        result.nextAction = "RETRY_AI_EXTRACTION";
        result.safeDiagnosticSummary = "Important tender sections (like Evaluation or Submission) were detected, but no structured requirements could be saved. Try re-running the extraction.";
        return result;
    }

    return result;
  }

  // Parse input/output
  let jobOutput: any = {};
  try {
    jobOutput = latestJob?.output ? JSON.parse(latestJob.output) : {};
  } catch (e) {}

  result.analysisSource = jobOutput.analysisSource === "REGEX_FALLBACK" ? "REGEX_FALLBACK" : (latestJob ? "AI" : "UNKNOWN");
  result.requirementsExtracted = jobOutput.requirementCount ?? 0;
  result.successfulProvider = jobOutput.analysisProvider ?? null;

  if (latestJob?.status === "RUNNING") {
    result.state = "RUNNING";
    result.nextAction = "WAIT_FOR_COMPLETION";
    result.safeDiagnosticSummary = "AI analysis is currently identifying requirements. This may take a moment.";
    return result;
  }

  if (result.analysisSource === "REGEX_FALLBACK") {
    if (isApprovedFallback) {
      result.state = "HUMAN_APPROVED_FALLBACK";
      result.safeDiagnosticSummary = "The fallback analysis has been reviewed and approved by the team.";
    } else {
      result.state = "REGEX_FALLBACK_UNAPPROVED";
      result.nextAction = "RETRY_AI_ANALYZE_OR_APPROVE_FALLBACK";
      result.safeDiagnosticSummary = "AI providers were unavailable, so a basic analysis was used. Review the results or try AI Analyze again.";
    }
    return result;
  }

  if (latestJob?.status === "SUCCEEDED" || latestJob?.status === "PARTIAL_SUCCESS") {
    const isPartial = jobOutput.chunks?.isPartial || (result.totalChunks > 0 && result.completedChunks < result.totalChunks);

    if (isPartial && result.completedChunks > 0) {
      result.state = "PARTIAL_AI_NEEDS_REVIEW";
      result.resumableJobId = latestJob.id;
      result.nextAction = "CONTINUE_AI_ANALYSIS";
      result.safeDiagnosticSummary = `AI analysis is partially complete (${result.completedChunks} of ${result.totalChunks} parts). You can resume the process or review the current results.`;
    } else if (latestJob.status === "SUCCEEDED" || (result.totalChunks > 0 && result.completedChunks === result.totalChunks)) {
      if (requirements.length === 0 && sectionsDetected) {
          result.state = "SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED";
          result.nextAction = "RETRY_AI_EXTRACTION";
          result.safeDiagnosticSummary = "AI analysis finished but could not find specific requirements within the detected pages. Manual review or re-extraction is recommended.";
      } else {
          result.state = "AI_SUCCEEDED";
          result.safeDiagnosticSummary = "AI analysis has successfully identified and saved the tender requirements.";
      }
    } else {
      result.state = "FAILED";
      result.nextAction = "RETRY_AI_ANALYZE";
      result.safeDiagnosticSummary = "AI analysis was unable to produce a usable result. Please check the source files and try again.";
    }
    return result;
  }

  if (latestJob?.status === "FAILED") {
    result.state = "FAILED";
    result.nextAction = "RETRY_AI_ANALYZE";
    result.safeDiagnosticSummary = latestJob.errorMessage ?? "AI analysis encountered an error. Please retry or contact support if the issue persists.";
    return result;
  }

  return result;
}

export async function checkRequirementConsistency(prisma: PrismaClient, tenderId: string) {
  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    include: { files: true, requirements: true }
  });
  if (!tender) return null;

  let sectionsDetected = false;
  for (const file of tender.files) {
    try {
      const pageStatus = JSON.parse(file.pageStatusJson || "[]");
      if (Array.isArray(pageStatus)) {
        if (pageStatus.some((p: any) => p.hasSubmissionInstructions || p.hasEvaluationCriteria || p.hasRequiredDocuments)) {
          sectionsDetected = true;
          break;
        }
      }
    } catch (e) {}
  }

  if (sectionsDetected && tender.requirements.length === 0) {
    return "SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED";
  }
  return "CONSISTENT";
}
