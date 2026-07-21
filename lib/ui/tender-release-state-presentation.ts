// Shared presentation helpers for the canonical Tender Release State
// (readiness score + bid verdict). Used by both the collapsed diagnostic
// panel (components/tender-release-state-panel.tsx) and the authoritative
// top status card (components/next-action-panel.tsx) so the two surfaces
// can never render different colors/labels for the same canonical value.

export type TenderReleaseVerdict = "BID" | "BID_WITH_CONDITIONS" | "NO_BID" | null;

export function scoreTone(score: number): { text: string; bg: string; bar: string } {
  if (score >= 80) return { text: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", bar: "bg-emerald-500" };
  if (score >= 50) return { text: "text-amber-700", bg: "bg-amber-50 border-amber-200", bar: "bg-amber-400" };
  return { text: "text-red-700", bg: "bg-red-50 border-red-200", bar: "bg-red-500" };
}

export function verdictLabel(verdict: TenderReleaseVerdict): { label: string; tone: string } {
  if (verdict === "BID") return { label: "BID", tone: "bg-emerald-100 text-emerald-700" };
  if (verdict === "BID_WITH_CONDITIONS") return { label: "BID WITH CONDITIONS", tone: "bg-amber-100 text-amber-700" };
  if (verdict === "NO_BID") return { label: "NO BID", tone: "bg-red-100 text-red-700" };
  return { label: "Decision unavailable", tone: "bg-slate-100 text-slate-500" };
}
