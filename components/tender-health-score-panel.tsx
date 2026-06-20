"use client";

import React, { useEffect, useState } from "react";
import { CanonicalStatusBadge } from "./canonical-status-badge";

export function TenderHealthScorePanel({ tenderId, canonicalReadiness }: { tenderId: string; canonicalReadiness?: any }) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/tenders/${tenderId}/workflow-center`)
      .then(res => res.json())
      .then(json => setData(json))
      .catch(console.error);
  }, [tenderId]);

  if (!data) return <div className="animate-pulse h-48 bg-slate-50 rounded-2xl border mb-4" />;

  const healthPct = Math.round(data.metadata.readinessScore * 100);
  const healthColor = healthPct >= 80 ? "text-emerald-700" : healthPct >= 50 ? "text-amber-700" : "text-red-700";
  const healthBg = healthPct >= 80 ? "border-emerald-200 bg-emerald-50" : healthPct >= 50 ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50";

  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${healthBg}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Truth Health Summary</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`text-4xl font-extrabold ${healthColor}`}>{healthPct}</span>
            <span className="text-lg text-slate-400">/100</span>
            <CanonicalStatusBadge status={data.workflow.extractionState} size="sm" />
          </div>
          <p className="mt-1 text-sm text-slate-600">Unified health based on persisted canonical data. This score reflects the overall readiness of the tender metadata and documents.</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border bg-white p-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase">Analysis</p>
              <p className="text-sm font-bold text-slate-900">{data.analysis.state.replace(/_/g, ' ')}</p>
          </div>
          <div className="rounded-xl border bg-white p-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase">Plan</p>
              <p className="text-sm font-bold text-slate-900">{data.plan.status.replace(/_/g, ' ')}</p>
          </div>
          <div className="rounded-xl border bg-white p-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase">Authority</p>
              <p className="text-sm font-bold text-slate-900">{data.authority.status.replace(/_/g, ' ')}</p>
          </div>
          <div className="rounded-xl border bg-white p-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase">Metadata</p>
              <p className="text-sm font-bold text-slate-900">{Math.round(data.metadata.readinessScore * 100)}% Ready</p>
          </div>
      </div>
    </section>
  );
}
