// Submission Plan Completeness panel.
//
// Drops into the tender detail page next to the export-readiness panel.
// Answers the screenshot question "where are the missing 13 of 19 docs?"
// by rendering one row per planned file with a status badge and the
// recommended next action.

"use client";

import { useEffect, useState } from "react";

type Status =
  | "GENERATED"
  | "GENERATED_NEEDS_REVIEW"
  | "GENERATED_QUALITY_FAILED"
  | "PLANNED"
  | "OFFICIAL_ORIGINAL_REQUIRED"
  | "REPLACE_WITH_ORIGINAL"
  | "MISSING"
  | "OUTSIDE_PLAN"
  | "SUPERSEDED";

type Row = {
  key: string;
  exactFileName: string | null;
  documentId: string | null;
  name: string;
  documentType: string | null;
  format: string | null;
  envelope: "TECHNICAL" | "FINANCIAL" | "ADMIN";
  required: boolean;
  exactOrder: number | null;
  status: Status;
  generationStatus: string | null;
  validationStatus: string | null;
  reviewStatus: string | null;
  hasFileContent: boolean;
  hasStoragePath: boolean;
  officialOriginal: boolean;
  recommendedAction: string;
};

type Summary = {
  totalRequired: number;
  totalGenerated: number;
  totalMissing: number;
  totalOfficialOriginalsRequired: number;
  totalOutsidePlan: number;
  totalSuperseded: number;
  totalQualityFailed: number;
  envelopeBreakdown: { TECHNICAL: number; FINANCIAL: number; ADMIN: number };
  hasExplicitScope: boolean;
};

type Response = {
  success: true;
  tender: { id: string; title: string };
  summary: Summary;
  rows: Row[];
  warnings: string[];
};

const STATUS_BADGE: Record<Status, { label: string; tone: "ok" | "warn" | "bad" | "neutral" }> = {
  GENERATED: { label: "GENERATED", tone: "ok" },
  GENERATED_NEEDS_REVIEW: { label: "REVIEW NEEDED", tone: "warn" },
  GENERATED_QUALITY_FAILED: { label: "QUALITY FAILED", tone: "bad" },
  PLANNED: { label: "PLANNED", tone: "warn" },
  OFFICIAL_ORIGINAL_REQUIRED: { label: "ATTACH ORIGINAL", tone: "warn" },
  REPLACE_WITH_ORIGINAL: { label: "REPLACE WITH ORIGINAL", tone: "warn" },
  MISSING: { label: "MISSING", tone: "bad" },
  OUTSIDE_PLAN: { label: "OUTSIDE PLAN", tone: "warn" },
  SUPERSEDED: { label: "HISTORICAL", tone: "neutral" },
};

function toneClass(tone: "ok" | "warn" | "bad" | "neutral"): string {
  if (tone === "ok") return "bg-emerald-100 text-emerald-700";
  if (tone === "warn") return "bg-amber-100 text-amber-700";
  if (tone === "bad") return "bg-red-100 text-red-700";
  return "bg-slate-100 text-slate-500";
}

export function SubmissionPlanCompletenessPanel({ tenderId }: { tenderId: string }) {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHistorical, setShowHistorical] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/submission-plan`, { method: "GET" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Submission plan lookup failed (${res.status})`);
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load submission plan");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [tenderId]);

  if (loading) {
    return <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Loading submission plan completeness…</section>;
  }
  if (error || !data) {
    return <section className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">Could not load submission plan: {error ?? "no data"}</section>;
  }

  const visibleRows = showHistorical ? data.rows : data.rows.filter((r) => r.status !== "SUPERSEDED");

  return (
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" id="submission-plan-completeness">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Submission Plan Completeness</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            One row per required submission document with the exact status and recommended next action. Replaces the misleading &ldquo;Docs N/M&rdquo; counter with a full breakdown.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button type="button" onClick={() => void load()} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50" disabled={loading}>
            Re-check
          </button>
          {data.summary.totalSuperseded > 0 && (
            <label className="ml-2 inline-flex items-center gap-1 text-[11px] text-slate-500">
              <input type="checkbox" checked={showHistorical} onChange={(e) => setShowHistorical(e.target.checked)} />
              Show {data.summary.totalSuperseded} historical row(s)
            </label>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4 md:grid-cols-7">
        <div className="rounded-xl bg-slate-50 px-2 py-2">
          <p className="text-slate-500">Required</p>
          <p className="text-base font-bold text-slate-900">{data.summary.totalRequired}</p>
        </div>
        <div className="rounded-xl bg-emerald-50 px-2 py-2">
          <p className="text-slate-500">Generated</p>
          <p className="text-base font-bold text-emerald-700">{data.summary.totalGenerated}</p>
        </div>
        <div className="rounded-xl bg-red-50 px-2 py-2">
          <p className="text-slate-500">Missing</p>
          <p className={`text-base font-bold ${data.summary.totalMissing > 0 ? "text-red-700" : "text-emerald-700"}`}>{data.summary.totalMissing}</p>
        </div>
        <div className="rounded-xl bg-amber-50 px-2 py-2">
          <p className="text-slate-500">Originals</p>
          <p className="text-base font-bold text-amber-700">{data.summary.totalOfficialOriginalsRequired}</p>
        </div>
        <div className="rounded-xl bg-amber-50 px-2 py-2">
          <p className="text-slate-500">Outside plan</p>
          <p className={`text-base font-bold ${data.summary.totalOutsidePlan > 0 ? "text-amber-700" : "text-emerald-700"}`}>{data.summary.totalOutsidePlan}</p>
        </div>
        <div className="rounded-xl bg-red-50 px-2 py-2">
          <p className="text-slate-500">Quality failed</p>
          <p className={`text-base font-bold ${data.summary.totalQualityFailed > 0 ? "text-red-700" : "text-emerald-700"}`}>{data.summary.totalQualityFailed}</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-2 py-2">
          <p className="text-slate-500">Envelopes</p>
          <p className="text-xs font-semibold text-slate-700">T:{data.summary.envelopeBreakdown.TECHNICAL} · F:{data.summary.envelopeBreakdown.FINANCIAL} · A:{data.summary.envelopeBreakdown.ADMIN}</p>
        </div>
      </div>

      {data.warnings.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <ul className="list-disc space-y-1 pl-5">
            {data.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {!data.summary.hasExplicitScope && (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          No explicit submission plan detected for this tender (no exactFileNaming / exactFileOrder / per-requirement exactFileName). Outside-plan generated rows are listed below for visibility, but no missing-required check applies until the plan is extracted.
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-xs">
          <thead>
            <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">File / row</th>
              <th className="px-2 py-2">Envelope</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Recommended action</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => {
              const badge = STATUS_BADGE[row.status];
              return (
                <tr key={row.key} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-2 text-slate-400">{row.exactOrder ?? index + 1}</td>
                  <td className="px-2 py-2">
                    <div className="font-medium text-slate-900">{row.exactFileName ?? row.name}</div>
                    {row.exactFileName && row.exactFileName !== row.name && <div className="text-[10px] text-slate-400">{row.name}</div>}
                    {row.documentType && <div className="text-[10px] text-slate-400">{row.documentType}</div>}
                  </td>
                  <td className="px-2 py-2 text-[10px] font-medium text-slate-600">{row.envelope}</td>
                  <td className="px-2 py-2">
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${toneClass(badge.tone)}`}>{badge.label}</span>
                    {row.officialOriginal && <p className="mt-1 text-[10px] text-amber-600">Official original</p>}
                  </td>
                  <td className="px-2 py-2 text-slate-600">{row.recommendedAction}</td>
                </tr>
              );
            })}
            {visibleRows.length === 0 && (
              <tr><td colSpan={5} className="px-2 py-4 text-center text-slate-500">No rows to display.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
