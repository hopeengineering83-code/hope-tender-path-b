"use client";

import React, { useCallback, useEffect, useState } from "react";
import { clientLogger } from "@/lib/ui/client-logger";
import {
  emitTenderWorkflowSync,
  subscribeTenderWorkflowSync,
} from "@/lib/ui/tender-workflow-sync";
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionStage, setActionStage] = useState<number | null>(null);

  const fetchStages = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await fetch(`/api/tenders/${tenderId}/workflow-center`, {
        cache: "no-store",
        credentials: "include",
      });
      const json = await response.json().catch(() => ({})) as { stages?: WorkflowStageInfo[]; error?: string };
      if (!response.ok) throw new Error(json.error ?? `workflow-center ${response.status}`);
      if (!Array.isArray(json.stages)) throw new Error("Workflow-center response did not include stages");
      setStages(json.stages);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workflow state could not be loaded";
      setLoadError(message);
      clientLogger.error("workflow center fetch failed", { message });
    }
  }, [tenderId]);

  useEffect(() => {
    void fetchStages();
    const interval = window.setInterval(() => {
      if (!document.hidden) void fetchStages();
    }, 10_000);
    const unsubscribe = subscribeTenderWorkflowSync(tenderId, () => {
      void fetchStages();
    });
    return () => {
      window.clearInterval(interval);
      unsubscribe();
    };
  }, [fetchStages, tenderId]);

  const handleAction = async (stage: WorkflowStageInfo) => {
    setActionMessage(null);

    if (stage.actionUrl) {
      setActionStage(stage.stage);
      try {
        const response = await fetch(stage.actionUrl, { method: stage.actionMethod || "POST" });
        const actionJson = await response.json().catch(() => ({})) as { error?: string; message?: string };
        if (!response.ok) throw new Error(actionJson.error ?? actionJson.message ?? `${stage.actionLabel ?? "Action"} failed`);
        emitTenderWorkflowSync({ tenderId, source: `workflow-center-stage-${stage.stage}` });
        await fetchStages();
        setActionMessage(actionJson.message ?? `${stage.actionLabel ?? "Action"} completed. All control centers are refreshing.`);
      } catch (error) {
        setActionMessage(error instanceof Error ? error.message : "Workflow action failed");
      } finally {
        setActionStage(null);
      }
      return;
    }

    // Every stage without a server-provided actionUrl scrolls to its real
    // resolution panel. Blocked stages remain actionable: a blocked badge is
    // a reason to open the owning panel, not a reason to disable the shortcut.
    // Primary targets preserve the established source contract; secondary
    // targets make navigation resilient when a conditional panel is absent.
    const targets: Record<number, string[]> = {
      1: ["#tender-files"],
      2: ["#extraction-quality", "#tender-files"],
      3: ["#ai-analyze-section"],
      4: ["#requirement-coverage", "#ai-analyze-section"],
      5: ["#tender-edit-form"],
      6: ["#submission-plan", "#submission-plan-reconciliation"],
      7: ["#match-evidence", "#requirement-coverage"],
      8: ["#generated-documents", "#submission-plan"],
      9: ["#authority-review", "#generated-documents"],
      10: ["#export-readiness"],
    };
    const fallbackTargets: Partial<Record<number, string[]>> = {
      10: ["#final-package-manifest"],
    };
    const selectors = [...(targets[stage.stage] ?? []), ...(fallbackTargets[stage.stage] ?? [])];
    const element = selectors
      .map((selector) => document.querySelector(selector))
      .find((candidate): candidate is Element => candidate !== null);

    if (!element) {
      setActionMessage(`${stage.actionLabel ?? "Workflow action"} could not find its target panel. Refresh the page and retry.`);
      return;
    }
    element.scrollIntoView({ behavior: "smooth", block: "start" });
    setActionMessage(`Opened ${stage.actionLabel ?? stage.label}.`);
  };

  if (!stages && !loadError) {
    return <div className="mb-6 h-64 animate-pulse rounded-2xl border bg-slate-50" aria-busy="true" />;
  }

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="text-lg font-bold text-slate-900">Workflow Control Center</h2>
        <button type="button" onClick={() => void fetchStages()} className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-600">Refresh State</button>
      </div>

      {loadError && (
        <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>{loadError}</p>
          <button type="button" onClick={() => void fetchStages()} className="mt-1 text-xs font-semibold underline">Retry</button>
        </div>
      )}
      {actionMessage && <p role="status" className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">{actionMessage}</p>}

      {stages && (
        <>
          {/* Stage 10 is computed from snapshot.exportEligible, so the badge
              compares against the same export tier rather than finalZip. */}
          <SnapshotConsistencyBadge
            tenderId={tenderId}
            verdict="export"
            localEligible={stages.find((s) => s.stage === 10)?.status === "READY"}
            localLabel="Workflow Control Center"
          />
          <div className="mt-3 grid gap-3">
            {stages.map((stage) => (
              <div key={stage.stage} className="flex items-start gap-4 rounded-xl border border-slate-50 p-3 transition-colors hover:bg-slate-50">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
                  {stage.stage}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h3 className="min-w-0 break-words font-semibold text-slate-900">{stage.label}</h3>
                    <StatusBadge status={stage.status} />
                  </div>
                  <p className="mt-0.5 text-sm text-slate-600">{stage.explanation}</p>
                  {stage.blocker && <p className="mt-1 text-xs font-medium text-red-600">Blocker: {stage.blocker}</p>}
                </div>
                {stage.actionLabel && (canMutate || stage.actionKind === "readonly" || (!stage.actionKind && !stage.actionUrl)) && (
                  <div className="shrink-0 self-center">
                    <button
                      type="button"
                      onClick={() => void handleAction(stage)}
                      disabled={actionStage !== null}
                      aria-busy={actionStage === stage.stage}
                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {actionStage === stage.stage ? "Working…" : stage.actionLabel}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: WorkflowStageInfo["status"] }) {
  switch (status) {
    case "COMPLETE":
      return <span className="inline-flex items-center gap-1 rounded-full border border-emerald-600 bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">Complete</span>;
    case "READY":
      return <span className="inline-flex items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">Ready</span>;
    case "IN_PROGRESS":
      return <span className="inline-flex items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-700">In Progress</span>;
    case "WARNING":
      return <span className="inline-flex items-center gap-1 rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">Attention</span>;
    case "BLOCKED":
      return <span className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">Blocked</span>;
    case "BLOCKED_BY_PRIOR_STEP":
      return <span className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase text-red-500">Blocked by prior step</span>;
    case "WAITING_ON_PRIOR_STEP":
      return <span className="inline-flex items-center gap-1 rounded-full border border-slate-100 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">Waiting</span>;
    default:
      return <span className="inline-flex items-center gap-1 rounded-full border border-slate-100 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">Pending</span>;
  }
}
