"use client";

import React, { useEffect, useState, useCallback } from "react";
import { clientLogger } from "@/lib/ui/client-logger";
import { SnapshotConsistencyBadge } from "./snapshot-consistency-badge";


export interface WorkflowStageInfo {
  stage: number;
  label: string;
  status: "PENDING" | "IN_PROGRESS" | "READY" | "BLOCKED" | "WARNING" | "COMPLETE" | "BLOCKED_BY_PRIOR_STEP" | "WAITING_ON_PRIOR_STEP";
  explanation: string;
  blocker?: string;
  actionLabel?: string;
  actionUrl?: string;
  actionMethod?: string;
  /** Server-provided action name (recovery-command action key). */
  actionName?: string;
  /** Server-provided classification: "mutation" or "readonly". The UI uses
   * this to HIDE mutation controls for REVIEWER — no client-side inference. */
  actionKind?: "mutation" | "readonly";
}

export function TenderWorkflowActionCenter({ tenderId, canMutate = false }: { tenderId: string; canMutate?: boolean }) {
  const [stages, setStages] = useState<WorkflowStageInfo[] | null>(null);

  const fetchStages = useCallback(() => {
    fetch(`/api/tenders/${tenderId}/workflow-center`)
      .then(res => res.json())
      .then(json => setStages(json.stages))
      .catch((e: unknown) => clientLogger.error("fetch failed", e instanceof Error ? { message: e.message } : { error: String(e) }));
  }, [tenderId]);

  useEffect(() => {
    fetchStages();
    const interval = setInterval(fetchStages, 10000);
    return () => clearInterval(interval);
  }, [fetchStages]);

  if (!stages) return <div className="animate-pulse h-64 bg-slate-50 rounded-2xl border mb-6" />;

  const handleAction = async (s: WorkflowStageInfo) => {
      if (s.actionUrl) {
          await fetch(s.actionUrl, { method: s.actionMethod || "POST" });
          fetchStages();
      } else {
          const targets: Record<number, string> = {
              1: "#tender-files",
              3: "#ai-analyze-section",
              5: "#tender-edit-form",
              8: "#generated-documents",
              10: "#export-readiness"
          };
          const target = targets[s.stage];
          if (target) {
              const el = document.querySelector(target);
              if (el) el.scrollIntoView({ behavior: 'smooth' });
          }
      }
  };

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="text-lg font-bold text-slate-900">Workflow Control Center</h2>
        <button onClick={fetchStages} className="shrink-0 text-[10px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest">Refresh State</button>
      </div>
      {/* Per-stage statuses here come from getCanonicalTenderWorkflowDecision,
          a separate computation from the release snapshot other readiness
          panels compare against (both are returned by this same route but
          are independently derived) — this additive badge makes any
          disagreement between the Export ZIP stage and the authoritative
          snapshot visible instead of leaving it silent. */}
      <SnapshotConsistencyBadge
        tenderId={tenderId}
        verdict="finalZip"
        localEligible={stages.find((s) => s.stage === 10)?.status === "READY"}
        localLabel="Workflow Control Center"
      />
      <div className="mt-3 grid gap-3">
        {stages.map((s) => (
          <div key={s.stage} className="flex items-start gap-4 p-3 rounded-xl border border-slate-50 hover:bg-slate-50 transition-colors">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
              {s.stage}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h3 className="min-w-0 break-words font-semibold text-slate-900">{s.label}</h3>
                <StatusBadge status={s.status} />
              </div>
              <p className="mt-0.5 text-sm text-slate-600">{s.explanation}</p>
              {s.blocker && (
                <p className="mt-1 text-xs font-medium text-red-600">
                  Blocker: {s.blocker}
                </p>
              )}
            </div>
            {s.actionLabel && (canMutate || s.actionKind === "readonly" || (!s.actionKind && !s.actionUrl)) && (
              <div className="shrink-0 self-center">
                <button
                  onClick={() => handleAction(s)}
                  disabled={s.status === "BLOCKED" && s.stage > 3}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-30"
                >
                  {s.actionLabel}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: WorkflowStageInfo["status"] }) {
  switch (status) {
    case "COMPLETE":
      return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white uppercase border border-emerald-600">Complete</span>;
    case "READY":
      return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 uppercase border border-emerald-100">Ready</span>;
    case "IN_PROGRESS":
      return <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 uppercase border border-blue-100">In Progress</span>;
    case "WARNING":
      return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 uppercase border border-amber-100">Attention</span>;
    case "BLOCKED":
      return <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700 uppercase border border-red-100">Blocked</span>;
    case "BLOCKED_BY_PRIOR_STEP":
      return <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-500 uppercase border border-red-100">Blocked by prior step</span>;
    case "WAITING_ON_PRIOR_STEP":
      return <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-500 uppercase border border-slate-100">Waiting</span>;
    default:
      return <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-500 uppercase border border-slate-100">Pending</span>;
  }
}
