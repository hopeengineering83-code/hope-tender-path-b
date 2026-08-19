"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { subscribeTenderWorkflowSync } from "@/lib/ui/tender-workflow-sync";
import { severityBadgeClassesCompact, severityToUISeverity } from "../lib/ui-tokens";

type Objection = {
  id: string;
  proposalVersion: number;
  severity: "HIGH" | "MEDIUM" | "LOW" | string;
  category: string;
  title: string;
  description: string;
  sectionRef?: string | null;
  recommendedAction?: string | null;
  status: "OPEN" | "RESOLVED" | "WAIVED" | string;
  resolutionNote?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
};

type Summary = {
  total: number;
  open: number;
  openHigh: number;
  resolved: number;
  waived: number;
  exportBlockedByHighObjections: boolean;
};

// SEVERITY_BADGE migrated to lib/ui-tokens.ts::severityBadgeClassesCompact(severityToUISeverity(...)).
// Single source of truth for severity color mapping across all panels.
// Unknown severity strings fall back to LOW/muted via severityToUISeverity.

const STATUS_BADGE: Record<string, string> = {
  OPEN: "bg-red-100 text-red-700",
  RESOLVED: "bg-emerald-100 text-emerald-700",
  WAIVED: "bg-blue-100 text-blue-700",
};

export function EvaluatorObjectionsPanel({ tenderId, canMutate = false }: { tenderId: string; canMutate?: boolean }) {
  const router = useRouter();
  const [objections, setObjections] = useState<Objection[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/evaluator-objections`, { method: "GET" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Failed to load objections (${res.status})`);
      setObjections(data.objections ?? []);
      setSummary(data.summary ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load evaluator objections");
    } finally {
      setLoading(false);
    }
  }, [tenderId]);

  // Auto-load on mount + auto-refresh on workflow sync — no manual button needed.
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => subscribeTenderWorkflowSync(tenderId, () => { void refresh(); }), [refresh, tenderId]);

  async function updateObjection(objectionId: string, status: "RESOLVED" | "WAIVED") {
    const resolutionNote = (notes[objectionId] ?? "").trim();
    if (resolutionNote.length < 8) {
      setError("Resolution / waiver note must be at least 8 characters.");
      return;
    }

    setSavingId(objectionId);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/evaluator-objections`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectionId, status, resolutionNote }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Failed to update objection (${res.status})`);
      await refresh();
      setNotes((current) => ({ ...current, [objectionId]: "" }));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update evaluator objection");
    } finally {
      setSavingId(null);
    }
  }

  const hasLoaded = summary !== null;

  return (
    <div id="evaluator-objections" className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Evaluator Objections</h3>
          <p className="mt-0.5 text-xs text-slate-500">Resolve or waive evaluator findings. OPEN HIGH objections block final export.</p>
        </div>
        <div className="flex items-center gap-2">
          {summary && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${summary.exportBlockedByHighObjections ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
              {summary.exportBlockedByHighObjections ? `${summary.openHigh} high blocker(s)` : "No high blockers"}
            </span>
          )}
          {/* Auto-loads on mount + workflow sync — no manual Refresh button. */}
        </div>
      </div>

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      {summary && (
        <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-5">
          <div className="rounded-lg bg-slate-50 px-2 py-2"><p className="font-bold text-slate-900">{summary.total}</p><p className="text-slate-500">Total</p></div>
          <div className="rounded-lg bg-red-50 px-2 py-2"><p className="font-bold text-red-700">{summary.open}</p><p className="text-red-600">Open</p></div>
          <div className="rounded-lg bg-red-50 px-2 py-2"><p className="font-bold text-red-700">{summary.openHigh}</p><p className="text-red-600">High open</p></div>
          <div className="rounded-lg bg-emerald-50 px-2 py-2"><p className="font-bold text-emerald-700">{summary.resolved}</p><p className="text-emerald-600">Resolved</p></div>
          <div className="rounded-lg bg-blue-50 px-2 py-2"><p className="font-bold text-blue-700">{summary.waived}</p><p className="text-blue-600">Waived</p></div>
        </div>
      )}

      {hasLoaded && objections.length === 0 && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">No evaluator objections recorded yet. Run the evidence-aware evaluator committee to generate findings.</div>
      )}

      {objections.length > 0 && (
        <ul className="mt-4 space-y-3">
          {objections.map((objection) => {
            const isOpen = objection.status === "OPEN";
            return (
              <li key={objection.id} className="rounded-xl border border-slate-100 bg-white p-3 text-xs">
                <div className="flex flex-wrap items-start gap-2">
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${severityBadgeClassesCompact(severityToUISeverity(objection.severity))}`}>{objection.severity}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[objection.status] ?? STATUS_BADGE.OPEN}`}>{objection.status}</span>
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{objection.category}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900">{objection.title}</p>
                    {objection.sectionRef && <p className="mt-0.5 text-slate-500">Section: {objection.sectionRef}</p>}
                    <p className="mt-1 text-slate-700">{objection.description}</p>
                    {objection.recommendedAction && <p className="mt-1 text-emerald-700">Recommended action: {objection.recommendedAction}</p>}
                    {!isOpen && objection.resolutionNote && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-slate-600">Closure note: {objection.resolutionNote}</p>}
                  </div>
                </div>

                {isOpen && canMutate && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <textarea
                      value={notes[objection.id] ?? ""}
                      onChange={(e) => setNotes((current) => ({ ...current, [objection.id]: e.target.value }))}
                      rows={2}
                      placeholder="Required note: describe fix evidence or waiver justification"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-slate-400"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" disabled={savingId === objection.id} onClick={() => void updateObjection(objection.id, "RESOLVED")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
                        Mark resolved
                      </button>
                      <button type="button" disabled={savingId === objection.id} onClick={() => void updateObjection(objection.id, "WAIVED")} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60">
                        Waive with justification
                      </button>
                    </div>
                  </div>
                )}
                {isOpen && !canMutate && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <p className="text-[10px] text-slate-500">Read-only: resolving or waiving objections requires ADMIN or PROPOSAL_MANAGER role.</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
