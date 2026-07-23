"use client";

import React, { useEffect, useState } from "react";
import type { TenderReleaseSnapshot } from "../lib/engine/tender-release-snapshot";
import type { CanonicalFieldStatus } from "../lib/engine/canonical-field-state";
import { clientLogger } from "@/lib/ui/client-logger";
import { CANONICAL_FIELD_STATUS_BADGE as STATUS_BADGE } from "./canonical-field-status-badge";

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
  const colour = isGood ? "text-emerald-700" : isMid ? "text-amber-800" : "text-red-600";
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

export function SourceGroundedTenderFactsPanel({ tenderId }: { tenderId: string }) {
  const [snapshot, setSnapshot] = useState<TenderReleaseSnapshot | null>(null);
  const [snapshotRevision, setSnapshotRevision] = useState<string>("");

  useEffect(() => {
    fetch(`/api/tenders/${tenderId}/workflow-center`)
      .then((res) => res.json())
      .then((json: { snapshot?: TenderReleaseSnapshot }) => {
        if (json.snapshot) {
          setSnapshot(json.snapshot);
          setSnapshotRevision(json.snapshot.snapshotRevision);
        }
      })
      .catch((e: unknown) => clientLogger.error("fetch failed", e instanceof Error ? { message: e.message } : { error: String(e) }));
  }, [tenderId]);

  if (!snapshot) {
    return <div className="animate-pulse h-32 bg-slate-50 rounded-xl border" />;
  }

  const metadata = snapshot.metadata;
  const fields = metadata.fields;

  // These are different concepts — the spec requires them shown separately
  const metrics = [
    {
      label: "Tender Details fields",
      numerator: metadata.validFields + metadata.groundedFields,
      denominator: metadata.totalFields,
      tooltip:
        "Fields with a value that passes format and content validation (not a placeholder, field label, or invalid format).",
    },
    {
      label: "Fields with evidence",
      numerator: metadata.groundedFields,
      denominator: metadata.totalFields,
      tooltip:
        "Valid fields linked to a source page and/or verbatim quote from the tender document. A field is only grounded when both value and evidence exist.",
    },
    {
      label: "Final-check items",
      numerator: metadata.blockedFields,
      denominator: metadata.totalFields,
      tooltip:
        "These details affect Final Submission Check only. Draft generation can continue.",
    },
  ];

  const hasExportBlockers = metadata.hasExportBlocker;
  const hasBlockers = metadata.blockedFields > 0;

  return (
    <section className="mb-4 rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
          Source-Grounded Tender Facts
        </h2>
        <span className="text-[10px] text-slate-400 font-mono">rev: {snapshotRevision.slice(0, 8)}</span>
      </div>
      {hasBlockers && (
        <p className="mb-4 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          These details affect Final Submission Check only. Draft generation can continue.
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {metrics.map((m) => (
          <MetricCard key={m.label} {...m} />
        ))}
      </div>

      <div className="mt-5 space-y-1">
        {fields.map((f) => {
          const badgeCfg = STATUS_BADGE[f.status] ?? STATUS_BADGE.INVALID;
          return (
            <div
              key={f.fieldKey}
              className="py-1.5 border-b border-slate-50 last:border-0"
            >
              <div className="flex items-start justify-between gap-2 text-xs">
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-slate-700">{f.label}</span>
                  {(f.requiredForFinal ?? (f.criticality === "always-critical")) && (
                    <span className="ml-1.5 text-[9px] font-bold uppercase text-red-500">Critical</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {f.effectiveValue && (
                    <span
                      className="text-slate-400 truncate max-w-[160px] hidden sm:inline"
                      title={f.effectiveValue}
                    >
                      {f.effectiveValue.length > 50 ? f.effectiveValue.slice(0, 50) + "…" : f.effectiveValue}
                    </span>
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 font-bold text-[9px] whitespace-nowrap ${badgeCfg.classes}`}
                    title={f.blockerReason ?? undefined}
                  >
                    {badgeCfg.label}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Backward-compat alias — use SourceGroundedTenderFactsPanel in new code.
export const MetadataTruthPanel = SourceGroundedTenderFactsPanel;
