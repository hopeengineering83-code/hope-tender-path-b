export type ReviewSummary = {
  documents: {
    total: number;
    extracted: number;
    extractedWithoutDraftRecords: number;
    extractedWithoutDraftRecordsList: Array<{ id: string; fileName: string; category: string; extractedChars: number }>;
  };
  experts: { total: number; reviewed: number; aiDraft: number; regexDraft: number };
  projects: { total: number; reviewed: number; aiDraft: number; regexDraft: number };
  pendingReview: number;
  readyForFinalGeneration: boolean;
  warnings: string[];
};

export type ReadinessPresentation = {
  label: "Ready" | "Review required" | "Blocked" | "Unavailable";
  textClass: string;
  detail: string;
};

export function getReviewBoardReadinessPresentation(
  summary: Pick<ReviewSummary, "readyForFinalGeneration" | "pendingReview" | "warnings"> | null,
): ReadinessPresentation {
  if (!summary) {
    return {
      label: "Unavailable",
      textClass: "text-slate-600",
      detail: "Review summary is unavailable.",
    };
  }

  if (!summary.readyForFinalGeneration) {
    return {
      label: "Blocked",
      textClass: "text-red-700",
      detail: `${summary.pendingReview} pending review`,
    };
  }

  if (summary.warnings.length > 0) {
    return {
      label: "Review required",
      textClass: "text-amber-800",
      detail: `${summary.warnings.length} readiness warning${summary.warnings.length === 1 ? "" : "s"} · ${summary.pendingReview} pending review`,
    };
  }

  return {
    label: "Ready",
    textClass: "text-green-700",
    detail: "No readiness warnings",
  };
}
