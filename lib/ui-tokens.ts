// Canonical UI token system.
//
// Single source of truth for status → Tailwind class mappings used across all
// panels. Import these helpers instead of hardcoding color strings in components.

export type UISeverity = "good" | "warning" | "poor" | "muted";

/** Return a Tailwind border class for the given severity. */
export function severityBorderClass(s: UISeverity): string {
  if (s === "good")    return "border-emerald-200";
  if (s === "warning") return "border-amber-200";
  if (s === "poor")    return "border-red-200";
  return "border-slate-200";
}

/** Return a Tailwind background class for the given severity. */
export function severityBgClass(s: UISeverity): string {
  if (s === "good")    return "bg-emerald-50";
  if (s === "warning") return "bg-amber-50";
  if (s === "poor")    return "bg-red-50";
  return "bg-slate-50";
}

/** Return a Tailwind text class for the given severity. */
export function severityTextClass(s: UISeverity): string {
  if (s === "good")    return "text-emerald-700";
  if (s === "warning") return "text-amber-700";
  if (s === "poor")    return "text-red-700";
  return "text-slate-500";
}

/** Combined pill classes: border + bg + text (for inline badge spans). */
export function severityBadgeClasses(s: UISeverity): string {
  return `${severityBorderClass(s)} ${severityBgClass(s)} ${severityTextClass(s)}`;
}

/** Map a 0–100 numeric score to a severity. Thresholds are configurable. */
export function scoreToSeverity(
  score: number,
  opts: { good?: number; warn?: number } = {},
): UISeverity {
  const good = opts.good ?? 75;
  const warn = opts.warn ?? 45;
  if (score >= good) return "good";
  if (score >= warn) return "warning";
  return "poor";
}

/** Map a string status label to a severity.  Handles common status codes used
 *  throughout the app.  Extend as new codes are added. */
export function statusToSeverity(status: string): UISeverity {
  const s = (status ?? "").toUpperCase();
  if (
    s === "GOOD" || s === "PASS" || s === "PASSED" || s === "READY" ||
    s === "FULL_EXTRACTION_AI_ANALYZED" || s === "AI_ANALYZED" || s === "AI"
  ) return "good";

  if (
    s === "WARNING" || s === "WARN" || s === "PARTIAL" ||
    s === "PARTIAL_EXTRACTION_AI_ANALYZED" || s === "OCR_REQUIRED" ||
    s === "HUMAN_APPROVED_REGEX_FALLBACK" || s === "MEDIUM" ||
    s === "STALE" || s === "RUNNING" || s === "ACCEPTABLE"
  ) return "warning";

  if (
    s === "POOR" || s === "FAIL" || s === "FAILED" || s === "BLOCKED" ||
    s === "CORRUPTED" || s === "UNSAFE" || s === "HIGH" ||
    s === "EXTRACTION_WEAK_REVIEW_REQUIRED" ||
    s === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION" ||
    s === "EXTRACTION_CORRUPTED_AI_SKIPPED" ||
    s === "REGEX_FALLBACK_AI_ERROR"
  ) return "poor";

  return "muted";
}

/** Map a 0–1 source confidence float to a severity for requirement badges. */
export function confidenceToSeverity(confidence: number | null | undefined): UISeverity {
  if (confidence === null || confidence === undefined) return "muted";
  if (confidence >= 0.7) return "good";
  if (confidence >= 0.4) return "warning";
  return "poor";
}
