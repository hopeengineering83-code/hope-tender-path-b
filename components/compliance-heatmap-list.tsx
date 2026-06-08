"use client";

import { useState } from "react";

const PREVIEW = 10;

type HeatmapStatus = "FULLY_MET" | "PARTIALLY_MET" | "NOT_MET" | "UNKNOWN";

const STATUS_STYLES: Record<HeatmapStatus, { row: string; badge: string; label: string }> = {
  FULLY_MET:     { row: "border-emerald-100 bg-emerald-50",  badge: "bg-emerald-100 text-emerald-700", label: "FULLY MET" },
  PARTIALLY_MET: { row: "border-amber-100 bg-amber-50",     badge: "bg-amber-100 text-amber-700",     label: "PARTIAL" },
  NOT_MET:       { row: "border-red-100 bg-red-50",         badge: "bg-red-100 text-red-700",          label: "NOT MET" },
  UNKNOWN:       { row: "border-slate-100 bg-slate-50",     badge: "bg-slate-100 text-slate-500",     label: "UNKNOWN" },
};

const RISK_STYLES: Record<string, string> = {
  HIGH:   "bg-red-100 text-red-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW:    "bg-slate-100 text-slate-600",
  NONE:   "bg-emerald-100 text-emerald-700",
};

export type HeatmapRow = {
  id: string;
  title: string;
  requirementType: string;
  priority: string;
  status: HeatmapStatus;
  risk: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  evidenceSource: string;
  notes: string | null;
};

function HeatmapRowItem({ row }: { row: HeatmapRow }) {
  const style = STATUS_STYLES[row.status];
  return (
    <div className={`rounded-xl border p-3 ${style.row}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-slate-900 text-sm">{row.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {row.requirementType} · Evidence: {row.evidenceSource}
          </p>
          {row.notes && (
            <p className="mt-1 text-xs text-slate-600 italic">{row.notes}</p>
          )}
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
            row.priority === "MANDATORY"
              ? "bg-red-100 text-red-700"
              : row.priority === "PREFERRED"
                ? "bg-blue-100 text-blue-700"
                : "bg-slate-100 text-slate-500"
          }`}>
            {row.priority}
          </span>
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${style.badge}`}>
            {style.label}
          </span>
          {row.risk !== "NONE" && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${RISK_STYLES[row.risk]}`}>
              {row.risk} RISK
            </span>
          )}
          {row.risk === "NONE" && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${RISK_STYLES.NONE}`}>
              LOW RISK
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ComplianceHeatmapList({ rows }: { rows: HeatmapRow[] }) {
  const [showAll, setShowAll] = useState(false);

  // HIGH RISK rows are always shown; others are subject to preview limit
  const highRiskRows = rows.filter((r) => r.risk === "HIGH");
  const otherRows = rows.filter((r) => r.risk !== "HIGH");
  const previewOthers = showAll
    ? otherRows
    : otherRows.slice(0, Math.max(0, PREVIEW - highRiskRows.length));
  const visible = [...highRiskRows, ...previewOthers];
  const hiddenCount = rows.length - visible.length;

  return (
    <>
      <div className="space-y-2">
        {visible.map((row) => <HeatmapRowItem key={row.id} row={row} />)}
      </div>
      {hiddenCount > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowAll((v) => !v)}
            className="text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            {showAll
              ? "▲ Show fewer"
              : `▼ Show all ${rows.length} requirements (${hiddenCount} more)`}
          </button>
        </div>
      )}
    </>
  );
}
