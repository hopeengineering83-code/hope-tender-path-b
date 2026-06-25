"use client";

import React, { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon as WarningIcon,
  CheckCircleIcon as CheckIcon,
  XCircleIcon as CrossIcon,
  BanIcon,
  RefreshCwIcon as RefreshIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  TerminalIcon,
} from "lucide-react";
import { getRecoveryCommandActionSpec, recoveryCommandLabel, renderRecoveryActionPath } from "../lib/recovery-command-actions";

type JobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "PARTIAL_SUCCESS";

export default function TenderRecoveryCommandCenter({ tenderId }: { tenderId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioning, setActioning] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<number | null>(null);
  const [approvalNote, setApprovalNote] = useState("");
  const [ocrProvider, setOcrProvider] = useState("auto");

  async function load() {
    try {
      const res = await fetch(`/api/tenders/${tenderId}/workflow-center`);
      if (!res.ok) throw new Error("Failed to load workflow state");
      const d = await res.json();
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [tenderId]);

  if (loading) return (
    <div className="mb-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm animate-pulse">
      <div className="h-6 w-48 bg-gray-100 rounded mb-2" />
      <div className="h-4 w-64 bg-gray-50 rounded" />
    </div>
  );
  if (error || !data) return null;

  const ACTION_LABELS: Record<string, string> = {
    RUN_AI_ANALYZE: "Run AI Analyze",
    BUILD_SUBMISSION_PLAN: "Build Plan",
    RUN_ENGINE: "Run Engine",
    EXPORT_READINESS: "Check Export",
    RE_EXTRACT_METADATA: "Re-extract",
    REPAIR_METADATA: "Repair",
    RE_CHECK: "Re-check",
  };

  function messageForApiAction(action: string, json: Record<string, unknown>) {
    if (action === "RUN_AI_ANALYZE" || action === "RETRY_AI_ANALYZE" || action === "REVIEW_ANALYSIS" || action === "RESUME_AI_ANALYZE") {
      return json.fallback ? "Regex fallback used — generation remains blocked. Retry when providers recover or approve for audit only." : "Analysis completed. Verify results in the Analysis Quality panel.";
    }
    if (action === "BUILD_SUBMISSION_PLAN") return `Plan built — ${json.created ?? 0} file(s) created, ${json.skipped ?? 0} already existed.`;
    if (action === "RUN_ENGINE") return "Engine ran. Review lifecycle, generation readiness, and export readiness before proceeding.";
    if (action === "REPAIR_METADATA") return "Metadata repaired.";
    if (action === "RE_EXTRACT_METADATA") return "Metadata re-extracted.";
    return `${recoveryCommandLabel(action)} completed.`;
  }

  async function runDurableAnalyze(path: string): Promise<string> {
    setAnalyzeProgress(5);
    setActionMsg("Enqueuing durable analysis job…");

    const enqueueRes = await fetch(path, { method: "POST" });
    if (enqueueRes.status === 401 || enqueueRes.status === 403) {
      setAnalyzeProgress(null);
      throw new Error("You are not authorized to run AI analysis. Please sign in again.");
    }
    if (enqueueRes.status === 422) {
      const d = await enqueueRes.json().catch(() => ({}));
      setAnalyzeProgress(null);
      throw new Error(d.error ?? "Extraction is not ready. Run OCR or re-upload.");
    }
    if (enqueueRes.status !== 202) {
      const d = await enqueueRes.json().catch(() => ({}));
      setAnalyzeProgress(null);
      throw new Error(d.error ?? `Failed to start analysis (HTTP ${enqueueRes.status}).`);
    }
    const enqueued = await enqueueRes.json();
    const jobId: string | undefined = enqueued.jobId;
    if (!jobId) {
      setAnalyzeProgress(null);
      throw new Error("No job ID returned from the analysis endpoint.");
    }
    setAnalyzeProgress(10);
    setActionMsg("Starting worker…");

    try {
      const workerRes = await fetch(`/api/ai-jobs/run-next?jobType=AI_ANALYZE`, { method: "POST" });
      if (workerRes.status === 401 || workerRes.status === 403) {
        setActionMsg("Worker could not be started (session expired). The job is queued and will be picked up automatically.");
      } else if (workerRes.status >= 500) {
        setActionMsg("Worker start failed. The job is queued and will be retried automatically.");
      }
    } catch {
      // ignore worker trigger failure
    }

    setAnalyzeProgress(15);
    setActionMsg("Analysis running…");
    let pollCount = 0;
    const maxPolls = 240;
    while (pollCount < maxPolls) {
      pollCount++;
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch(`/api/ai-jobs/${jobId}`);
        if (!res.ok) continue;
        const data = await res.json();
        const job = data?.job;
        if (!job) continue;

        const steps: Array<{ message?: string | null }> = job.steps ?? [];
        const latestStep = steps[steps.length - 1];
        if (latestStep?.message) setActionMsg(String(latestStep.message).slice(0, 80));

        const status: string = job.status;
        const output: Record<string, unknown> = job.output ?? {};

        if (status === "QUEUED" || status === "RUNNING") {
          const completed = typeof output.completedChunks === "number" ? output.completedChunks : 0;
          const total = typeof output.totalChunks === "number" ? output.totalChunks : 0;
          if (total > 0 && completed > 0) {
            setAnalyzeProgress(Math.min(Math.round(15 + (completed / total) * 75), 90));
          } else {
            setAnalyzeProgress(Math.min(15 + pollCount * 2, 85));
          }
          continue;
        }

        setAnalyzeProgress(null);
        if (status === "SUCCEEDED") {
          const reqCount = typeof output.requirementCount === "number" ? output.requirementCount : 0;
          return `Analysis complete — ${reqCount} requirement(s) extracted and promoted.`;
        }
        if (status === "PARTIAL_SUCCESS") {
          return "Analysis partial — some chunks failed. Generation remains blocked. Retry when providers recover.";
        }
        const errMsg = (typeof job.errorMessage === "string" && job.errorMessage) ||
          (typeof output.errorMessage === "string" && output.errorMessage) ||
          "Analysis failed.";
        throw new Error(errMsg);
      } catch (e) {
        if (pollCount >= maxPolls) {
          setAnalyzeProgress(null);
          throw new Error("Analysis is taking longer than expected. It may still be running — refresh the page.");
        }
      }
    }
    setAnalyzeProgress(null);
    return "Analysis is still running in the background. Refresh the page to check status.";
  }

  async function executeAction(action: string) {
    if (actioning) return;
    setActioning(true);
    setActionMsg(null);
    setError(null);
    try {
      const spec = getRecoveryCommandActionSpec(action);
      if (!spec) setError("Action not available yet"); return;

      if (action === "APPROVE_FALLBACK_WITH_NOTE") {
        if (!approvalNote.trim()) throw new Error("Please provide a note for approval.");
        const res = await fetch(`/api/tenders/${tenderId}/approve-fallback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: approvalNote, contentHash: data.analysisStatus.contentHash }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Approval failed");
        setActionMsg("Fallback note saved for audit. Generation and export remain blocked until full AI analysis succeeds.");
        setApprovalNote("");
        await load();
        router.refresh();
        return;
      }

      if (spec.kind === "navigate" && spec.path) {
        router.push(renderRecoveryActionPath(spec.path, tenderId));
        return;
      }
      if (spec.kind === "scroll" && spec.anchorId) {
        const el = document.getElementById(spec.anchorId);
        if (el) el.scrollIntoView({ behavior: "smooth" });
        else router.push(`/dashboard/tenders/${tenderId}#${spec.anchorId}`);
        return;
      }
      if (spec.kind === "refresh") {
        await load();
        router.refresh();
        return;
      }
      if (spec.kind === "api" && spec.path) {
        if (spec.path.includes("/ai-analyze")) {
          const msg = await runDurableAnalyze(renderRecoveryActionPath(spec.path, tenderId));
          setActionMsg(msg);
          await load();
          router.refresh();
          return;
        }

        const res = await fetch(renderRecoveryActionPath(spec.path, tenderId), {
          method: spec.method || "POST",
          headers: { "Content-Type": "application/json" },
          body: action === "RE_EXTRACT_METADATA" ? JSON.stringify({ ocrProvider }) : undefined,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? json.message ?? `Action failed (HTTP ${res.status})`);
        setActionMsg(messageForApiAction(action, json));
        await load();
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActioning(false);
    }
  }

  function scrollToPanel(id: string, msg: string) {
    setActionMsg(msg);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth" });
    else router.push(`/dashboard/tenders/${tenderId}#${id}`);
  }

  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-200 hover:shadow-md">
      <div className="flex items-center justify-between border-b border-gray-50 bg-gray-50/30 px-5 py-3">
        <div className="flex items-center gap-2 text-slate-900">
          <TerminalIcon className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-bold tracking-tight">Stage 6: System Recovery & Diagnostics</h2>
        </div>
        <div className="flex items-center gap-3">
          {actionMsg && (
            <span className="text-xs font-medium text-emerald-600 animate-in fade-in slide-in-from-right-1">
              {actionMsg}
            </span>
          )}
          {error && (
            <span className="text-xs font-medium text-red-600">
              {error}
            </span>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="rounded-full p-1 text-slate-400 hover:bg-gray-100 hover:text-slate-600 transition-colors"
            title={expanded ? "Collapse details" : "Expand details"}
          >
            {expanded ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {analyzeProgress !== null && (
        <div className="h-1 w-full bg-gray-100">
          <div
            className="h-full bg-emerald-500 transition-all duration-500 ease-out"
            style={{ width: `${analyzeProgress}%` }}
          />
        </div>
      )}

      {data.blockers.length > 0 && (
        <div className="border-b border-red-50 bg-red-50/30 px-5 py-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-red-700">
            Critical Readiness Blockers ({data.blockers.length})
          </p>
          <ul className="space-y-2">
            {data.blockers.map((b: any) => (
              <li key={b.code} className="group">
                <div className="flex items-start gap-1.5 text-xs text-red-800">
                  <WarningIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                  <span className="leading-relaxed">{b.message}</span>
                </div>
                {b.code === "METADATA_INCOMPLETE" && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <select value={ocrProvider} onChange={(e) => setOcrProvider(e.target.value)} className="rounded border border-red-300 bg-white px-1.5 py-0.5 text-xs text-red-700" title="OCR provider for re-extraction">
                      <option value="auto">Auto OCR</option>
                      <option value="tesseract">Tesseract</option>
                      <option value="google">Google Vision</option>
                      <option value="azure">Azure Read</option>
                    </select>
                    <button onClick={() => void executeAction("RE_EXTRACT_METADATA")} disabled={actioning} className="rounded border border-red-400 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">Re-extract</button>
                    <button onClick={() => scrollToPanel("tender-edit-form", "Open the Tender Metadata form to fill missing fields.")} className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-100">Edit Manually</button>
                  </div>
                )}
                {b.code === "ANALYSIS_REGEX_FALLBACK_UNAPPROVED" && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <button onClick={() => void executeAction("RETRY_AI_ANALYZE")} disabled={actioning} className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">Retry AI Analyze</button>
                  </div>
                )}
                {b.code === "EVIDENCE_NOT_ASSESSED" && (
                  <div className="mt-1.5">
                    <button onClick={() => void executeAction("RUN_ENGINE")} disabled={actioning} className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">Run Engine</button>
                  </div>
                )}
                {b.code === "MANDATORY_EVIDENCE_WEAK" && (
                  <div className="mt-1.5">
                    <button onClick={() => void executeAction("LINK_VAULT_EVIDENCE")} disabled={actioning} className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">Link Vault Evidence</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.blockedActions.length > 0 && (
        <div className="border-b border-gray-100 px-5 py-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-amber-700">
            Blocked Actions ({data.blockedActions.length})
          </p>
          <ul className="space-y-1">
            {data.blockedActions.map((b: any) => (
              <li key={b.action} className="flex items-start gap-1.5 text-xs text-gray-700">
                <BanIcon className="mt-0.5 shrink-0 text-amber-500" />
                <span>
                  <span className="font-medium">{ACTION_LABELS[b.action] ?? b.action}</span>
                  {" — "}
                  {b.reason}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-4 gap-px border-b border-gray-100 bg-gray-100 text-center text-xs">
        {[
          { label: "Required", value: data.counts.requiredPlanRows },
          { label: "Generated", value: data.counts.generatedNarrativeDocs },
          { label: "Missing", value: data.counts.plannedMissingDocs, danger: data.counts.plannedMissingDocs > 0 },
          { label: "Export Ready", value: data.counts.finalExportCandidates, good: data.counts.finalExportCandidates > 0 },
        ].map((cell) => (
          <div key={cell.label} className="bg-white py-2">
            <div className={`text-base font-bold ${cell.danger ? "text-red-600" : cell.good ? "text-green-700" : "text-gray-800"}`}>
              {cell.value}
            </div>
            <div className="text-gray-500">{cell.label}</div>
          </div>
        ))}
      </div>
      {data.counts.requiredPlanRows === 0
        && data.counts.generatedNarrativeDocs === 0
        && data.counts.finalExportCandidates === 0
        && !data.planStatus.hasExplicitPlan && (
        <div className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-800">
          Plan not built — build the submission plan first.
        </div>
      )}

      {expanded && (
        <div className="divide-y divide-gray-100">
          {data.warnings.length > 0 && (
            <div className="px-5 py-3">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-amber-700">
                Warnings ({data.warnings.length})
              </p>
              <ul className="space-y-1">
                {data.warnings.map((w: any) => (
                  <li key={w.code} className="flex items-start gap-1.5 text-xs text-amber-800"><WarningIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w.message}</li>
                ))}
              </ul>
            </div>
          )}

          {data.advisoryWarnings.length > 0 && (
            <div className="px-5 py-3">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                Advisory ({data.advisoryWarnings.length}) — do not block export
              </p>
              <ul className="space-y-1">
                {data.advisoryWarnings.map((w: any) => (
                  <li key={w.code} className="text-xs text-gray-600">ℹ {w.message}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="px-5 py-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Status Summary</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              <StatusRow label="Providers" value={`${data.providerStatus.totalHealthy}/${data.providerStatus.totalConfigured} healthy`} ok={data.providerStatus.totalHealthy > 0} />
              <StatusRow label="Analysis" value={data.analysisStatus.source.replace(/_/g, " ")} ok={data.analysisStatus.source === "AI" || data.analysisStatus.source === "HUMAN_APPROVED_REGEX_FALLBACK"} />
              <StatusRow label="Metadata" value={`${Math.round(data.metadataStatus.completenessRatio * 100)}% complete`} ok={data.metadataStatus.criticalMissing.length === 0} />
              <StatusRow
                label="Source Refs"
                value={data.sourceReferenceStatus.totalMandatoryCount > 0
                  ? `${data.sourceReferenceStatus.totalMandatoryCount - data.sourceReferenceStatus.ungroundedMandatoryCount}/${data.sourceReferenceStatus.totalMandatoryCount} grounded`
                  : "No mandatory reqs"}
                ok={data.sourceReferenceStatus.ungroundedMandatoryCount === 0}
              />
              <StatusRow
                label="Evidence"
                value={data.evidenceStatus.totalMandatory > 0
                  ? `${data.evidenceStatus.fullyCoveredMandatory ?? 0}/${data.evidenceStatus.totalMandatory} covered`
                  : "No mandatory reqs"}
                ok={(data.evidenceStatus.coverageRatio ?? 0) > 0.7}
              />
              <StatusRow
                label="Official Originals"
                value={`${data.officialOriginalStatus.attached}/${data.officialOriginalStatus.required} attached`}
                ok={data.officialOriginalStatus.required === 0 || data.officialOriginalStatus.attached >= data.officialOriginalStatus.required}
              />
              <StatusRow label="Outside Plan" value={`${data.counts.outsidePlanRows} docs`} ok={data.counts.outsidePlanRows === 0} />
              <StatusRow label="Quality Failed" value={`${data.counts.qualityFailedCandidates} docs`} ok={data.counts.qualityFailedCandidates === 0} />
            </div>
          </div>

          {data.planStatus.totalRequired > 0 && (
            <div className="px-5 py-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Envelope Breakdown</p>
              <div className="flex gap-4 text-xs">
                {(["TECHNICAL", "FINANCIAL", "ADMIN"] as const).map((env) => (
                  <div key={env} className="text-center">
                    <div className="text-base font-bold text-gray-800">{data.counts.envelopes[env]}</div>
                    <div className="text-gray-500">{env}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.allowedActions.length > 0 && (
            <div className="px-5 py-3">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                Allowed Actions ({data.allowedActions.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {data.allowedActions.map((a: string) => (
                  <span key={a} className="inline-flex items-center gap-1 rounded border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-800">
                    <CheckIcon className="h-3 w-3" /> {ACTION_LABELS[a] ?? a}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusRow({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-600">{label}</span>
      <span className={`inline-flex items-center gap-1 font-medium ${ok ? "text-green-700" : "text-red-600"}`}>
        {ok ? <CheckIcon className="h-3 w-3" /> : <CrossIcon className="h-3 w-3" />} {value}
      </span>
    </div>
  );
}
