"use client";

import { useState, useEffect, useCallback } from "react";
import { type ReleaseSnapshot } from "../lib/engine/release-snapshot";
import { AlertCircleIcon, CheckCircleIcon, RefreshIcon } from "./icons";

/**
 * Tender Recovery Command Center
 *
 * Consumes the unified ReleaseSnapshot for honest status reporting.
 * Rule 8: Separate labels for extraction, job status, grounding, etc.
 */
export default function TenderRecoveryCommandCenter({ tenderId }: { tenderId: string }) {
  const [snapshot, setSnapshot] = useState<ReleaseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSnapshot = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/release-snapshot`);
      const data = await res.json();
      if (data.ok) setSnapshot(data.snapshot);
    } catch (err) {
      console.error("Failed to fetch snapshot:", err);
    } finally {
      setLoading(false);
    }
  }, [tenderId]);

  useEffect(() => {
    fetchSnapshot();
  }, [fetchSnapshot]);

  if (loading && !snapshot) return <div className="animate-pulse h-40 bg-slate-100 rounded-2xl" />;
  if (!snapshot) return null;

  const { eligibility, extraction, analysis, metadata } = snapshot;

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="bg-slate-900 px-5 py-3 flex items-center justify-between text-white">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider">System Recovery & Diagnostics</h2>
          <p className="text-[10px] text-slate-400">Authoritative server-side state for tender ${tenderId}</p>
        </div>
        <button onClick={fetchSnapshot} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
          <RefreshIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatusItem label="Extraction" value={extraction.overallSeverity} ok={extraction.overallSeverity === "GOOD"} />
          <StatusItem label="AI Analysis" value={analysis.state.replace(/_/g, " ")} ok={analysis.state === "AI_SUCCEEDED"} />
          <StatusItem label="Metadata" value={`${metadata.groundedFields}/${metadata.totalFields} Grounded`} ok={metadata.groundedFields === metadata.totalFields} />
          <StatusItem label="Eligibility" value={eligibility.readyForFinalZip ? "READY" : "BLOCKED"} ok={eligibility.readyForFinalZip} />
        </div>

        {eligibility.blockers.length > 0 && (
          <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded-xl">
            <p className="text-[10px] font-black uppercase text-red-600 mb-2 tracking-widest">Active Blockers</p>
            <ul className="space-y-1.5">
              {eligibility.blockers.map(b => (
                <li key={b.code} className="text-xs text-red-800 flex items-start gap-2 font-medium leading-relaxed">
                  <AlertCircleIcon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {b.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-[10px] text-slate-400 italic">
          Rule 1: Unified server-side release snapshot. Diagnostic tools consume the same truth as release gates.
        </p>
      </div>
    </section>
  );
}

function StatusItem({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">{label}</p>
      <div className={`flex items-center gap-1.5 ${ok ? "text-emerald-700" : "text-red-700"}`}>
        {ok ? <CheckCircleIcon className="w-3.5 h-3.5" /> : <AlertCircleIcon className="w-3.5 h-3.5" />}
        <span className="text-xs font-bold truncate">{value}</span>
      </div>
    </div>
  );
}
