export const TENDER_STATUSES = [
  "DRAFT",
  "INTAKE",
  "ANALYZED",
  // Analysis-source-aware statuses set by the AI Analyze route.
  // AI_ANALYZED:            Full AI analysis succeeded (all chunks).
  // AI_ANALYSIS_PARTIAL:    Some AI chunks succeeded; deadline reached before all chunks completed.
  // FALLBACK_DRAFT_CREATED: AI was attempted but failed; regex fallback used (no AI chunks succeeded but AI was configured).
  // ANALYSIS_REQUIRES_REVIEW: No AI available or AI entirely failed; regex fallback used; human review recommended.
  "AI_ANALYZED",
  "AI_ANALYSIS_PARTIAL",
  "FALLBACK_DRAFT_CREATED",
  "ANALYSIS_REQUIRES_REVIEW",
  "MATCHED",
  "COMPLIANCE_REVIEW",
  "READY_FOR_GENERATION",
  "GENERATED",
  "IN_REVIEW",
  "APPROVED",
  "EXPORTED",
  "CLOSED",
  // Terminal side-branch set by the bid-decision route (not part of the
  // linear DRAFT→...→CLOSED progression, so it has no NEXT_STATUS entry).
  "NO_BID",
] as const;

export type TenderStatusValue = (typeof TENDER_STATUSES)[number];

export const TENDER_STATUS_LABELS: Record<TenderStatusValue, string> = {
  DRAFT: "Draft",
  INTAKE: "Intake",
  ANALYZED: "Analyzed",
  AI_ANALYZED: "AI Analyzed",
  AI_ANALYSIS_PARTIAL: "AI Analysis (Partial)",
  FALLBACK_DRAFT_CREATED: "Fallback Draft Created",
  ANALYSIS_REQUIRES_REVIEW: "Analysis Requires Review",
  MATCHED: "Matched",
  COMPLIANCE_REVIEW: "Compliance Review",
  READY_FOR_GENERATION: "Ready for Generation",
  GENERATED: "Generated",
  IN_REVIEW: "In Review",
  APPROVED: "Approved",
  EXPORTED: "Exported",
  CLOSED: "Closed",
  NO_BID: "No Bid",
};

export const NEXT_STATUS: Partial<Record<TenderStatusValue, TenderStatusValue>> = {
  DRAFT: "INTAKE",
  INTAKE: "ANALYZED",
  ANALYZED: "MATCHED",
  AI_ANALYZED: "MATCHED",
  AI_ANALYSIS_PARTIAL: "MATCHED",
  // Fallback states can advance to MATCHED after human review or re-analyze.
  // Without these entries, tenders stuck in fallback states have no forward
  // transition in the UI and the "Move to next stage" button is hidden.
  FALLBACK_DRAFT_CREATED: "MATCHED",
  ANALYSIS_REQUIRES_REVIEW: "MATCHED",
  MATCHED: "COMPLIANCE_REVIEW",
  COMPLIANCE_REVIEW: "READY_FOR_GENERATION",
  READY_FOR_GENERATION: "GENERATED",
  GENERATED: "IN_REVIEW",
  IN_REVIEW: "APPROVED",
  APPROVED: "EXPORTED",
  EXPORTED: "CLOSED",
};

export function formatTenderStatus(status: string) {
  return TENDER_STATUS_LABELS[status as TenderStatusValue] ?? status.replaceAll("_", " ");
}

export function parseTenderStatus(value: string | null | undefined): TenderStatusValue | undefined {
  if (!value) return undefined;
  const normalized = value.toUpperCase() as TenderStatusValue;
  return TENDER_STATUSES.includes(normalized) ? normalized : undefined;
}

export function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
