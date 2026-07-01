"use client";

import React, { useEffect, useState } from "react";

export function AuthorityReviewTruthPanel({ tenderId }: { tenderId: string }) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/tenders/${tenderId}/workflow-center`)
      .then(res => res.json())
      .then(json => setData(json.authority))
      .catch(console.error);
  }, [tenderId]);

  if (!data) return null;

  return (
    <div className={`mt-4 rounded-xl border p-4 ${data.status === "AUTHORITY_READY" ? "border-green-200 bg-green-50" : "border-slate-200 bg-slate-50"}`}>
      <h3 className={`text-sm font-bold ${data.status === "AUTHORITY_READY" ? "text-green-900" : "text-slate-900"}`}>
        Authority Review: {data.status.replace(/_/g, " ")}
      </h3>
      <p className="mt-1 text-xs text-slate-600">{data.reason}</p>
      {data.status === "AUTHORITY_READY" && (
          <p className="mt-2 text-[10px] font-bold text-green-700 uppercase">Score: {data.score}/100</p>
      )}
    </div>
  );
}
