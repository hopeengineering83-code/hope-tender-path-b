"use client";

// "Reconcile N stale files" button for the Submission Plan Reconciliation
// panel. POSTs /api/tenders/[id]/reconcile-docs (built in PR #371) and
// surfaces the per-action counts.
//
// Wires up the previously-built reconciler API to the UI — without this,
// users could see "4 generated file(s) are outside the tender submission
// plan" but had no one-click way to fix it.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { emitTenderWorkflowSync } from "../lib/ui/tender-workflow-sync";

type ReconcileSummary = {
  kept: number;
  relinked: number;
  superseded: number;
  needsRevalidation: number;
};

type ReconcileResponse = {
  success?: boolean;
  tenderId?: string;
  plannedFileCount?: number;
  activeDocCount?: number;
  summary?: ReconcileSummary;
  decisions?: Array<{
    documentId: string;
    documentName: string;
    action: "KEEP_AS_PLANNED" | "RELINK_TO_PLAN" | "MARK_SUPERSEDED" | "MARK_NEEDS_REVALIDATION";
    matchedPlanFileName: string | null;
    rationale: string;
  }>;
  // error path
  code?: string;
  message?: string;
  nextAction?: string;
};

export function ReconcileStaleFilesButton({ tenderId, staleCount }: { tenderId: string; staleCount: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [kind, setKind] = useState<"success" | "error" | "info">("info");

  async function runReconcile() {
    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/reconcile-docs`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as ReconcileResponse;
      if (!res.ok || !data.success) {
        setKind("error");
        setMessage(data.message ?? data.code ?? `Reconcile failed (HTTP ${res.status}).`);
        return;
      }
      const s = data.summary ?? { kept: 0, relinked: 0, superseded: 0, needsRevalidation: 0 };
      const summary = `Reconciled: ${s.kept} kept · ${s.relinked} relinked · ${s.superseded} superseded · ${s.needsRevalidation} flagged for revalidation.`;
      setKind("success");
      setMessage(summary);
      // The Build Plan panel that hosts this button holds its own fetched
      // outside-plan count; router.refresh() does not re-run that client
      // fetch, so without this the reconciled rows would still be counted.
      emitTenderWorkflowSync({ tenderId, source: "stale-plan-files-reconciled" });
      startTransition(() => router.refresh());
    } catch (error) {
      setKind("error");
      setMessage(error instanceof Error ? `Reconcile failed: ${error.message}` : "Reconcile failed due to a network/runtime error.");
    } finally {
      setRunning(false);
    }
  }

  if (staleCount <= 0) return null;

  return (
    <div className="mt-3 flex flex-col gap-2">
      <button
        onClick={runReconcile}
        disabled={running || isPending}
        title="Match each stale file against the current plan. Files with no plan target get marked SUPERSEDED; semantic/normalised matches get relinked and flagged for revalidation."
        className="self-start rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {running || isPending ? "Reconciling…" : `Reconcile ${staleCount} stale file${staleCount === 1 ? "" : "s"}`}
      </button>
      {message && (
        <div className={`rounded-lg border px-3 py-2 text-xs ${kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : kind === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
          {message}
        </div>
      )}
    </div>
  );
}
