"use client";

import React, { useEffect, useState } from "react";
import { MetadataTruthSummary } from "../lib/engine/analysis/metadata-truth";

export function MetadataTruthPanel({ tenderId }: { tenderId: string }) {
  const [data, setData] = useState<MetadataTruthSummary | null>(null);

  useEffect(() => {
    fetch(`/api/tenders/${tenderId}/workflow-center`)
      .then(res => res.json())
      .then(json => setData(json.metadata))
      .catch(console.error);
  }, [tenderId]);

  if (!data) return <div className="animate-pulse h-32 bg-slate-50 rounded-xl border" />;

  const metrics = [
    { label: "Extraction Coverage", value: data.extractionCoverage },
    { label: "Canonical Readiness", value: data.readinessScore },
    { label: "Source Grounding", value: data.groundingCoverage },
    { label: "Manual Confirmation", value: data.confirmationCoverage },
  ];

  return (
    <section className="mb-4 rounded-2xl border bg-white p-5 shadow-sm">
      <h2 className="text-sm font-bold text-slate-900 mb-4 uppercase tracking-wider">Metadata Truth Facts</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {metrics.map(m => (
          <div key={m.label} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <p className="text-[10px] font-bold text-slate-500 uppercase">{m.label}</p>
            <p className="text-xl font-black text-slate-900">{Math.round(m.value * 100)}%</p>
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-2">
        {Object.entries(data.fields).map(([key, f]) => (
          <div key={key} className="flex items-center justify-between text-xs py-1 border-b border-slate-50 last:border-0">
            <span className="font-medium text-slate-700">{key}</span>
            <div className="flex items-center gap-2">
              <span className="text-slate-400 truncate max-w-[200px]">{f.value || "—"}</span>
              <MetadataStatusBadge status={f.status} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MetadataStatusBadge({ status }: { status: string }) {
    const config: Record<string, string> = {
        EXTRACTED_AND_GROUNDED: "bg-emerald-100 text-emerald-700",
        EXTRACTED_UNVERIFIED: "bg-blue-100 text-blue-700",
        MANUAL_CONFIRMED: "bg-emerald-100 text-emerald-700",
        AMBIGUOUS_SOURCE_TEXT: "bg-amber-100 text-amber-700",
        INTERNAL_PLACEHOLDER: "bg-red-100 text-red-700",
        PORTAL_CONTAMINATION: "bg-red-100 text-red-700",
        NOT_APPLICABLE: "bg-slate-100 text-slate-500"
    };
    return (
        <span className={`rounded px-1.5 py-0.5 font-bold text-[9px] uppercase ${config[status] || "bg-slate-100 text-slate-500"}`}>
            {status.replace(/_/g, " ")}
        </span>
    );
}
