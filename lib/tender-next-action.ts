export type TenderNextActionPrimary =
  | "UPLOAD_TENDER"
  | "FIX_EXTRACTION"
  | "RESUME_AI_ANALYZE"
  | "RUN_AI_ANALYZE"
  | "EDIT_METADATA"
  | "REVIEW_REQUIREMENTS"
  | "BUILD_SUBMISSION_PLAN"
  | "GENERATE_DOCUMENTS"
  | "FIX_EXPORT_BLOCKERS"
  | "EXPORT_READY";

export type TenderNextActionDecision = {
  primary: TenderNextActionPrimary;
  label: string;
  reason: string;
  blockers: string[];
  tone: "green" | "amber" | "red";
  readyForAnalysis: boolean;
  readyForGeneration: boolean;
  readyForExport: boolean;
  readyForShare: boolean;
  rawVsTrustedRequirements?: {
    raw: number;
    trusted: number;
    mandatory: number;
    mandatoryTraced: number;
  };
};

export type TenderNextActionInput = {
  hasFiles: boolean;
  extraction: {
    corrupted?: boolean;
    poor?: boolean;
    ocrRequired?: boolean;
    partial?: boolean;
    pageCoveragePercent?: number | null;
    averageScore?: number | null;
  };
  resumableAnalysisAvailable?: boolean;
  aiAnalysis: {
    exists: boolean;
    trusted?: boolean;
    status?: string | null;
    regexFallback?: boolean;
    partial?: boolean;
  };
  metadata: {
    trusted: boolean;
    missingFields?: string[];
    contaminated?: boolean;
    placeholderCount?: number;
  };
  requirements: {
    rawCount: number;
    trustedTracedCount: number;
    mandatoryCount: number;
    mandatoryTracedCount: number;
  };
  submissionPlanBuilt: boolean;
  documents: {
    current: boolean;
    hasGeneratedDocuments?: boolean;
    stale?: boolean;
  };
  exportBlockersCount: number;
  exported?: boolean;
};

function extractionIsNotReady(input: TenderNextActionInput["extraction"]) {
  const coverageFailed = typeof input.pageCoveragePercent === "number" && input.pageCoveragePercent < 80;
  const scoreFailed = typeof input.averageScore === "number" && input.averageScore < 80;
  return Boolean(input.corrupted || input.poor || input.ocrRequired || input.partial || coverageFailed || scoreFailed);
}

function extractionBlockers(input: TenderNextActionInput["extraction"]): string[] {
  const blockers: string[] = [];
  if (input.corrupted) blockers.push("Extraction is corrupted — run OCR or upload a clearer source file");
  if (input.ocrRequired) blockers.push("OCR is required before reliable AI analysis");
  if (input.partial) blockers.push("Document is only partially extracted");
  if (typeof input.pageCoveragePercent === "number" && input.pageCoveragePercent < 80) {
    blockers.push(`Page coverage ${input.pageCoveragePercent}% is below the 80% readiness threshold`);
  }
  if (typeof input.averageScore === "number" && input.averageScore < 80) {
    blockers.push(`Average extraction score ${input.averageScore}/100 is below the 80/100 review threshold`);
  }
  if (input.poor && blockers.length === 0) blockers.push("Extraction quality is weak or poor");
  return blockers;
}

export function resolveTenderNextAction(input: TenderNextActionInput): TenderNextActionDecision {
  const readyForAnalysis = input.hasFiles && !input.extraction.corrupted && !input.extraction.ocrRequired;
  const requirementsTrusted = input.requirements.rawCount > 0 &&
    input.requirements.trustedTracedCount > 0 &&
    (input.requirements.mandatoryCount === 0 || input.requirements.mandatoryTracedCount >= input.requirements.mandatoryCount);
  const readyForGeneration = input.hasFiles &&
    !extractionIsNotReady(input.extraction) &&
    input.aiAnalysis.exists &&
    input.metadata.trusted &&
    requirementsTrusted &&
    input.submissionPlanBuilt;
  const readyForExport = readyForGeneration && input.documents.current && input.exportBlockersCount === 0;
  const readyForShare = input.documents.hasGeneratedDocuments || readyForExport;

  if (!input.hasFiles) {
    return {
      primary: "UPLOAD_TENDER",
      label: "Upload tender document",
      reason: "Upload at least one tender source file (PDF or DOCX) to begin the workflow.",
      blockers: ["No tender files uploaded yet"],
      tone: "amber",
      readyForAnalysis: false,
      readyForGeneration: false,
      readyForExport: false,
      readyForShare: false,
    };
  }

  if (extractionIsNotReady(input.extraction)) {
    return {
      primary: "FIX_EXTRACTION",
      label: "Fix Extraction Quality",
      reason: "Tender document extraction is weak, partial, or corrupted. Run OCR or re-extract to ensure AI analysis is reliable.",
      blockers: extractionBlockers(input.extraction),
      tone: input.extraction.corrupted ? "red" : "amber",
      readyForAnalysis,
      readyForGeneration: false,
      readyForExport: false,
      readyForShare,
    };
  }

  if (input.resumableAnalysisAvailable) {
    return {
      primary: "RESUME_AI_ANALYZE",
      label: "Resume AI Analysis",
      reason: "A previous analysis run was interrupted. Resume to complete the requirement extraction.",
      blockers: [],
      tone: "amber",
      readyForAnalysis,
      readyForGeneration: false,
      readyForExport: false,
      readyForShare,
    };
  }

  if (!input.aiAnalysis.exists) {
    return {
      primary: "RUN_AI_ANALYZE",
      label: "Run AI Analysis",
      reason: "Tender documents are extracted. Run AI Analysis to identify requirements and metadata.",
      blockers: ["AI Analysis has not been performed yet"],
      tone: "amber",
      readyForAnalysis,
      readyForGeneration: false,
      readyForExport: false,
      readyForShare,
    };
  }

  if (!input.aiAnalysis.trusted || input.aiAnalysis.regexFallback || input.aiAnalysis.partial) {
    const rawVsTrustedRequirements = input.requirements.rawCount > 0
      ? {
          raw: input.requirements.rawCount,
          trusted: input.requirements.trustedTracedCount,
          mandatory: input.requirements.mandatoryCount,
          mandatoryTraced: input.requirements.mandatoryTracedCount,
        }
      : undefined;
    return {
      primary: "REVIEW_REQUIREMENTS",
      label: input.aiAnalysis.regexFallback ? "Review Fallback Requirements" : "Review AI Analysis",
      reason: input.aiAnalysis.regexFallback
        ? "Analysis used a search-based fallback due to weak extraction. Review and trace requirements before proceeding."
        : "AI analysis is incomplete or requires review. Confirm the extracted requirements.",
      blockers: [
        input.aiAnalysis.regexFallback ? "Analysis used regex fallback — re-extract after OCR for better results" : "Analysis is partial or requires manual review",
        ...(input.requirements.mandatoryCount > input.requirements.mandatoryTracedCount ? [`Mandatory traced: ${input.requirements.mandatoryTracedCount}/${input.requirements.mandatoryCount}`] : []),
      ],
      tone: "amber",
      readyForAnalysis,
      readyForGeneration: false,
      readyForExport: false,
      readyForShare,
      rawVsTrustedRequirements,
    };
  }

  if (!input.metadata.trusted) {
    return {
      primary: "EDIT_METADATA",
      label: "Edit Tender Metadata",
      reason: "Essential tender details like client name, reference, or deadline are missing or contain placeholders.",
      blockers: [
        ...(input.metadata.missingFields ?? []).slice(0, 4).map((field) => `Missing field: ${field}`),
        ...(input.metadata.contaminated ? ["Metadata is contaminated with website/portal noise"] : []),
        ...((input.metadata.placeholderCount ?? 0) > 0 ? [`${input.metadata.placeholderCount} field(s) contain 'TBC' or placeholders`] : []),
      ],
      tone: "amber",
      readyForAnalysis,
      readyForGeneration: false,
      readyForExport: false,
      readyForShare,
    };
  }

  const rawVsTrustedRequirements = input.requirements.rawCount > 0
    ? {
        raw: input.requirements.rawCount,
        trusted: input.requirements.trustedTracedCount,
        mandatory: number(input.requirements.mandatoryCount),
        mandatoryTraced: number(input.requirements.mandatoryTracedCount),
      }
    : undefined;

  if (!requirementsTrusted) {
    return {
      primary: "REVIEW_REQUIREMENTS",
      label: "Review Tender Requirements",
      reason: input.requirements.rawCount === 0
        ? "No requirements found. Run AI Analysis or add requirements manually to proceed."
        : "Some requirements lack source traceability or mandatory evidence links.",
      blockers: input.requirements.rawCount === 0
        ? ["No requirements found in the tender"]
        : [
            `Traced requirements: ${input.requirements.trustedTracedCount}/${input.requirements.rawCount}`,
            `Mandatory requirements traced: ${input.requirements.mandatoryTracedCount}/${input.requirements.mandatoryCount}`,
          ],
      tone: "amber",
      readyForAnalysis,
      readyForGeneration: false,
      readyForExport: false,
      readyForShare,
      rawVsTrustedRequirements,
    };
  }

  if (!input.submissionPlanBuilt) {
    return {
      primary: "BUILD_SUBMISSION_PLAN",
      label: "Approve Submission Plan",
      reason: "Prerequisites are met. Review and approve the submission plan before generating the proposal.",
      blockers: ["Submission plan is not yet approved"],
      tone: "amber",
      readyForAnalysis,
      readyForGeneration: false,
      readyForExport: false,
      readyForShare,
    };
  }

  if (!input.documents.current) {
    return {
      primary: "GENERATE_DOCUMENTS",
      label: input.documents.stale ? "Regenerate Proposal" : "Generate Proposal Documents",
      reason: input.documents.stale
        ? "The analysis or plan has changed. Regenerate documents to keep them up to date."
        : "Everything is ready. Generate the draft proposal documents.",
      blockers: input.documents.stale ? ["Generated documents are out of date"] : [],
      tone: input.documents.stale ? "amber" : "green",
      readyForAnalysis,
      readyForGeneration: true,
      readyForExport: false,
      readyForShare,
    };
  }

  if (input.exportBlockersCount > 0) {
    return {
      primary: "FIX_EXPORT_BLOCKERS",
      label: "Resolve Export Blockers",
      reason: "Documents are generated, but some critical validation errors or compliance gaps remain.",
      blockers: [`${input.exportBlockersCount} critical export blocker(s) found`],
      tone: "red",
      readyForAnalysis,
      readyForGeneration: true,
      readyForExport: false,
      readyForShare,
    };
  }

  return {
    primary: "EXPORT_READY",
    label: input.exported ? "Tender Exported" : "Ready for Export",
    reason: input.exported
      ? "The final submission package has been exported."
      : "All checks passed. Review the final manifest and export the submission package.",
    blockers: [],
    tone: "green",
    readyForAnalysis,
    readyForGeneration: true,
    readyForExport: true,
    readyForShare: true,
  };
}

function number(val: unknown): number {
  return typeof val === "number" ? val : 0;
}
