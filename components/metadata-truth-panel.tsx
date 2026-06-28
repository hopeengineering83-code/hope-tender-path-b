"use client";

import React, { useEffect, useState } from "react";
import type { MetadataTruthSummary, MetadataFactStatus } from "../lib/engine/analysis/metadata-truth";

// ─── Status badge config ────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { label: string; classes: string }> = {
  EXTRACTED_AND_GROUNDED:  { label: "Extracted and grounded",     classes: "bg-emerald-100 text-emerald-700" },
  MANUALLY_CONFIRMED_GROUNDED: { label: "Confirmed and grounded", classes: "bg-emerald-100 text-emerald-700" },
  EXTRACTED_UNVERIFIED:    { label: "Extracted — review evidence", classes: "bg-blue-100 text-blue-700" },
  MANUAL_OVERRIDE:         { label: "Manual candidate",             classes: "bg-amber-100 text-amber-700" },
  MANUALLY_CONFIRMED_UNGROUNDED: { label: "Confirmed — ungrounded", classes: "bg-amber-100 text-amber-700" },
  NOT_STATED:              { label: "Not stated in tender",        classes: "bg-slate-100 text-slate-600" },
  NOT_APPLICABLE:          { label: "Not applicable",              classes: "bg-slate-100 text-slate-500" },
  AMBIGUOUS_DATE:          { label: "Date ambiguous — confirm",    classes: "bg-orange-100 text-orange-700" },
  GENERIC_FIELD_LABEL:     { label: "Invalid extracted value",     classes: "bg-red-100 text-red-700" },
  INTERNAL_PLACEHOLDER:    { label: "Placeholder detected",        classes: "bg-red-100 text-red-700" },
  PORTAL_CONTAMINATION:    { label: "Contaminated — review",       classes: "bg-red-100 text-red-700" },
  INVALID_FORMAT:          { label: "Invalid format",              classes: "bg-red-100 text-red-700" },
  INVALID:                 { label: "Not detected",                classes: "bg-slate-100 text-slate-500" },
  BLOCKED:                 { label: "Blocked — resolve evidence",   classes: "bg-red-100 text-red-700" },
};

// ─── Metric card ─────────────────────────────────────────────────────────────

function MetricCard({
  label,
  numerator,
  denominator,
  tooltip,
}: {
  label: string;
  numerator: number;
  denominator: number;
  tooltip: string;
}) {
  const pct = denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
  const isGood = pct >= 80;
  const isMid = pct >= 50 && pct < 80;
  const colour = isGood ? "text-emerald-700" : isMid ? "text-amber-700" : "text-red-600";
  return (
    <div
      className="rounded-xl bg-slate-50 border border-slate-100 p-3"
      title={tooltip}
    >
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide leading-tight">
        {label}
      </p>
      <p className={`text-xl font-black ${colour}`}>
        {numerator}<span className="text-sm font-semibold text-slate-400"> / {denominator}</span>
      </p>
      <p className="text-[10px] text-slate-400">{pct}%</p>
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function MetadataTruthPanel({ tenderId }: { tenderId: string }) {
  const [data, setData] = useState<MetadataTruthSummary | null>(null);

  useEffect(() => {
    fetch(`/api/tenders/${tenderId}/workflow-center`)
      .then((res) => res.json())
      .then((json: { metadata?: MetadataTruthSummary }) => setData(json.metadata ?? null))
      .catch(console.error);
  }, [tenderId]);

  if (!data) {
    return <div className="animate-pulse h-32 bg-slate-50 rounded-xl border" />;
  }

  const { counts } = data;

  const metrics = [
    {
      label: "Metadata fields detected",
      numerator: counts.detected,
      denominator: counts.total,
      tooltip: "Fields where any valid value exists.",
    },
    {
      label: "Fields with evidence",
      numerator: counts.grounded,
      denominator: counts.total,
      tooltip: "Fields linked to verified tender-source evidence.",
    },
    {
      label: "Fields manually confirmed",
      numerator: counts.confirmed,
      denominator: counts.total,
      tooltip: "Fields explicitly confirmed by a human.",
    },
  ];

  const criticalEntries = Object.entries(data.fields).filter(([, f]) => f.isCritical);
  const hasBlockers = criticalEntries.some(([, f]) => f.blockerReason);

  return (
    <section className="mb-4 rounded-2xl border bg-white p-5 shadow-sm">
      <h2 className="text-sm font-bold text-slate-900 mb-1 uppercase tracking-wider">
        Metadata Truth Facts
      </h2>
      {hasBlockers && (
        <p className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Rule 3: Critical metadata remain blocked until source-grounded. Manual candidates and ungrounded confirmations do not unlock release.
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {metrics.map((m) => (
          <MetricCard key={m.label} {...m} />
        ))}
      </div>

      <div className="mt-5 space-y-1">
        {Object.entries(data.fields).map(([key, f]) => {
          const badgeCfg = STATUS_BADGE[f.status] ?? STATUS_BADGE.INVALID;
          return (
            <div
              key={key}
              className="py-1.5 border-b border-slate-50 last:border-0"
            >
              <div className="flex items-start justify-between gap-2 text-xs">
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-slate-700">{f.label}</span>
                  {f.isCritical && (
                    <span className="ml-1.5 text-[9px] font-bold uppercase text-red-500">Critical</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {f.value && (
                    <span
                      className="text-slate-400 truncate max-w-[160px] hidden sm:inline"
                      title={f.value}
                    >
                      {f.value.length > 50 ? f.value.slice(0, 50) + "…" : f.value}
                    </span>
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 font-bold text-[9px] whitespace-nowrap ${badgeCfg.classes}`}
                    title={f.blockerReason || undefined}
                  >
                    {badgeCfg.label}
                  </span>
                </div>
              </div>

              {f.blockerReason && (
                 <p className="mt-1 text-[10px] text-red-600 font-medium">{f.blockerReason}</p>
              )}

              {f.override && (
                <div className="mt-1 ml-2 pl-2 border-l-2 border-indigo-100 text-[10px] text-slate-500 space-y-0.5">
                  <p>
                    <span className="font-semibold text-indigo-600">Manual entry · ungrounded.</span>
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    {f.override.actor && <span>By: {f.override.actor}</span>}
                    {f.override.timestamp && (
                      <span>At: {new Date(f.override.timestamp).toLocaleString()}</span>
                    )}
                  </div>
                  {f.override.reason && <p>Reason: {f.override.reason}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
