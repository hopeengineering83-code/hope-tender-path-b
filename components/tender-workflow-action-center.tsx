"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { clientLogger } from "@/lib/ui/client-logger";
import { getRecoveryCommandActionSpec, renderRecoveryActionPath } from "@/lib/recovery-command-actions";


export interface WorkflowStageInfo {
  stage: number;
  label: string;
  status: "PENDING" | "IN_PROGRESS" | "READY" | "BLOCKED" | "WARNING" | "COMPLETE" | "BLOCKED_BY_PRIOR_STEP" | "WAITING_ON_PRIOR_STEP";
  explanation: string;
  blocker?: string;
  actionLabel?: string;
  /** Server-provided action name (recovery-command action key). */
  actionName?: string;
  /** Server-provided classification: "mutation" or "readonly". The UI uses
   * this to HIDE mutation controls for REVIEWER — no client-side inference. */
  actionKind?: "mutation" | "readonly";
}

export function TenderWorkflowActionCenter({ tenderId, canMutate = false }: { tenderId: string; canMutate?: boolean }) {
  const router = useRouter();
  const [stages, setStages] = useState<WorkflowStageInfo[] | null>(null);
  const [busyStage, setBusyStage] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const fetchStages = useCallback(async () => {
    try {
      const res = await fetch(`/api/tenders/${tenderId}/workflow-center`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(json.stages)) throw new Error(json.error ?? "Workflow state is unavailable.");
      setStages(json.stages);
    } catch (e: unknown) {
      clientLogger.error("workflow-center fetch failed", e instanceof Error ? { message: e.message } : { error: String(e) });
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "Workflow state is unavailable." });
    }
  }, [tenderId]);

  useEffect(() => {
    fetchStages();
    const interval = setInterval(fetchStages, 10000);
    return () => clearInterval(interval);
  }, [fetchStages]);

  if (!stages) return <div className="animate-pulse h-64 bg-slate-50 rounded-2xl border mb-6" />;

  const handleAction = async (s: WorkflowStageInfo) => {
    if (!s.actionName) return;
    const spec = getRecoveryCommandActionSpec(s.actionName);
    if (!spec) {
      setMessage({ kind: "error", text: `“${s.actionLabel ?? s.actionName}” is not connected to a workflow action.` });
      return;
    }
    setBusyStage(s.stage);
    setMessage(null);
    try {
      if (spec.kind === "scroll" && spec.anchorId) {
        const element = document.getElementById(spec.anchorId);
        if (!element) throw new Error(`The ${spec.label} panel is unavailable on this page.`);
        element.scrollIntoView({ behavior: "smooth", block: "start" });
        setMessage({ kind: "success", text: spec.message ?? `${spec.label} opened.` });
        return;
      }
      if ((spec.kind === "navigate" || spec.kind === "download") && spec.path) {
        window.location.assign(renderRecoveryActionPath(spec.path, tenderId));
        return;
      }
      if (spec.kind === "refresh") {
        await fetchStages();
        router.refresh();
        setMessage({ kind: "success", text: "Workflow state refreshed." });
        return;
      }
      if (spec.kind === "custom") {
        throw new Error(`${spec.label} requires its dedicated review panel.`);
      }
      if (spec.kind === "api" && spec.path) {
        const res = await fetch(renderRecoveryActionPath(spec.path, tenderId), { method: spec.method ?? "POST" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.success === false) {
          throw new Error(json.error ?? json.message ?? `${spec.label} failed.`);
        }
        setMessage({ kind: "success", text: json.message ?? `${spec.label} completed. Workflow state refreshed.` });
        await fetchStages();
        router.refresh();
        return;
      }
      throw new Error(`${spec.label} is not executable from this page.`);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : `${spec.label} failed.` });
    } finally {
      setBusyStage(null);
    }
  };

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="text-lg font-bold text-slate-900">Workflow Control Center</h2>
        <button onClick={fetchStages} className="shrink-0 text-[10px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest">Refresh State</button>
      </div>
      {message && <p role={message.kind === "error" ? "alert" : "status"} className={`mb-4 rounded-lg border px-3 py-2 text-sm ${message.kind === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{message.text}</p>}
      <div className="grid gap-3">
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
            {s.actionLabel && s.actionName && (canMutate || s.actionKind === "readonly") && (
              <div className="shrink-0 self-center">
                <button
                  onClick={() => handleAction(s)}
                  disabled={busyStage !== null || s.status === "BLOCKED_BY_PRIOR_STEP" || s.status === "WAITING_ON_PRIOR_STEP" || (s.actionKind === "mutation" && s.status === "COMPLETE")}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-30"
                >
                  {busyStage === s.stage ? "Working…" : s.actionLabel}
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
    case "READY":
      return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 uppercase border border-emerald-100">Ready</span>;
    case "IN_PROGRESS":
      return <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 uppercase border border-blue-100">In Progress</span>;
    case "WARNING":
      return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 uppercase border border-amber-100">Attention</span>;
    case "BLOCKED":
      return <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700 uppercase border border-red-100">Blocked</span>;
    case "COMPLETE":
      return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 uppercase border border-emerald-100">Complete</span>;
    case "BLOCKED_BY_PRIOR_STEP":
      return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 uppercase border border-slate-200">Blocked by prior step</span>;
    case "WAITING_ON_PRIOR_STEP":
      return <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-500 uppercase border border-slate-100">Waiting on prior step</span>;
    default:
      return <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-500 uppercase border border-slate-100">Pending</span>;
  }
}
