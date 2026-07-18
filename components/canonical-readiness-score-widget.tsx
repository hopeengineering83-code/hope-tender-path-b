// Canonical Readiness Score widget.
//
// Fetches /api/tenders/[id]/readiness-score and renders the gated score
// alongside the cap reason. Designed to drop into the existing
// tender-detail header so the user sees the TRUE readiness (e.g. 35%
// "Evidence coverage is 0%") instead of the misleading 100% the
// dashboard previously showed from the stale DB column.
//
// Surfaces the most-restrictive cap reason as an amber banner, plus a
// compact breakdown of the gate signals (missing required docs, metadata
// placeholder count, etc.) so the user knows exactly what to fix.

"use client";

import { useEffect, useState } from "react";
import { SnapshotConsistencyBadge } from "./snapshot-consistency-badge";
import { useWorkflowState } from "../lib/ui/tender-workflow-sync";

type ReadinessSeverity = "READY" | "PARTIAL" | "BLOCKED";

type ReadinessSummary = {
  ok: boolean;
  readinessScore: number;
  capReason: string | null;
  analysisSource: "AI" | "REGEX_FALLBACK_AI_ERROR" | "HUMAN_APPROVED_REGEX_FALLBACK" | "UNKNOWN";
  metadataCompletenessRatio: number;
  missingCriticalMetadataCount: number;
  metadataPlaceholderCount: number;
  missingRequiredDocuments: number;
  outsidePlanDocuments: number;
  finalExportCandidates: number;
  workspaceDocuments: number;
  staleRowCount: number;
  qualityFailedDocuments: number;
  documentBlockers: number;
  tenderLevelBlockers: number;
  advisoryWarnings: number;
  envelopeBreakdown: { TECHNICAL?: number; FINANCIAL?: number; ADMIN?: number };
  strictTwoEnvelope: boolean;
  planStatus: string;
  ungeneratedPlannedRequired?: number;
  missingCriticalMetadataFields?: string[];
  // ── Canonical required-document model ───────────────────────────────
  requiredDocumentsTotal?: number;
  exportReadyDocumentsTotal?: number;
  plannedRequiredDocuments?: number;
  generatedDocumentsTotal?: number;
  totalBlockers?: number;
  primaryBlockerReason?: string | null;
  primaryFixAction?: string | null;
};

type ReadinessScoreResponse = {
  ok: boolean;
  score: number;
  severity: ReadinessSeverity;
  capReason: string | null;
  capDimension: string | null;
  capScore: number | null;
  summary: ReadinessSummary;
};

function severityToClass(score: number): { text: string; bg: string; bar: string; label: ReadinessSeverity } {
  if (score >= 80) return { text: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", bar: "bg-emerald-500", label: "READY" };
  if (score >= 50) return { text: "text-amber-700", bg: "bg-amber-50 border-amber-200", bar: "bg-amber-400", label: "PARTIAL" };
  return { text: "text-red-700", bg: "bg-red-50 border-red-200", bar: "bg-red-500", label: "BLOCKED" };
}

function analysisSourceLabel(source: ReadinessSummary["analysisSource"]): { label: string; tone: "ok" | "warn" | "bad" } {
  if (source === "AI") return { label: "AI", tone: "ok" };
  if (source === "HUMAN_APPROVED_REGEX_FALLBACK") return { label: "Approved for draft review only", tone: "warn" };
  if (source === "REGEX_FALLBACK_AI_ERROR") return { label: "Untrusted extraction", tone: "bad" };
  return { label: "Unknown", tone: "warn" };
}

export function CanonicalReadinessScoreWidget({ tenderId }: { tenderId: string }) {
  const [data, setData] = useState<ReadinessScoreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Consume shared workflow state for consistent blocker display.
  const sharedState = useWorkflowState();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/tenders/${tenderId}/readiness-score`, { method: "GET" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? `Readiness score lookup failed (${res.status})`);
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load readiness score");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenderId]);

  if (loading) {
    return (
      <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-busy="true">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 animate-pulse rounded-full bg-slate-200" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-40 animate-pulse rounded bg-slate-200" />
            <div className="h-5 w-24 animate-pulse rounded bg-slate-200" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      </section>
    );
  }
  if (error || !data) {
    return (
      <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        <p className="font-semibold">Readiness check unavailable</p>
        <p className="mt-1 text-xs">Refresh to retry. If the problem persists, contact admin.</p>
        <button
          type="button"
          onClick={() => { setError(null); setLoading(true); }}
          className="mt-2 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800"
        >
          Retry
        </button>
      </section>
    );
  }

  const tone = severityToClass(data.score);
  const analysisTone = analysisSourceLabel(data.summary.analysisSource);

  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${tone.bg}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Canonical readiness score</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`text-4xl font-bold ${tone.text}`}>{data.score}</span>
            <span className="text-base text-slate-500">/ 100</span>
            <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-bold ${tone.text} bg-white/70`}>{tone.label}</span>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-slate-600">
            Replaces the old DB-stored readiness percentage. This number is computed by the canonical readiness helper with hard caps applied (evidence=0 → ≤35, missing required docs → ≤50, regex fallback → ≤45, quality-failed docs → ≤60, blocked export gate → ≤99).
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center text-xs">
          <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
            <p className="text-slate-500">Analysis</p>
            <p className={`font-semibold ${analysisTone.tone === "ok" ? "text-emerald-700" : analysisTone.tone === "warn" ? "text-amber-700" : "text-red-700"}`}>{analysisTone.label}</p>
          </div>
          <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
            <p className="text-slate-500">Required docs</p>
            {(() => {
              // Use the canonical required-document model from the API.
              // requiredDocumentsTotal includes BOTH confirmed-plan items AND
              // ungenerated PLANNED docs — so it's never 0 when PLANNED docs exist.
              // exportReadyDocumentsTotal is the numerator (validated+approved docs).
              const total = data.summary.requiredDocumentsTotal ?? (data.summary.finalExportCandidates + data.summary.missingRequiredDocuments);
              const exportReady = data.summary.exportReadyDocumentsTotal ?? data.summary.finalExportCandidates;
              const ungenerated = data.summary.plannedRequiredDocuments ?? data.summary.ungeneratedPlannedRequired ?? 0;
              const missing = data.summary.missingRequiredDocuments;
              const hasIssues = missing > 0 || ungenerated > 0 || exportReady < total;
              if (total === 0) {
                return <p className="font-semibold text-slate-400">No required docs</p>;
              }
              return (
                <>
                  <p className={`font-semibold ${hasIssues ? "text-red-700" : "text-emerald-700"}`}>
                    {exportReady}/{total} export ready
                    {missing > 0 && <span className="ml-1 text-[10px]">({missing} missing)</span>}
                  </p>
                  {ungenerated > 0 && (
                    <p className="mt-0.5 text-[10px] text-amber-700">
                      {ungenerated} planned, not generated
                    </p>
                  )}
                </>
              );
            })()}
          </div>
          <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
            <p className="text-slate-500">Quality</p>
            <p className={`font-semibold ${data.summary.qualityFailedDocuments === 0 ? "text-emerald-700" : "text-red-700"}`}>
              {data.summary.qualityFailedDocuments === 0 ? "OK" : `${data.summary.qualityFailedDocuments} failed`}
            </p>
          </div>
          <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
            <p className="text-slate-500">Export blockers</p>
            {(() => {
              const totalBlockers = data.summary.totalBlockers ?? (data.summary.documentBlockers + data.summary.tenderLevelBlockers);
              const primaryReason = data.summary.primaryBlockerReason;
              if (totalBlockers === 0) {
                return <p className="font-semibold text-emerald-700">Clear</p>;
              }
              return (
                <>
                  <p className="font-semibold text-red-700">{totalBlockers} blocker(s)</p>
                  {primaryReason && (
                    <p className="mt-0.5 text-[10px] text-red-600" title={primaryReason}>
                      {primaryReason.length > 60 ? primaryReason.slice(0, 57) + "…" : primaryReason}
                    </p>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white">
        <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.min(100, Math.max(0, data.score))}%` }} />
      </div>

      {/* Additive honest-UI overlay: surface the authoritative release-snapshot
          export verdict + revision alongside this score so both are seen to
          read the same generation of truth. Read-only (a 0–100 score is not a
          boolean verdict, so no mismatch warning is asserted here). */}
      <SnapshotConsistencyBadge tenderId={tenderId} verdict="export" />

      {data.capReason && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">Score capped{data.capScore != null ? ` at ${data.capScore}` : ""}{data.capDimension ? ` (${data.capDimension.replace(/_/g, " ")})` : ""}:</span>{" "}
          {data.capReason}
        </p>
      )}

      {data.summary.primaryBlockerReason && (
        <div className="mt-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs">
          <p className="font-semibold text-red-700">Primary blocker: {data.summary.primaryBlockerReason}</p>
          {data.summary.primaryFixAction && (
            <p className="mt-0.5 text-red-600">Next action: {data.summary.primaryFixAction}</p>
          )}
        </div>
      )}



      {(data.summary.outsidePlanDocuments > 0 || data.summary.staleRowCount > 0) && (
        <details className="mt-2 text-[11px] text-slate-400">
          <summary className="cursor-pointer">Audit details</summary>
          <p className="mt-1">
            {data.summary.outsidePlanDocuments > 0 && <>{data.summary.outsidePlanDocuments} outside-plan doc(s); </>}
            {data.summary.staleRowCount > 0 && <>{data.summary.staleRowCount} historical/superseded row(s) hidden from package logic but auditable.</>}
          </p>
        </details>
      )}
    </section>
  );
}
