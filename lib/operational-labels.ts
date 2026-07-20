const OPERATIONAL_LABELS: Record<string, string> = {
  GO: "Ready to proceed",
  REVIEW: "Needs review",
  NO_GO: "Do not bid",
  NO_BID: "No bid",
  TENDER_INTAKE: "Tender intake",
  ANALYSIS_COMPLETE: "Analysis complete",
  PLAN_CONFIRMED: "Plan confirmed",
  DOCUMENTS_GENERATED: "Documents generated",
  EXPORT_READY: "Export ready",
  READY_FOR_EXPORT: "Ready for export",
  NO_ACTIVE_GENERATED_DOCUMENTS: "No generated documents are ready",
  AI_ANALYZE: "AI analysis",
  EXTRACT_TEXT: "Text extraction",
  SUCCEEDED: "Completed",
  DONE: "Completed",
  FAILED: "Failed",
  QUEUED: "Queued",
  RUNNING: "In progress",
  OPEN: "Open",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
  PENDING: "Pending",
  PLANNED: "Planned",
  GENERATED: "Generated",
  VALIDATED: "Validated",
  PASSED: "Passed",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SUPERSEDED: "Superseded",
  NOT_RUN: "Not run",
  BLOCKED: "Blocked",
  STALE: "Out of date",
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

function normalizeCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function sentenceCase(value: string): string {
  const words = value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "—";
}

/**
 * Presentation-only formatter for persisted workflow, readiness, job, and
 * decision codes. It never changes the stored value or any gate comparison.
 */
export function formatOperationalCode(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return "—";
  return OPERATIONAL_LABELS[normalizeCode(text)] ?? sentenceCase(text);
}

/**
 * Remove a machine-code prefix from a human-readable blocker reason.
 * Example:
 *   NO_ACTIVE_GENERATED_DOCUMENTS: final export requires ...
 * becomes:
 *   Final export requires ...
 */
export function formatOperationalReason(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return "Details are unavailable.";

  const prefixed = text.match(/^([A-Z][A-Z0-9_]{2,})\s*:\s*(.+)$/s);
  if (prefixed) {
    const detail = prefixed[2].trim();
    return detail ? sentenceCase(detail) : formatOperationalCode(prefixed[1]);
  }

  if (/^[A-Z][A-Z0-9_]{2,}$/.test(text)) {
    return formatOperationalCode(text);
  }

  return text;
}

export function formatDocumentReadinessFailure(
  fileName: string | null | undefined,
  reasons: readonly string[],
): string {
  const normalizedName = normalizeCode(fileName ?? "");
  const visibleReasons = reasons
    .map((reason) => formatOperationalReason(reason))
    .filter(Boolean);

  const uniqueReasons = [...new Set(visibleReasons)];
  const friendlyName = formatOperationalCode(fileName);
  const nameIsMachineReason = Boolean(normalizedName && OPERATIONAL_LABELS[normalizedName]);

  if (nameIsMachineReason && uniqueReasons.length > 0) {
    return uniqueReasons.join("; ");
  }
  if (uniqueReasons.length === 0) return friendlyName;
  return `${friendlyName} — ${uniqueReasons.join("; ")}`;
}
