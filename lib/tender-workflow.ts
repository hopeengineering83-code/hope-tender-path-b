export const TENDER_STATUSES = [
  "DRAFT",
  "INTAKE",
  "ANALYZED",
  "MATCHED",
  "COMPLIANCE_REVIEW",
  "READY_FOR_GENERATION",
  "GENERATED",
  "IN_REVIEW",
  "APPROVED",
  "EXPORTED",
  "CLOSED",
] as const;

export type TenderStatusValue = (typeof TENDER_STATUSES)[number];

export const TENDER_STATUS_LABELS: Record<TenderStatusValue, string> = {
  DRAFT: "Draft",
  INTAKE: "Intake",
  ANALYZED: "Analyzed",
  MATCHED: "Matched",
  COMPLIANCE_REVIEW: "Compliance Review",
  READY_FOR_GENERATION: "Ready for Generation",
  GENERATED: "Generated",
  IN_REVIEW: "In Review",
  APPROVED: "Approved",
  EXPORTED: "Exported",
  CLOSED: "Closed",
};

export const NEXT_STATUS: Partial<Record<TenderStatusValue, TenderStatusValue>> = {
  DRAFT: "INTAKE",
  INTAKE: "ANALYZED",
  ANALYZED: "MATCHED",
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
