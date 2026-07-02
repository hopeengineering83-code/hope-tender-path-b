"use client";

import React, { useEffect, useState } from "react";
import { clientLogger } from "@/lib/ui/client-logger";

export function SubmissionPlanTruthPanel({ tenderId }: { tenderId: string }) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/tenders/${tenderId}/workflow-center`)
      .then(res => res.json())
      .then(json => setData(json.plan))
      .catch((e: unknown) => clientLogger.error("fetch failed", e instanceof Error ? { message: e.message } : { error: String(e) }));
  }, [tenderId]);

  if (!data) return null;

  return (
    <div id="submission-plan" className={`mt-4 rounded-xl border p-4 ${data.isVerified ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
      <h3 className={`text-sm font-bold ${data.isVerified ? "text-green-900" : "text-amber-900"}`}>
        Submission Plan: {data.status.replace(/_/g, " ")}
      </h3>
      <p className="mt-1 text-xs text-slate-600">{data.reason}</p>
      <div className="mt-3 flex gap-4 text-[10px] font-bold uppercase">
          <span className="text-slate-500">Required: {data.totalRequired}</span>
          <span className="text-slate-500">Generated: {data.totalGenerated}</span>
      </div>
    </div>
  );
}
