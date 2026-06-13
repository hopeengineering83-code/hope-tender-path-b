// Shared visual tokens. Canonical workflow states keep their operational meaning;
// numeric scores remain secondary presentation metrics.

export type UISeverity = "good" | "warning" | "poor" | "muted" | "stale" | "partial" | "running";

export function severityBorderClass(s: UISeverity): string {
  if (s === "good") return "border-emerald-200";
  if (s === "warning") return "border-amber-200";
  if (s === "poor") return "border-red-200";
  if (s === "stale") return "border-violet-200";
  if (s === "partial") return "border-orange-200";
  if (s === "running") return "border-blue-200";
  return "border-slate-200";
}

export function severityBgClass(s: UISeverity): string {
  if (s === "good") return "bg-emerald-50";
  if (s === "warning") return "bg-amber-50";
  if (s === "poor") return "bg-red-50";
  if (s === "stale") return "bg-violet-50";
  if (s === "partial") return "bg-orange-50";
  if (s === "running") return "bg-blue-50";
  return "bg-slate-50";
}

export function severityTextClass(s: UISeverity): string {
  if (s === "good") return "text-emerald-700";
  if (s === "warning") return "text-amber-700";
  if (s === "poor") return "text-red-700";
  if (s === "stale") return "text-violet-700";
  if (s === "partial") return "text-orange-700";
  if (s === "running") return "text-blue-700";
  return "text-slate-500";
}

export function severityBadgeClasses(s: UISeverity): string {
  return `${severityBorderClass(s)} ${severityBgClass(s)} ${severityTextClass(s)}`;
}

/** Numeric score styling only. Never use this to enable generation or export. */
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

/** Visual adapter for existing status labels without collapsing canonical states. */
export function statusToSeverity(status: string): UISeverity {
  const s = (status ?? "").toUpperCase();
  if (["GOOD", "PASS", "PASSED", "READY", "FULL_EXTRACTION_AI_ANALYZED", "AI_ANALYZED", "AI"].includes(s)) return "good";
  if (["RUNNING", "PROCESSING", "GENERATING"].includes(s)) return "running";
  if (["STALE", "SUPERSEDED"].includes(s)) return "stale";
  if (["PARTIAL", "PARTIAL_EXTRACTION_AI_ANALYZED", "PARTIAL_SUCCESS", "HUMAN_APPROVED_REGEX_FALLBACK"].includes(s)) return "partial";
  if (["WARNING", "WARN", "MEDIUM", "ACCEPTABLE"].includes(s)) return "warning";
  if ([
    "POOR", "FAIL", "FAILED", "BLOCKED", "CORRUPTED", "UNSAFE", "HIGH", "OCR_REQUIRED",
    "EXTRACTION_WEAK_REVIEW_REQUIRED", "REGEX_FALLBACK_FROM_WEAK_EXTRACTION",
    "EXTRACTION_CORRUPTED_AI_SKIPPED", "REGEX_FALLBACK_AI_ERROR",
  ].includes(s)) return "poor";
  return "muted";
}

/** Source confidence styling only; it is not a canonical readiness decision. */
export function confidenceToSeverity(confidence: number | null | undefined): UISeverity {
  if (confidence === null || confidence === undefined) return "muted";
  if (confidence >= 0.7) return "good";
  if (confidence >= 0.4) return "warning";
  return "poor";
}
