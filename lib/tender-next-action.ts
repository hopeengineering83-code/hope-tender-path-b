export type TenderNextActionPrimary =
  | "UPLOAD_TENDER"
  | "FIX_EXTRACTION"
  | "RESUME_AI_ANALYZE"
  | "RUN_AI_ANALYZE"
  | "RERUN_AI_ANALYZE"
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
  rawVsTrustedRequirements?: {
    raw: number;
    trusted: number;
    mandatory: number;
    mandatoryTraced: number;
  };
};

export type ResumableAiAnalyzeJobCandidate = {
  status: string | null | undefined;
  succeededChunkCount?: number | null;
};

export function hasResumableAiAnalyzeCheckpoint(job: ResumableAiAnalyzeJobCandidate | null | undefined): boolean {
  if (!job) return false;
  if (job.status === "PARTIAL_SUCCESS") return true;
  return job.status === "FAILED" && (job.succeededChunkCount ?? 0) > 0;
}

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
    /** True when the current tender source content differs from the
     *  analysis binding hash — the analysis is stale and must be re-run
     *  before downstream steps can proceed. */
    stale?: boolean;
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
  if (!input.hasFiles) {
    return {
      primary: "UPLOAD_TENDER",
      label: "Upload tender document",
      reason: "No tender file has been uploaded. Upload a PDF or DOCX to begin.",
      blockers: ["No tender file uploaded"],
      tone: "amber",
    };
  }

  if (extractionIsNotReady(input.extraction)) {
    return {
      primary: "FIX_EXTRACTION",
      label: "Fix Extraction First",
      reason: "Extraction is weak, partial, corrupted, or below readiness coverage. Run OCR / re-extract before AI Analyze.",
      blockers: extractionBlockers(input.extraction),
      tone: input.extraction.corrupted ? "red" : "amber",
    };
  }

  if (input.resumableAnalysisAvailable) {
    return {
      primary: "RESUME_AI_ANALYZE",
      label: "Resume AI Analyze",
      reason: "A previous AI Analyze run has saved partial progress. Resume it so completed chunks are reused instead of starting from zero.",
      blockers: [],
      tone: "amber",
    };
  }

  // Stale analysis check: if the tender source content has changed since
  // the last analysis run, the existing analysis is stale and must be
  // re-run before any downstream step can proceed. This is critical for
  // safety — stale analysis must NOT enable Build Plan, generation,
  // validation, or export. Per spec rule 2.
  if (input.aiAnalysis.exists && input.aiAnalysis.stale) {
    return {
      primary: "RERUN_AI_ANALYZE",
      label: "Re-run AI Analyze",
      reason: "Tender source content has changed since the last AI analysis. The existing analysis is stale and must be re-run before Build Plan, generation, or export can proceed safely.",
      blockers: ["Analysis is stale — tender source content changed since last analysis"],
      tone: "red",
    };
  }

  if (!input.aiAnalysis.exists) {
    return {
      primary: "RUN_AI_ANALYZE",
      label: "Run AI Analyze",
      reason: "Extraction is ready, but AI Analyze has not been run yet.",
      blockers: ["AI Analyze not run"],
      tone: "amber",
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
      label: input.aiAnalysis.regexFallback ? "Review fallback requirements" : "Review AI analysis",
      reason: input.aiAnalysis.regexFallback
        ? "Regex fallback is draft-only. Review source tracing and do not treat it as final-export ready unless there is an explicit admin override."
        : "AI analysis is partial or untrusted. Review it before continuing downstream.",
      blockers: [
        input.aiAnalysis.regexFallback ? "Analysis used regex fallback (weak extraction) — re-extract and re-run AI Analyze for a trusted result" : "Analysis is partial or untrusted",
        ...(input.requirements.mandatoryCount > input.requirements.mandatoryTracedCount ? [`Mandatory traced: ${input.requirements.mandatoryTracedCount}/${input.requirements.mandatoryCount}`] : []),
      ],
      tone: "amber",
      rawVsTrustedRequirements,
    };
  }

  if (!input.metadata.trusted) {
    return {
      primary: "EDIT_METADATA",
      label: "Edit Tender Details",
      reason: "Critical Tender Details are missing, contaminated, or contain placeholder values.",
      blockers: [
        ...(input.metadata.missingFields ?? []).slice(0, 4).map((field) => `Missing: ${field}`),
        ...(input.metadata.contaminated ? ["Tender Details appear contaminated by portal/noise text"] : []),
        ...((input.metadata.placeholderCount ?? 0) > 0 ? [`${input.metadata.placeholderCount} Tender Detail field(s) contain placeholder text`] : []),
      ],
      tone: "amber",
    };
  }

  const rawVsTrustedRequirements = input.requirements.rawCount > 0
    ? {
        raw: input.requirements.rawCount,
        trusted: input.requirements.trustedTracedCount,
        mandatory: input.requirements.mandatoryCount,
        mandatoryTraced: input.requirements.mandatoryTracedCount,
      }
    : undefined;
  const requirementsTrusted = input.requirements.rawCount > 0 &&
    input.requirements.trustedTracedCount > 0 &&
    (input.requirements.mandatoryCount === 0 || input.requirements.mandatoryTracedCount >= input.requirements.mandatoryCount);

  if (!requirementsTrusted) {
    return {
      primary: "REVIEW_REQUIREMENTS",
      label: "Review requirements",
      reason: input.requirements.rawCount === 0
        ? "No requirements are available. Run AI Analyze only after extraction is ready, or add requirements manually."
        : "Raw requirements exist, but trusted source-traced requirements are not ready.",
      blockers: input.requirements.rawCount === 0
        ? ["No requirements available"]
        : [`Trusted traced requirements: ${input.requirements.trustedTracedCount}/${input.requirements.rawCount}`, `Mandatory traced: ${input.requirements.mandatoryTracedCount}/${input.requirements.mandatoryCount}`],
      tone: "amber",
      rawVsTrustedRequirements,
    };
  }

  if (!input.submissionPlanBuilt) {
    return {
      primary: "BUILD_SUBMISSION_PLAN",
      label: "Review and confirm Build Plan",
      reason: "Extraction, analysis, Tender Details, and requirements are ready. Build the draft, review its complete ordered scope, and confirm it before generating documents.",
      blockers: ["No current confirmed Build Plan"],
      tone: "amber",
    };
  }

  if (!input.documents.current) {
    return {
      primary: "GENERATE_DOCUMENTS",
      label: input.documents.stale ? "Regenerate stale documents" : "Generate proposal documents",
      reason: input.documents.stale
        ? "Generated documents are stale against the current analysis/readiness state."
        : "All pre-generation gates pass. Generate proposal documents.",
      blockers: input.documents.stale ? ["Generated documents are stale"] : [],
      tone: input.documents.stale ? "amber" : "green",
    };
  }

  if (input.exportBlockersCount > 0) {
    return {
      primary: "FIX_EXPORT_BLOCKERS",
      label: "Fix export blockers",
      reason: "Documents exist, but validation/compliance/export blockers remain.",
      blockers: [`${input.exportBlockersCount} export blocker(s)`],
      tone: "red",
    };
  }

  return {
    primary: "EXPORT_READY",
    label: input.exported ? "Submission package exported" : "Export ready",
    reason: input.exported
      ? "This tender has already been exported."
      : "All visible gates pass. Review the final package manifest and export the submission ZIP.",
    blockers: [],
    tone: "green",
  };
}
