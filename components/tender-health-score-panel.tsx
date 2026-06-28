"use client";

import { useState, useEffect, useCallback } from "react";
import { type ReleaseSnapshot } from "../lib/engine/release-snapshot";
import { CheckCircleIcon, AlertCircleIcon, RefreshIcon } from "./icons";

/**
 * Tender Health Score Panel
 *
 * Consumes the unified ReleaseSnapshot.
 * Rule 8: Separate labels for extraction quality, job status, etc.
 */
export function TenderHealthScorePanel({ tenderId }: { tenderId: string, canonicalReadiness?: any }) {
  const [snapshot, setSnapshot] = useState<ReleaseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/release-snapshot`);
      const data = await res.json();
      if (data.ok) setSnapshot(data.snapshot);
    } catch (err) {
      console.error("Health score load failed:", err);
    } finally {
      setLoading(false);
    }
  }, [tenderId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !snapshot) return <div className="animate-pulse h-40 bg-slate-100 rounded-2xl" />;
  if (!snapshot) return null;

  const { eligibility, extraction, analysis, metadata, requirements, buildPlan } = snapshot;

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">Bid Package Health</h2>
          <p className="text-xs text-slate-500 font-medium">Authoritative release readiness metrics</p>
        </div>
        <button onClick={load} className="p-1.5 hover:bg-slate-50 rounded-lg">
          <RefreshIcon className={`w-4 h-4 text-slate-400 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <HealthMetric label="Extraction" value={extraction.overallSeverity} ok={extraction.overallSeverity === "GOOD"} />
        <HealthMetric label="AI Job" value={analysis.state.replace(/_/g, " ")} ok={analysis.state === "AI_SUCCEEDED"} />
        <HealthMetric label="Metadata" value={`${metadata.groundedFields}/${metadata.totalFields}`} ok={metadata.groundedFields === metadata.totalFields} />
        <HealthMetric label="Traceability" value={`${requirements.traced}/${requirements.mandatory}`} ok={requirements.traced === requirements.mandatory} />
        <HealthMetric label="Evidence" value={`${requirements.evidenceCovered}/${requirements.mandatory}`} ok={requirements.evidenceCovered >= requirements.mandatory} />
        <HealthMetric label="Plan" value={`${buildPlan.generatedDocumentCount}/${buildPlan.plannedDocumentCount}`} ok={buildPlan.generatedDocumentCount >= buildPlan.plannedDocumentCount && buildPlan.plannedDocumentCount > 0} />
      </div>

      {!eligibility.readyForFinalZip && (
        <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3">
          <AlertCircleIcon className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-red-800">Final Release Blocked</p>
            <p className="mt-1 text-[10px] text-red-700 leading-normal">
              One or more release gates failed. Documents generated from ungrounded metadata or fallback analysis are blocked from final export.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function HealthMetric({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="p-3 rounded-xl border border-slate-100 bg-slate-50/50">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
      <div className={`mt-1 flex items-center gap-1.5 ${ok ? "text-emerald-700" : "text-amber-700"}`}>
        {ok ? <CheckCircleIcon className="w-3.5 h-3.5" /> : <AlertCircleIcon className="w-3.5 h-3.5" />}
        <span className="text-xs font-bold truncate">{value}</span>
      </div>
    </div>
  );
}
