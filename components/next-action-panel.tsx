"use client";

import React, { useEffect, useState } from "react";

export function NextActionPanel({ tenderId }: { tenderId: string }) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/tenders/${tenderId}/workflow-center`)
      .then(res => res.json())
      .then(json => setData(json))
      .catch(console.error);
  }, [tenderId]);

  if (!data) return <div className="animate-pulse h-32 bg-slate-50 rounded-2xl border mb-4" />;

  const workflow = data.workflow;

  return (
    <section className="mb-4 rounded-2xl border border-slate-900 bg-slate-900 p-5 shadow-sm text-white">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Current Objective</p>
      <h2 className="mt-1 text-xl font-bold">{workflow.label}</h2>
      <p className="mt-1 text-sm text-slate-300">{workflow.reason}</p>

      {workflow.nextAction && (
          <div className="mt-4">
              <button className="rounded-lg bg-white px-4 py-2 text-xs font-bold text-slate-900 hover:bg-slate-100 transition-colors">
                  {workflow.label} →
              </button>
          </div>
      )}
    </section>
  );
}
