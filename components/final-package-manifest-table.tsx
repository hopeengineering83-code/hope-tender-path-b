"use client";

import { useState } from "react";
import { CheckIcon, CrossIcon, ChevronDownIcon } from "./icons";

export type ManifestRow = {
  id: string;
  fileName: string;
  envelope: string;
  outputState: string;
  includedInZip: boolean;
  excludedReason: string | null;
  inPlan: boolean | null;
};

function StatusBadge({ state }: { state: string }) {
  if (state === "READY_FOR_EXPORT")
    return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Ready</span>;
  if (state === "VALIDATED" || state === "DOCX_GENERATED" || state === "PDF_GENERATED")
    return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Not approved</span>;
  if (state === "SUPERSEDED")
    return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Superseded</span>;
  if (state === "ORIGINAL_REQUIRED")
    return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Original required</span>;
  if (state === "NEEDS_REVALIDATION")
    return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Needs revalidation</span>;
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Pending</span>;
}

function ManifestTableRow({ row }: { row: ManifestRow }) {
  return (
    <tr className={`border-b border-slate-100 ${!row.includedInZip ? "opacity-60" : ""}`}>
      <td className="py-2 pr-4 font-medium text-slate-900 max-w-[220px] truncate" title={row.fileName}>
        {row.fileName}
      </td>
      <td className="py-2 pr-4 text-slate-600">{row.envelope}</td>
      <td className="py-2 pr-4 text-center">
        {row.inPlan === null
          ? <span className="text-slate-400">—</span>
          : row.inPlan
            ? <span className="inline-flex items-center gap-0.5 text-emerald-600 font-medium"><CheckIcon /> In plan</span>
            : <span className="text-amber-600 font-medium">Outside plan</span>
        }
      </td>
      <td className="py-2 pr-4"><StatusBadge state={row.outputState} /></td>
      <td className="py-2 pr-4 text-center">
        {row.includedInZip
          ? <span className="inline-flex items-center justify-center text-emerald-600 font-bold"><CheckIcon /></span>
          : <span className="inline-flex items-center justify-center text-red-600 font-bold"><CrossIcon /></span>
        }
      </td>
      <td className="py-2 text-slate-500 max-w-[260px]">
        {row.excludedReason ?? <span className="text-emerald-600">Included</span>}
      </td>
    </tr>
  );
}

export function FinalPackageManifestTable({
  rows,
}: {
  rows: ManifestRow[];
}) {
  const [showExcluded, setShowExcluded] = useState(false);

  const includedRows = rows.filter((r) => r.includedInZip);
  const excludedRows = rows.filter((r) => !r.includedInZip);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500 uppercase tracking-wide">
            <th className="py-2 pr-4 font-semibold">File name</th>
            <th className="py-2 pr-4 font-semibold">Envelope</th>
            <th className="py-2 pr-4 font-semibold text-center">In plan</th>
            <th className="py-2 pr-4 font-semibold">Status</th>
            <th className="py-2 pr-4 font-semibold text-center">In ZIP</th>
            <th className="py-2 font-semibold">Reason if excluded</th>
          </tr>
        </thead>
        <tbody>
          {includedRows.map((row) => <ManifestTableRow key={row.id} row={row} />)}
          {excludedRows.length > 0 && (
            <tr>
              <td colSpan={6} className="py-2">
                <button
                  onClick={() => setShowExcluded((v) => !v)}
                  className="text-xs font-medium text-slate-500 hover:text-slate-800"
                >
                  {showExcluded
                    ? <><ChevronDownIcon className="rotate-180 inline-block" /> Hide {excludedRows.length} excluded document{excludedRows.length !== 1 ? "s" : ""}</>
                    : <><ChevronDownIcon className="inline-block" /> Show {excludedRows.length} excluded document{excludedRows.length !== 1 ? "s" : ""}</>}
                </button>
              </td>
            </tr>
          )}
          {showExcluded && excludedRows.map((row) => <ManifestTableRow key={row.id} row={row} />)}
        </tbody>
      </table>
    </div>
  );
}
