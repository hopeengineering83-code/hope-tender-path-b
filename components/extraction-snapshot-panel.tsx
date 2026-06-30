"use client";

import React, { useEffect, useState } from "react";
import { ExtractionSnapshot } from "../lib/extraction-quality";
import { clientLogger } from "@/lib/ui/client-logger";

export function ExtractionSnapshotPanel({ tenderId }: { tenderId: string }) {
  const [snapshots, setSnapshots] = useState<ExtractionSnapshot[] | null>(null);

  useEffect(() => {
    fetch(`/api/tenders/${tenderId}/extraction-quality`)
      .then(res => res.json())
      .then(json => {
          // This assumes the route returns an array of snapshots or reports that can be converted
          setSnapshots(json.reports.map((r: any) => r.snapshot || r));
      })
      .catch((e: unknown) => clientLogger.error("fetch failed", e instanceof Error ? { message: e.message } : { error: String(e) }));
  }, [tenderId]);

  if (!snapshots) return null;

  return (
    <div className="mt-4 space-y-3">
      {snapshots.map(s => (
        <div key={s.fileId} className={`p-4 rounded-xl border ${s.consistencyStatus === "CONSISTENT" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
          <div className="flex justify-between items-start">
            <div>
              <h3 className={`text-sm font-bold ${s.consistencyStatus === "CONSISTENT" ? "text-emerald-900" : "text-red-900"}`}>
                Extraction: {s.consistencyStatus.replace(/_/g, " ")}
              </h3>
              <p className="text-xs text-slate-600 mt-1">
                Source pages: {s.sourcePageCount} | Stored status rows: {s.storedPageStatusCount}
              </p>
            </div>
            {s.consistencyStatus !== "CONSISTENT" && (
                <span className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white uppercase">Mismatch</span>
            )}
          </div>
          {s.consistencyStatus !== "CONSISTENT" && (
              <p className="mt-3 text-xs font-medium text-red-700">
                Extraction details are incomplete or inconsistent. Re-extract/rebuild page status before relying on AI analysis.
              </p>
          )}
        </div>
      ))}
    </div>
  );
}
