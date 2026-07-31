// Shared presentation helpers for the canonical Tender Release State
// (readiness score + bid verdict). Used by the authoritative top status
// card (components/next-action-panel.tsx) so the release-state score is
// always colored/labeled through the one canonical mapping below.

import { scoreToSeverity, type UISeverity } from "../ui-tokens";

export type TenderReleaseVerdict = "BID" | "BID_WITH_CONDITIONS" | "NO_BID" | null;

// Release-state readiness uses tighter thresholds (80/50) than the canonical
// ui-tokens defaults (75/45) because a release-ready score must clear a higher
// bar than general UI severity. The threshold DECISION still flows through the
// canonical `scoreToSeverity()` helper so the 8-state UISeverity model is the
// single source of truth — only the cutoffs are tuned here.
const RELEASE_SCORE_THRESHOLDS = { good: 80, warn: 50 };

const TONE_BY_SEVERITY: Record<UISeverity, { text: string; bg: string; bar: string }> = {
  good:    { text: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", bar: "bg-emerald-500" },
  warning: { text: "text-amber-800",   bg: "bg-amber-50 border-amber-200",   bar: "bg-amber-400"   },
  poor:    { text: "text-red-700",     bg: "bg-red-50 border-red-200",       bar: "bg-red-500"     },
  // Unused by scoreTone() but required by the Record type — the canonical
  // 8-state model has these for other surfaces (stale/partial/running/muted).
  stale:    { text: "text-violet-700", bg: "bg-violet-50 border-violet-200", bar: "bg-violet-500" },
  partial:  { text: "text-orange-700", bg: "bg-orange-50 border-orange-200", bar: "bg-orange-500" },
  running:  { text: "text-blue-700",   bg: "bg-blue-50 border-blue-200",   bar: "bg-blue-500"   },
  muted:    { text: "text-slate-700",  bg: "bg-slate-50 border-slate-200",  bar: "bg-slate-500"  },
};

export function scoreTone(score: number): { text: string; bg: string; bar: string } {
  return TONE_BY_SEVERITY[scoreToSeverity(score, RELEASE_SCORE_THRESHOLDS)];
}

export function verdictLabel(verdict: TenderReleaseVerdict): { label: string; tone: string } {
  if (verdict === "BID") return { label: "BID", tone: "bg-emerald-100 text-emerald-700" };
  if (verdict === "BID_WITH_CONDITIONS") return { label: "BID WITH CONDITIONS", tone: "bg-amber-100 text-amber-800" };
  if (verdict === "NO_BID") return { label: "NO BID", tone: "bg-red-100 text-red-700" };
  return { label: "Decision unavailable", tone: "bg-slate-100 text-slate-500" };
}
