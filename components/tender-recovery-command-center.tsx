"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getRecoveryCommandActionSpec, recoveryCommandLabel, renderRecoveryActionPath } from "../lib/recovery-command-actions";

// ─── Types (mirror lib/engine/tender-lifecycle-orchestrator.ts) ───────────────

type LifecycleState =
  | "UPLOADED" | "EXTRACTED" | "AI_ANALYSIS_REQUIRED" | "AI_ANALYSIS_FAILED"
  | "ANALYSIS_FALLBACK_UNAPPROVED" | "ANALYSIS_READY_FOR_REVIEW" | "ANALYSIS_APPROVED"
  | "METADATA_INCOMPLETE" | "SOURCE_REFERENCES_INCOMPLETE" | "SUBMISSION_PLAN_REQUIRED"
  | "SUBMISSION_PLAN_READY" | "EVIDENCE_MATCHING_REQUIRED" | "EVIDENCE_MATCHED"
  | "DOCUMENT_GENERATION_REQUIRED" | "DOCUMENTS_GENERATED" | "OFFICIAL_ORIGINALS_REQUIRED"
  | "QUALITY_REVIEW_REQUIRED" | "AUTO_FINALIZE_REQUIRED" | "EXPORT_READINESS_BLOCKED"
  | "EXPORT_READY" | "ZIP_READY" | "CLOSED";

type BlockedAction = { action: string; reason: string };
type Blocker = { code: string; message: string; action: string };
type Warning = { code: string; message: string };

type LifecycleResult = {
  lifecycleState: LifecycleState;
  finalSubmissionStatus: "BLOCKED" | "PARTIAL" | "READY";
  primaryNextAction: string;
  allowedActions: string[];
  blockedActions: BlockedAction[];
  blockers: Blocker[];
  warnings: Warning[];
  advisoryWarnings: Warning[];
  counts: {
    requiredPlanRows: number;
    generatedNarrativeDocs: number;
    attachedOfficialOriginals: number;
    plannedMissingDocs: number;
    controlRows: number;
    outsidePlanRows: number;
    finalExportCandidates: number;
    qualityFailedCandidates: number;
    historicalSupersededRows: number;
    envelopes: { TECHNICAL: number; FINANCIAL: number; ADMIN: number };
  };
  providerStatus: {
    totalConfigured: number;
    totalHealthy: number;
    hasAnyProvider: boolean;
    hasCooledDownProvider: boolean;
    primaryProvider: string | null;
  };
  analysisStatus: { source: string; hasText: boolean; score: number | null };
  metadataStatus: {
    completenessRatio: number;
    criticalMissing: string[];
    nonCriticalMissing: string[];
  };
  sourceReferenceStatus: { ungroundedMandatoryCount: number; totalMandatoryCount: number };
  planStatus: {
    hasExplicitPlan: boolean;
    totalRequired: number;
    totalGenerated: number;
    totalMissing: number;
    totalOutsidePlan: number;
    totalOfficialOriginalsRequired: number;
  };
  evidenceStatus: { totalMandatory: number; fullyCoveredMandatory: number; coverageRatio: number };
  documentStatus: { total: number; generated: number; planned: number; superseded: number };
  qualityStatus: { qualityFailed: number };
  officialOriginalStatus: { required: number; attached: number };
  exportStatus: {
    ready: boolean;
    blockerCount: number;
    documentBlockerCount: number;
    advisoryCount: number;
  };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATE_LABELS: Record<LifecycleState, string> = {
  UPLOADED: "Uploaded",
  EXTRACTED: "Text Extracted",
  AI_ANALYSIS_REQUIRED: "AI Analysis Required",
  AI_ANALYSIS_FAILED: "AI Analysis Failed",
  ANALYSIS_FALLBACK_UNAPPROVED: "Fallback Analysis — Unapproved",
  ANALYSIS_READY_FOR_REVIEW: "Analysis Ready",
  ANALYSIS_APPROVED: "Analysis Approved",
  METADATA_INCOMPLETE: "Metadata Incomplete",
  SOURCE_REFERENCES_INCOMPLETE: "Source References Incomplete",
  SUBMISSION_PLAN_REQUIRED: "Submission Plan Required",
  SUBMISSION_PLAN_READY: "Submission Plan Ready",
  EVIDENCE_MATCHING_REQUIRED: "Evidence Matching Required",
  EVIDENCE_MATCHED: "Evidence Matched",
  DOCUMENT_GENERATION_REQUIRED: "Documents Need Generation",
  DOCUMENTS_GENERATED: "Documents Generated",
  OFFICIAL_ORIGINALS_REQUIRED: "Official Originals Required",
  QUALITY_REVIEW_REQUIRED: "Quality Review Required",
  AUTO_FINALIZE_REQUIRED: "Ready to Finalize",
  EXPORT_READINESS_BLOCKED: "Export Blocked",
  EXPORT_READY: "Export Ready",
  ZIP_READY: "ZIP Ready",
  CLOSED: "Closed (WON/LOST/WITHDRAWN)",
};

const ACTION_LABELS = new Proxy({} as Record<string, string>, {
  get: (_target, prop: string | symbol) => typeof prop === "string" ? recoveryCommandLabel(prop) : undefined,
});

function stateColor(state: LifecycleState): string {
  if (state === "EXPORT_READY" || state === "ZIP_READY") return "bg-green-100 text-green-800 border-green-300";
  if (state === "CLOSED") return "bg-slate-100 text-slate-600 border-slate-300";
  if (state === "AUTO_FINALIZE_REQUIRED" || state === "DOCUMENTS_GENERATED") return "bg-blue-100 text-blue-800 border-blue-300";
  if (state.includes("REQUIRED") || state.includes("MISSING") || state.includes("FAILED") || state.includes("UNAPPROVED")) return "bg-red-100 text-red-800 border-red-300";
  return "bg-amber-100 text-amber-800 border-amber-300";
}

function submissionBadge(status: "BLOCKED" | "PARTIAL" | "READY") {
  if (status === "READY") return "bg-green-600 text-white";
  if (status === "PARTIAL") return "bg-amber-500 text-white";
  return "bg-red-600 text-white";
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function TenderRecoveryCommandCenter({ tenderId }: { tenderId: string }) {
  const router = useRouter();
  const [data, setData] = useState<LifecycleResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [approvalNote, setApprovalNote] = useState("");

  function scrollToPanel(anchorId: string, fallbackMessage: string) {
    const el = document.getElementById(anchorId);
    if (!el) {
      setActionMsg(`${fallbackMessage} Panel #${anchorId} is not visible on this page; use the tender detail tabs manually.`);
      return;
    }
    el.scrollIntoView({ behavior: "smooth" });
    setActionMsg(fallbackMessage);
  }

  function messageForApiAction(action: string, json: Record<string, unknown>) {
    if (action === "RUN_AI_ANALYZE" || action === "RETRY_AI_ANALYZE" || action === "REVIEW_ANALYSIS") {
      return json.fallback ? "Regex fallback used — approve below or retry when providers recover." : "Analysis complete.";
    }
    if (action === "BUILD_SUBMISSION_PLAN") return `Plan built — ${json.created ?? 0} file(s) created, ${json.skipped ?? 0} already existed.`;
    if (action === "RUN_ENGINE") return "Engine ran. Review lifecycle, generation readiness, and export readiness before proceeding.";
    if (action === "REPAIR_SOURCE_REFERENCES") return `Source repair complete — ${json.repairedCount ?? 0} requirement(s) updated.`;
    if (action === "GENERATE_REQUIRED_DOCUMENTS" || action === "GENERATE_DOCS" || action === "GENERATE_MISSING_PLANNED_DOCS") return `Missing planned document generation finished — ${json.generated ?? json.created ?? json.count ?? 0} row(s) updated. Review and validate before export.`;
    if (action === "VALIDATE_DOCS") return "Validation completed. Review validation results and remaining blockers.";
    if (action === "REPAIR_DOCUMENT_QUALITY" || action === "REPAIR_DOCS") return `Export-gap repair completed — ${json.repaired ?? json.updated ?? 0} document(s) updated. Re-check readiness before export.`;
    if (action === "AUTO_FINALIZE") return `Auto-finalize completed — ${json.finalized ?? json.updated ?? 0} document(s) updated. Re-check export readiness before download.`;
    if (action === "RESOLVE_EXPORT_BLOCKERS" || action === "EXPORT_READINESS") return "Export readiness re-checked. Review the Export Readiness panel for canonical blockers.";
    if (action === "RECONCILE_OUTSIDE_PLAN_DOCS" || action === "EXCLUDE_OUTSIDE_PLAN_DOCS") return `Outside-plan reconciliation completed — ${json.superseded ?? 0} document(s) excluded/superseded.`;
    if (action === "REPAIR_METADATA") {
      const repaired: string[] = Array.isArray(json.repaired) ? json.repaired as string[] : [];
      return repaired.length > 0 ? `Metadata repaired — ${repaired.join(", ")} updated from tender source text.` : "Metadata repair ran — no missing fields could be extracted from the tender source text.";
    }
    if (action === "RE_EXTRACT_METADATA") return "Metadata re-extraction complete. Review the tender detail panel to confirm updated fields.";
    return `${recoveryCommandLabel(action)} completed.`;
  }

  async function executeAction(action: string) {
    setActioning(true);
    setActionMsg(null);
    try {
      const spec = getRecoveryCommandActionSpec(action);
      if (!spec) {
        setActionMsg("Action not available yet — open the relevant panel manually.");
        return;
      }

      if (action === "APPROVE_FALLBACK_WITH_NOTE") {
        const note = approvalNote.trim();
        if (!note) { setActionMsg("An approval note is required."); return; }
        const res = await fetch(`/api/tenders/${tenderId}/approve-analysis`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Approval failed");
        setActionMsg("Fallback analysis approved — generation unblocked.");
        setApprovalNote("");
        await load();
        router.refresh();
        return;
      }

      if (action === "LINK_VAULT_EVIDENCE") {
        // Step 1: fetch candidates from the existing backend route.
        const getRes = await fetch(`/api/tenders/${tenderId}/link-vault-evidence`);
        const getJson = await getRes.json().catch(() => ({}));
        if (!getRes.ok) throw new Error(getJson.error ?? "Failed to fetch vault evidence candidates");
        const candidates: Array<{ rowId: string; rowName: string; options: Array<{ id: string }> }> = getJson.candidates ?? [];
        if (candidates.length === 0) {
          setActionMsg("No reviewed evidence available in the Knowledge Vault for this tender's documents.");
          return;
        }
        // Step 2: auto-link the highest-scored option for each candidate document row.
        let linked = 0;
        let partialLinked = 0;
        for (const candidate of candidates) {
          const best = candidate.options[0];
          if (!best) continue;
          const postRes = await fetch(`/api/tenders/${tenderId}/link-vault-evidence`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rowId: candidate.rowId, vaultDocumentId: best.id }),
          });
          const postJson = await postRes.json().catch(() => ({}));
          if (postRes.ok) {
            if (postJson.readyForExport) linked++;
            else partialLinked++;
          }
        }
        if (linked + partialLinked === 0) {
          setActionMsg("Evidence suggestions created but no documents could be linked. Open Mandatory Requirement Coverage to confirm evidence.");
        } else if (linked > 0 && partialLinked === 0) {
          setActionMsg(`Vault evidence linking completed — ${linked} document(s) linked and ready for export.`);
        } else if (linked > 0) {
          setActionMsg(`Vault evidence linking started — ${linked} document(s) ready, ${partialLinked} require validation review. Open Mandatory Requirement Coverage to confirm evidence.`);
        } else {
          setActionMsg(`Evidence suggestions created — ${partialLinked} document(s) linked but require validation/hygiene review. Open Mandatory Requirement Coverage to confirm evidence.`);
        }
        await load();
        router.refresh();
        return;
      }

      if (spec.kind === "download" && spec.path) {
        window.location.href = renderRecoveryActionPath(spec.path, tenderId);
        return;
      }
      if (spec.kind === "navigate" && spec.path) {
        window.location.href = renderRecoveryActionPath(spec.path, tenderId);
        return;
      }
      if (spec.kind === "scroll" && spec.anchorId) {
        scrollToPanel(spec.anchorId, spec.message ?? `Open ${spec.label}.`);
        return;
      }
      if (spec.kind === "refresh") {
        await load();
        router.refresh();
        setActionMsg("Readiness re-checked. Review the command center and export-readiness panels for current blockers.");
        return;
      }
      if (spec.kind === "api" && spec.path) {
        const res = await fetch(renderRecoveryActionPath(spec.path, tenderId), { method: spec.method ?? "POST" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? json.message ?? `${spec.label} failed`);
        setActionMsg(messageForApiAction(action, json));
        await load();
        router.refresh();
        if (action === "RESOLVE_EXPORT_BLOCKERS" || action === "EXPORT_READINESS") {
          document.getElementById("export-readiness")?.scrollIntoView({ behavior: "smooth" });
        }
        return;
      }

      setActionMsg("Action not available yet — open the relevant panel manually.");
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActioning(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/lifecycle`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Failed to load lifecycle");
      setData(json as LifecycleResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load lifecycle");
    } finally {
      setLoading(false);
    }
  }, [tenderId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          Loading tender lifecycle…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">{error ?? "Unable to compute lifecycle state."}</p>
        <button onClick={load} className="mt-2 text-xs text-red-600 underline">Retry</button>
      </div>
    );
  }

  const stateLabel = STATE_LABELS[data.lifecycleState] ?? data.lifecycleState;
  const actionLabel = ACTION_LABELS[data.primaryNextAction] ?? data.primaryNextAction;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800">Recovery Command Center</span>
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${stateColor(data.lifecycleState)}`}>
            {stateLabel}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${submissionBadge(data.finalSubmissionStatus)}`}>
            {data.finalSubmissionStatus}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
            aria-label="Refresh lifecycle state"
          >
            ↻ Refresh
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
            aria-label={expanded ? "Collapse details" : "Expand details"}
          >
            {expanded ? "▲ Collapse" : "▼ Details"}
          </button>
        </div>
      </div>

      {/* Primary Next Action */}
      <div className="border-b border-gray-100 bg-blue-50 px-5 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-blue-600">Primary Next Action</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-blue-900">{actionLabel}</p>
          {data.primaryNextAction !== "DOWNLOAD_FINAL_ZIP" && (
            <button
              onClick={() => void executeAction(data.primaryNextAction)}
              disabled={actioning}
              className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {actioning ? "Working…" : "▶ Execute"}
            </button>
          )}
          {data.primaryNextAction === "DOWNLOAD_FINAL_ZIP" && (
            <a href={`/api/tenders/${tenderId}/download`} className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700">
              ↓ Download ZIP
            </a>
          )}
        </div>
        {data.primaryNextAction === "APPROVE_FALLBACK_WITH_NOTE" && (
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={approvalNote}
              onChange={(e) => setApprovalNote(e.target.value)}
              placeholder="Approval note (required)…"
              className="flex-1 rounded border border-blue-200 bg-white px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400"
              maxLength={200}
            />
          </div>
        )}
        {actionMsg && (
          <p className="mt-2 text-xs text-blue-700 font-medium">{actionMsg}</p>
        )}
      </div>

      {/* Blockers */}
      {data.blockers.length > 0 && (
        <div className="border-b border-gray-100 px-5 py-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-red-600">
            Blockers ({data.blockers.length})
          </p>
          <ul className="space-y-1.5">
            {data.blockers.map((b) => (
              <li key={b.code} className="rounded border border-red-200 bg-red-50 px-3 py-1.5">
                <p className="text-xs font-medium text-red-800">{b.message}</p>
                <p className="mt-0.5 text-xs text-red-600">Action: {b.action}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Blocked Actions */}
      {data.blockedActions.length > 0 && (
        <div className="border-b border-gray-100 px-5 py-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-amber-700">
            Blocked Actions ({data.blockedActions.length})
          </p>
          <ul className="space-y-1">
            {data.blockedActions.map((b) => (
              <li key={b.action} className="flex items-start gap-1.5 text-xs text-gray-700">
                <span className="mt-0.5 shrink-0 text-amber-500">⊘</span>
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

      {/* Document count summary — always visible */}
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
      {/* Plan-not-built notice: shown when all counters are 0 and no submission plan exists */}
      {data.counts.requiredPlanRows === 0
        && data.counts.generatedNarrativeDocs === 0
        && data.counts.finalExportCandidates === 0
        && !data.planStatus.hasExplicitPlan && (
        <div className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-800">
          Plan not built — build the submission plan first.
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="divide-y divide-gray-100">
          {/* Warnings */}
          {data.warnings.length > 0 && (
            <div className="px-5 py-3">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-amber-700">
                Warnings ({data.warnings.length})
              </p>
              <ul className="space-y-1">
                {data.warnings.map((w) => (
                  <li key={w.code} className="text-xs text-amber-800">⚠ {w.message}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Advisory warnings */}
          {data.advisoryWarnings.length > 0 && (
            <div className="px-5 py-3">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                Advisory ({data.advisoryWarnings.length}) — do not block export
              </p>
              <ul className="space-y-1">
                {data.advisoryWarnings.map((w) => (
                  <li key={w.code} className="text-xs text-gray-600">ℹ {w.message}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Status grid */}
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

          {/* Envelope breakdown */}
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

          {/* Allowed actions */}
          {data.allowedActions.length > 0 && (
            <div className="px-5 py-3">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                Allowed Actions ({data.allowedActions.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {data.allowedActions.map((a) => (
                  <span key={a} className="rounded border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-800">
                    ✓ {ACTION_LABELS[a] ?? a}
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
      <span className={`font-medium ${ok ? "text-green-700" : "text-red-600"}`}>
        {ok ? "✓" : "✗"} {value}
      </span>
    </div>
  );
}
