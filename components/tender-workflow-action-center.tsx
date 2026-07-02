"use client";

import React, { useEffect, useState, useCallback } from "react";
import { clientLogger } from "@/lib/ui/client-logger";
import { isMutationAction } from "@/lib/recovery-command-actions";

export interface WorkflowStageInfo {
  stage: number;
  label: string;
  status: "PENDING" | "IN_PROGRESS" | "READY" | "BLOCKED" | "WARNING";
  explanation: string;
  blocker?: string;
  actionLabel?: string;
  actionUrl?: string;
  actionMethod?: string;
}

export function TenderWorkflowActionCenter({ tenderId, canMutate = true }: { tenderId: string; canMutate?: boolean }) {
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
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-slate-900">Workflow Control Center</h2>
        <button onClick={fetchStages} className="text-[10px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest">Refresh State</button>
      </div>
      <div className="grid gap-3">
        {stages.map((s) => (
          <div key={s.stage} className="flex items-start gap-4 p-3 rounded-xl border border-slate-50 hover:bg-slate-50 transition-colors">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
              {s.stage}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-slate-900">{s.label}</h3>
                <StatusBadge status={s.status} />
              </div>
              <p className="mt-0.5 text-sm text-slate-600">{s.explanation}</p>
              {s.blocker && (
                <p className="mt-1 text-xs font-medium text-red-600">
                  Blocker: {s.blocker}
                </p>
              )}
            </div>
            {s.actionLabel && (canMutate || !isMutationAction(s.actionLabel && s.actionUrl ? _inferActionFromUrl(s.actionUrl, s.actionMethod) : "")) && (
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

// Infer the recovery-command action name from a workflow stage's action URL
// and method. Used to classify whether the action is a mutation.
function _inferActionFromUrl(url: string, method?: string): string {
  if (!url) return "";
  // Map known API paths to action names
  if (url.includes("/ai-analyze")) return method === "POST" ? "RUN_AI_ANALYZE" : "";
  if (url.includes("/engine")) return "RUN_ENGINE";
  if (url.includes("/submission-plan/build")) return "BUILD_SUBMISSION_PLAN";
  if (url.includes("/repair-source-grounding")) return "REPAIR_SOURCE_REFERENCES";
  if (url.includes("/repair-metadata")) return "REPAIR_METADATA";
  if (url.includes("/re-extract-metadata")) return "RE_EXTRACT_METADATA";
  if (url.includes("/link-vault-evidence-auto")) return "LINK_VAULT_EVIDENCE";
  if (url.includes("/generate-missing-plan-files")) return "GENERATE_REQUIRED_DOCUMENTS";
  if (url.includes("/validate")) return "VALIDATE_DOCS";
  if (url.includes("/auto-finalize")) return "AUTO_FINALIZE";
  if (url.includes("/supersede-outside-plan")) return "RECONCILE_OUTSIDE_PLAN_DOCS";
  if (url.includes("/repair-export-gaps")) return "REPAIR_DOCUMENT_QUALITY";
  if (url.includes("/approve-analysis")) return "APPROVE_FALLBACK_WITH_NOTE";
  if (url.includes("/download")) return "DOWNLOAD_FINAL_ZIP";
  if (url.includes("/export-readiness")) return "EXPORT_READINESS";
  // If it's a POST/DELETE to an API path, treat as mutation
  if (method === "POST" || method === "DELETE") return "MUTATION";
  return "";
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
    default:
      return <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-500 uppercase border border-slate-100">Pending</span>;
  }
}
