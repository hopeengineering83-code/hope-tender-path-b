"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types (mirror lib/engine/tender-lifecycle-orchestrator.ts) ───────────────

type LifecycleState =
  | "UPLOADED" | "EXTRACTED" | "AI_ANALYSIS_REQUIRED" | "AI_ANALYSIS_FAILED"
  | "ANALYSIS_FALLBACK_UNAPPROVED" | "ANALYSIS_READY_FOR_REVIEW" | "ANALYSIS_APPROVED"
  | "METADATA_INCOMPLETE" | "SOURCE_REFERENCES_INCOMPLETE" | "SUBMISSION_PLAN_REQUIRED"
  | "SUBMISSION_PLAN_READY" | "EVIDENCE_MATCHING_REQUIRED" | "EVIDENCE_MATCHED"
  | "DOCUMENT_GENERATION_REQUIRED" | "DOCUMENTS_GENERATED" | "OFFICIAL_ORIGINALS_REQUIRED"
  | "QUALITY_REVIEW_REQUIRED" | "AUTO_FINALIZE_REQUIRED" | "EXPORT_READINESS_BLOCKED"
  | "EXPORT_READY" | "ZIP_READY";

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
  const [data, setData] = useState<LifecycleResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

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

      {/* Regex fallback warning — prominent, non-blocking label */}
      {data.analysisStatus.source === "REGEX_FALLBACK_AI_ERROR" && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-2">
          <p className="text-xs font-semibold text-amber-800">
            ⚠ Analysis: Regex Fallback (AI unavailable) — confidence is low, not AI-validated.
            Generate Docs, Auto-finalize, and ZIP download are blocked until AI analysis succeeds or a human approves this fallback.
          </p>
        </div>
      )}

      {/* Primary Next Action */}
      <div className="border-b border-gray-100 bg-blue-50 px-5 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-blue-600">Primary Next Action</p>
        <p className="mt-0.5 text-sm font-semibold text-blue-900">{actionLabel}</p>
      </div>

      {/* Prioritized next steps — shows ordering context for key pre-generation gates */}
      {(() => {
        const steps: Array<{ label: string; done: boolean; warn?: boolean }> = [];
        const src = data.analysisStatus.source;
        const analysisOk = src === "AI" || src === "HUMAN_APPROVED_REGEX_FALLBACK";
        const metaOk = data.metadataStatus.criticalMissing.length === 0;
        const hasEvalCriteria = !data.metadataStatus.criticalMissing.includes("evaluationCriteria");
        const hasPlan = data.planStatus.hasExplicitPlan;
        const evidenceCoverage = data.evidenceStatus.coverageRatio ?? 0;

        steps.push({ label: analysisOk ? "✓ AI analysis approved" : src === "REGEX_FALLBACK_AI_ERROR" ? "⚠ Retry AI Analyze (regex fallback active)" : "Run AI Analyze", done: analysisOk, warn: src === "REGEX_FALLBACK_AI_ERROR" });
        steps.push({ label: metaOk && hasEvalCriteria ? "✓ Metadata complete (incl. evaluation criteria)" : "Complete metadata (especially evaluation criteria)", done: metaOk && hasEvalCriteria, warn: !hasEvalCriteria });
        steps.push({ label: hasPlan ? "✓ Submission plan built" : "Build submission plan", done: hasPlan });
        steps.push({ label: evidenceCoverage > 0 ? `✓ Evidence linked (${Math.round(evidenceCoverage * 100)}% covered)` : "Link mandatory evidence", done: evidenceCoverage > 0 });
        steps.push({ label: data.counts.plannedMissingDocs === 0 && data.counts.generatedNarrativeDocs > 0 ? "✓ Documents generated" : "Generate required documents", done: data.counts.plannedMissingDocs === 0 && data.counts.generatedNarrativeDocs > 0 });

        const anyIncomplete = steps.some((s) => !s.done);
        if (!anyIncomplete) return null;

        return (
          <div className="border-b border-gray-100 bg-gray-50 px-5 py-3">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">Workflow Steps (in order)</p>
            <ol className="space-y-1">
              {steps.map((step, i) => (
                <li key={i} className={`flex items-center gap-2 text-xs ${step.done ? "text-green-700" : step.warn ? "text-amber-700 font-medium" : "text-gray-700"}`}>
                  <span className={`shrink-0 h-4 w-4 rounded-full text-center leading-4 text-xs font-bold ${step.done ? "bg-green-100" : step.warn ? "bg-amber-100" : "bg-gray-200"}`}>
                    {i + 1}
                  </span>
                  {step.label}
                </li>
              ))}
            </ol>
          </div>
        );
      })()}

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
