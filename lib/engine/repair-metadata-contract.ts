// Versioned-safe repair response contract.
//
// The API returns a stable ordered outcome array plus a byField lookup map.
// The client validates HTTP status and response shape before reading outcomes.
// Never call .filter, .map, or .length on an unvalidated unknown response value.

export type RepairOutcomeStatus = "REPAIRED" | "NOT_FOUND" | "SKIPPED" | "REJECTED" | "ERROR";

export interface RepairOutcome {
  field: string;
  status: RepairOutcomeStatus;
  reason?: string;
  sourceFile?: string | null;
  sourcePage?: number | null;
  sourceQuote?: string | null;
  confidence?: string | null;
  value?: unknown;
}

export interface RepairMetadataResponse {
  success: boolean;
  outcomes: RepairOutcome[];
  outcomesByField: Record<string, RepairOutcome>;
  /** @deprecated Use outcomes[] instead. Kept for backward compatibility. */
  results?: Record<string, unknown>;
}

export function parseRepairMetadataResponse(raw: unknown): RepairMetadataResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.outcomes)) {
    const outcomes: RepairOutcome[] = obj.outcomes
      .filter((o): o is Record<string, unknown> => o !== null && typeof o === "object")
      .map((o) => ({
        field: typeof o.field === "string" ? o.field : "unknown",
        status: ((typeof o.status === "string" && ["REPAIRED", "NOT_FOUND", "SKIPPED", "REJECTED", "ERROR"].includes(o.status)) ? o.status : "ERROR") as RepairOutcomeStatus,
        reason: typeof o.reason === "string" ? o.reason : undefined,
        sourceFile: typeof o.sourceFile === "string" ? o.sourceFile : null,
        sourcePage: typeof o.sourcePage === "number" ? o.sourcePage : null,
        sourceQuote: typeof o.sourceQuote === "string" ? o.sourceQuote : null,
        confidence: typeof o.confidence === "string" ? o.confidence : null,
        value: o.value,
      }));
    const outcomesByField: Record<string, RepairOutcome> = {};
    for (const o of outcomes) { outcomesByField[o.field] = o; }
    return { success: typeof obj.success === "boolean" ? obj.success : outcomes.some((o) => o.status === "REPAIRED"), outcomes, outcomesByField };
  }
  if (obj.results && typeof obj.results === "object" && !Array.isArray(obj.results)) {
    const resultsObj = obj.results as Record<string, unknown>;
    const outcomes: RepairOutcome[] = Object.entries(resultsObj).map(([field, val]) => {
      if (!val || typeof val !== "object") return { field, status: "ERROR" as const, reason: "Malformed result entry" };
      const r = val as Record<string, unknown>;
      return { field, status: ((typeof r.status === "string" && ["REPAIRED", "NOT_FOUND", "SKIPPED", "REJECTED", "ERROR"].includes(r.status)) ? r.status : "ERROR") as RepairOutcomeStatus, reason: typeof r.reason === "string" ? r.reason : undefined, sourceFile: typeof r.sourceFile === "string" ? r.sourceFile : null, sourceQuote: typeof r.sourceQuote === "string" ? r.sourceQuote : null, confidence: typeof r.confidence === "string" ? r.confidence : null, value: r.value };
    });
    const outcomesByField: Record<string, RepairOutcome> = {};
    for (const o of outcomes) { outcomesByField[o.field] = o; }
    return { success: typeof obj.success === "boolean" ? obj.success : outcomes.some((o) => o.status === "REPAIRED"), outcomes, outcomesByField };
  }
  return null;
}

export function countOutcomesByStatus(outcomes: RepairOutcome[]): Record<RepairOutcomeStatus, number> {
  const counts: Record<RepairOutcomeStatus, number> = { REPAIRED: 0, NOT_FOUND: 0, SKIPPED: 0, REJECTED: 0, ERROR: 0 };
  for (const o of outcomes) { if (o.status in counts) { counts[o.status]++; } else { counts.ERROR++; } }
  return counts;
}

export function buildRepairMessage(outcomes: RepairOutcome[]): { message: string; kind: "success" | "info" | "error" } {
  const counts = countOutcomesByStatus(outcomes);
  if (counts.ERROR > 0) return { message: `Repair completed with ${counts.ERROR} error(s). ${counts.REPAIRED} repaired, ${counts.NOT_FOUND} not found, ${counts.SKIPPED} skipped, ${counts.REJECTED} rejected.`, kind: "error" };
  if (counts.REPAIRED > 0) {
    const unresolved = counts.NOT_FOUND + counts.REJECTED;
    if (unresolved > 0) return { message: `Repaired ${counts.REPAIRED} field(s). ${counts.NOT_FOUND} not found, ${counts.REJECTED} rejected, ${counts.SKIPPED} skipped. ${unresolved} field(s) remain unresolved — review and correct manually.`, kind: "info" };
    return { message: `Repaired ${counts.REPAIRED} field(s). ${counts.NOT_FOUND} not found, ${counts.SKIPPED} skipped.`, kind: "success" };
  }
  if (counts.NOT_FOUND > 0) return { message: `${counts.NOT_FOUND} field(s) not found in source. ${counts.SKIPPED} skipped, ${counts.REJECTED} rejected.`, kind: "info" };
  if (counts.REJECTED > 0) return { message: `${counts.REJECTED} field(s) rejected (placeholder values). ${counts.SKIPPED} skipped.`, kind: "info" };
  return { message: `All fields skipped (${counts.SKIPPED} already have values).`, kind: "info" };
}
