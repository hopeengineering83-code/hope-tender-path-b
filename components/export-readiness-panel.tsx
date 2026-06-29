"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { CanonicalStatusBadge, CanonicalStatusIcon } from "./canonical-status-badge";
import type { CanonicalTenderReadiness } from "../lib/canonical-tender-readiness";
import { SnapshotConsistencyBadge } from "./snapshot-consistency-badge";

export function ExportReadinessPanel({
  tenderId,
  canonicalReadiness,
}: {
  tenderId: string;
  canonicalReadiness?: CanonicalTenderReadiness | null;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/tenders/${tenderId}/export-readiness`)
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setData(j.exportReadiness);
      })
      .finally(() => setLoading(false));
  }, [tenderId]);

  if (loading) return <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm animate-pulse">Checking export readiness…</section>;
  if (!data) return null;

  const exportState = canonicalReadiness?.modules.export.state ?? "NOT_RUN";
  const ok = exportState === "READY";

  return (
    <section id="export-readiness" className={`mb-4 rounded-2xl border p-5 shadow-sm ${ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${ok ? "text-emerald-700" : "text-red-700"}`}>
            {canonicalReadiness?.modules.export && <CanonicalStatusIcon status={canonicalReadiness.modules.export.state} />} Export readiness
          </p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">{ok ? "Ready for final package export" : "Final export is blocked"}</h2>
          <p className="mt-1 text-sm text-slate-600">The canonical export gate ensures documents are validated, requirements are grounded, and the submission plan is complete.</p>
          <SnapshotConsistencyBadge tenderId={tenderId} verdict="export" localEligible={ok} />
        </div>
        <div className="flex items-center gap-2">
           <CanonicalStatusBadge status={exportState} />
           <Link href={`/api/tenders/${tenderId}/export-readiness`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">Open JSON</Link>
        </div>
      </div>

      {!ok && data.tenderLevelBlockers?.length > 0 && (
        <div className="mt-4 space-y-2">
          {data.tenderLevelBlockers.map((b: any, i: number) => (
            <div key={i} className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs text-red-800">
              <p className="font-bold">{b.title}</p>
              <p className="mt-0.5 text-slate-500">{b.recommendedAction}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
