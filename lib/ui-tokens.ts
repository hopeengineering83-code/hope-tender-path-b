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

/**
 * Compact badge variant — no border, slightly stronger background tint.
 *
 * Why this exists: several panels historically used a 2-class local map like
 * `{ HIGH: "bg-red-100 text-red-700", MEDIUM: "bg-amber-100 text-amber-700",
 *    LOW: "bg-slate-100 text-slate-600" }` — different from the canonical
 * 3-class `severityBadgeClasses()` (which adds `border-*-200` and uses the
 * lighter `bg-*-50` tint).
 *
 * Replacing those local maps wholesale with `severityBadgeClasses()` would
 * change the visible appearance of every badge in those panels (border added,
 * background shade lightened). This variant produces the SAME visual output
 * as those legacy local maps, so panels can migrate to the canonical helper
 * without visual regression — and the canonical 8-state model (good/warning/
 * poor/muted/stale/partial/running) is the single source of truth for which
 * color maps to which severity.
 *
 * Use `severityBadgeClasses()` (border + lighter bg) for new panels with
 * white-on-card layouts. Use `severityBadgeClassesCompact()` (no border,
 * stronger bg) when migrating the legacy 2-class local maps.
 */
export function severityBadgeClassesCompact(s: UISeverity): string {
  // Stronger bg tint (bg-*-100 vs canonical bg-*-50) + no border class
  // — matches the legacy local SEVERITY_BADGE maps in bid-strategy-panel,
  // evaluator-objections-panel, and tender-ai-copilot-panel exactly.
  if (s === "good") return "bg-emerald-100 text-emerald-700";
  if (s === "warning") return "bg-amber-100 text-amber-700";
  if (s === "poor") return "bg-red-100 text-red-700";
  if (s === "stale") return "bg-violet-100 text-violet-700";
  if (s === "partial") return "bg-orange-100 text-orange-700";
  if (s === "running") return "bg-blue-100 text-blue-700";
  return "bg-slate-100 text-slate-600"; // muted
}

/**
 * Map HIGH / MEDIUM / LOW severity strings to the canonical UISeverity.
 *
 * Several panels used local Record<HIGH|MEDIUM|LOW, string> maps that
 * duplicated this exact mapping. Centralizing it here means a single edit
 * changes the mapping everywhere — and lets panels use
 * `severityBadgeClassesCompact(severityToUISeverity(...))` instead of a
 * local SEVERITY_BADGE constant.
 *
 * "CRITICAL" is treated as "poor" (same red treatment as HIGH) so panels
 * that surface CRITICAL alongside HIGH render them consistently.
 */
export function severityToUISeverity(severity: string): UISeverity {
  const s = (severity ?? "").toUpperCase();
  if (s === "HIGH" || s === "CRITICAL") return "poor";
  if (s === "MEDIUM") return "warning";
  if (s === "LOW") return "muted";
  // Fall back to statusToSeverity for any other token (PASS/FAIL/READY/etc.)
  return statusToSeverity(s);
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
