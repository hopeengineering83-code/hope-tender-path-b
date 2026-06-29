"use client";

import React, { useEffect, useState } from "react";
import type { TenderReleaseSnapshot } from "../lib/engine/tender-release-snapshot";
import { CanonicalStatusIcon } from "./canonical-status-badge";
import type { CanonicalTenderReadiness } from "../lib/canonical-tender-readiness";

export function MetadataTruthPanel({
  tenderId,
  canonicalReadiness,
}: {
  tenderId: string;
  canonicalReadiness?: CanonicalTenderReadiness | null;
}) {
  const [snapshot, setSnapshot] = useState<TenderReleaseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/tenders/${tenderId}/workflow-center`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok && j.snapshot) setSnapshot(j.snapshot);
      })
      .finally(() => setLoading(false));
  }, [tenderId]);

  if (loading) return null;
  if (!snapshot) return null;

  const { metadata } = snapshot;

  return (
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" id="metadata-truth-panel">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {canonicalReadiness?.modules.metadata && <CanonicalStatusIcon status={canonicalReadiness.modules.metadata.state} />} Metadata Release Truth
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            The authoritative values that will be used in the final submission package.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metadata.fields.filter(f => f.status === "EXTRACTED_AND_GROUNDED" || f.status === "MANUAL_OVERRIDE" || f.status === "MANUAL_CONFIRMED").slice(0, 6).map((field) => (
          <div key={field.fieldKey} className="rounded-xl bg-slate-50 p-3">
            <p className="text-[10px] font-semibold uppercase text-slate-400">{field.label}</p>
            <p className="mt-1 text-xs font-medium text-slate-900 truncate" title={field.value || ""}>{field.value || "—"}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
