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
  if (source === "HUMAN_APPROVED_REGEX_FALLBACK") return { label: "Regex (human-approved)", tone: "warn" };
  if (source === "REGEX_FALLBACK_AI_ERROR") return { label: "Regex fallback — unapproved", tone: "bad" };
  return { label: "Unknown", tone: "warn" };
}

export function CanonicalReadinessScoreWidget({ tenderId }: { tenderId: string }) {
  const [data, setData] = useState<ReadinessScoreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
        Loading canonical readiness score…
      </section>
    );
  }
  if (error || !data) {
    return (
      <section className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        Could not load canonical readiness score: {error ?? "no data"}
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
            Replaces the old DB-stored readiness percentage. This number is computed by the canonical readiness helper with hard caps applied (evidence=0 → ≤35, missing required docs → ≤50, regex fallback → ≤45, missing metadata → ≤60, quality-failed docs → ≤60, blocked export gate → ≤99).
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center text-xs">
          <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
            <p className="text-slate-500">Analysis</p>
            <p className={`font-semibold ${analysisTone.tone === "ok" ? "text-emerald-700" : analysisTone.tone === "warn" ? "text-amber-700" : "text-red-700"}`}>{analysisTone.label}</p>
          </div>
          <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
            <p className="text-slate-500">Metadata</p>
            <p className={`font-semibold ${data.summary.metadataCompletenessRatio >= 0.6 && data.summary.metadataPlaceholderCount === 0 ? "text-emerald-700" : "text-amber-700"}`}>
              {Math.round(data.summary.metadataCompletenessRatio * 100)}%
              {data.summary.metadataPlaceholderCount > 0 && <span className="ml-1 text-red-700">· {data.summary.metadataPlaceholderCount} TBC</span>}
            </p>
          </div>
          <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
            <p className="text-slate-500">Required docs</p>
            <p className={`font-semibold ${data.summary.missingRequiredDocuments === 0 && (data.summary.ungeneratedPlannedRequired ?? 0) === 0 ? "text-emerald-700" : "text-red-700"}`}>
              {data.summary.finalExportCandidates}/{data.summary.finalExportCandidates + data.summary.missingRequiredDocuments}
              {data.summary.missingRequiredDocuments > 0 && <span className="ml-1 text-[10px]">({data.summary.missingRequiredDocuments} missing)</span>}
            </p>
            {(data.summary.ungeneratedPlannedRequired ?? 0) > 0 && (
              <p className="mt-0.5 text-[10px] text-amber-700">
                {data.summary.ungeneratedPlannedRequired} planned (not generated)
              </p>
            )}
          </div>
          <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
            <p className="text-slate-500">Quality</p>
            <p className={`font-semibold ${data.summary.qualityFailedDocuments === 0 ? "text-emerald-700" : "text-red-700"}`}>
              {data.summary.qualityFailedDocuments === 0 ? "OK" : `${data.summary.qualityFailedDocuments} failed`}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white">
        <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.min(100, Math.max(0, data.score))}%` }} />
      </div>

      {data.capReason && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">Score capped{data.capScore != null ? ` at ${data.capScore}` : ""}{data.capDimension ? ` (${data.capDimension.replace(/_/g, " ")})` : ""}:</span>{" "}
          {data.capReason}
        </p>
      )}

      {(data.summary.outsidePlanDocuments > 0 || data.summary.staleRowCount > 0) && (
        <p className="mt-2 text-[11px] text-slate-500">
          {data.summary.outsidePlanDocuments > 0 && <>{data.summary.outsidePlanDocuments} outside-plan doc(s); </>}
          {data.summary.staleRowCount > 0 && <>{data.summary.staleRowCount} historical/superseded row(s) hidden from package logic but auditable.</>}
        </p>
      )}
    </section>
  );
}
