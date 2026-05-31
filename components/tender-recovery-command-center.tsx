"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

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

const ACTION_LABELS: Record<string, string> = {
  UPLOAD_TENDER_DOCUMENT: "Upload Tender Document",
  CONFIGURE_AI_PROVIDER: "Configure AI Provider",
  RUN_AI_ANALYZE: "Run AI Analyze",
  RETRY_AI_ANALYZE: "Retry AI Analyze",
  APPROVE_FALLBACK_WITH_NOTE: "Approve Fallback Analysis (with note)",
  REVIEW_ANALYSIS: "Review Analysis",
  COMPLETE_METADATA: "Complete Metadata",
  REPAIR_SOURCE_REFERENCES: "Repair Source References",
  BUILD_SUBMISSION_PLAN: "Build Submission Plan",
  RUN_ENGINE: "Run Engine",
  LINK_VAULT_EVIDENCE: "Link Vault Evidence",
  GENERATE_REQUIRED_DOCUMENTS: "Generate Required Documents",
  ATTACH_OFFICIAL_ORIGINALS: "Attach Official Originals",
  REPAIR_DOCUMENT_QUALITY: "Repair Document Quality",
  AUTO_FINALIZE: "Auto-Finalize",
  RESOLVE_EXPORT_BLOCKERS: "Resolve Export Blockers",
  DOWNLOAD_FINAL_ZIP: "Download Final ZIP",
  RECONCILE_OUTSIDE_PLAN_DOCS: "Reconcile Outside-Plan Documents",
};

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

  async function executeAction(action: string) {
    setActioning(true);
    setActionMsg(null);
    try {
      if (action === "RETRY_AI_ANALYZE" || action === "REVIEW_ANALYSIS") {
        const res = await fetch(`/api/tenders/${tenderId}/ai-analyze`, { method: "POST" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "AI Analyze failed");
        setActionMsg(json.fallback ? "Regex fallback used — approve below or retry when providers recover." : "Analysis complete.");
        await load();
        router.refresh();
      } else if (action === "BUILD_SUBMISSION_PLAN") {
        const res = await fetch(`/api/tenders/${tenderId}/submission-plan/build`, { method: "POST" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Build plan failed");
        setActionMsg(`Plan built — ${json.created ?? 0} file(s) created, ${json.skipped ?? 0} already existed.`);
        await load();
        router.refresh();
      } else if (action === "RUN_ENGINE") {
        const res = await fetch(`/api/tenders/${tenderId}/engine`, { method: "POST" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Engine run failed");
        setActionMsg("Engine ran successfully.");
        await load();
        router.refresh();
      } else if (action === "APPROVE_FALLBACK_WITH_NOTE") {
        const note = approvalNote.trim();
        if (!note) { setActionMsg("An approval note is required."); setActioning(false); return; }
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
      } else if (action === "DOWNLOAD_FINAL_ZIP") {
        window.location.href = `/api/tenders/${tenderId}/download`;
      } else if (action === "LINK_VAULT_EVIDENCE") {
        window.location.href = `/dashboard/vault`;
      } else if (action === "COMPLETE_METADATA") {
        document.getElementById("tender-edit-form")?.scrollIntoView({ behavior: "smooth" });
      } else if (action === "GENERATE_REQUIRED_DOCUMENTS" || action === "REPAIR_DOCUMENT_QUALITY" || action === "AUTO_FINALIZE" || action === "RESOLVE_EXPORT_BLOCKERS" || action === "RECONCILE_OUTSIDE_PLAN_DOCS") {
        document.getElementById("submission-plan-completeness")?.scrollIntoView({ behavior: "smooth" });
      } else if (action === "ATTACH_OFFICIAL_ORIGINALS") {
        document.getElementById("generated-documents")?.scrollIntoView({ behavior: "smooth" });
      } else if (action === "CONFIGURE_AI_PROVIDER") {
        window.location.href = `/dashboard/analytics`;
      } else if (action === "REPAIR_SOURCE_REFERENCES") {
        const res = await fetch(`/api/tenders/${tenderId}/repair-source-grounding`, { method: "POST" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Source repair failed");
        setActionMsg(`Source repair complete — ${json.repairedCount ?? 0} requirement(s) updated.`);
        await load();
        router.refresh();
      } else if (action === "UPLOAD_TENDER_DOCUMENT") {
        document.getElementById("tender-files")?.scrollIntoView({ behavior: "smooth" });
      } else if (action === "RUN_AI_ANALYZE") {
        const res = await fetch(`/api/tenders/${tenderId}/ai-analyze`, { method: "POST" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "AI Analyze failed");
        setActionMsg(json.fallback ? "Regex fallback used — approve below or retry when providers recover." : "Analysis complete.");
        await load();
        router.refresh();
      }
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
