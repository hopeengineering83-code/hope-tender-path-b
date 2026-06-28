"use client";

import { useEffect, useState } from "react";
import { type ReleaseSnapshot } from "../lib/engine/release-snapshot";

/**
 * Canonical Readiness Score Widget
 *
 * Consumes the unified ReleaseSnapshot.
 * Rule 1: One server-side release snapshot.
 * Rule 8: Honest UI wording.
 */
export function CanonicalReadinessScoreWidget({ tenderId }: { tenderId: string }) {
  const [snapshot, setSnapshot] = useState<ReleaseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSnapshot() {
      try {
        const res = await fetch(`/api/tenders/${tenderId}/release-snapshot`);
        const data = await res.json();
        if (data.ok) setSnapshot(data.snapshot);
      } catch (err) {
        console.error("Failed to fetch snapshot:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchSnapshot();
  }, [tenderId]);

  if (loading) return <div className="animate-pulse h-20 bg-slate-100 rounded-xl" />;
  if (!snapshot) return null;

  const { eligibility, extraction, analysis, metadata, requirements } = snapshot;

  // Simple readiness percentage for the bar
  const score = Math.round(
    (metadata.groundedFields / metadata.totalFields) * 40 +
    (requirements.traced / Math.max(1, requirements.mandatory)) * 40 +
    (analysis.state === "AI_SUCCEEDED" ? 20 : 0)
  );

  const isReady = eligibility.readyForFinalZip;

  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${isReady ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Release Eligibility Truth</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`text-4xl font-bold ${isReady ? "text-emerald-700" : "text-red-700"}`}>
              {isReady ? "READY" : "BLOCKED"}
            </span>
            <span className="text-sm text-slate-500">({score}%)</span>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-slate-600">
            Rule 4: Central gate is authoritative. Diagnostic scores never override blocked status.
            Release requires full AI success and source grounding for all critical facts.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-center text-xs">
          <div className="rounded-xl bg-white px-3 py-2 shadow-sm border border-slate-100">
            <p className="text-slate-500">Extraction</p>
            <p className={`font-semibold ${extraction.overallSeverity === "GOOD" ? "text-emerald-700" : "text-red-700"}`}>
              {extraction.overallSeverity}
            </p>
          </div>
          <div className="rounded-xl bg-white px-3 py-2 shadow-sm border border-slate-100">
            <p className="text-slate-500">AI Analyze</p>
            <p className={`font-semibold ${analysis.state === "AI_SUCCEEDED" ? "text-emerald-700" : "text-amber-700"}`}>
              {analysis.state === "AI_SUCCEEDED" ? "SUCCESS" : "INCOMPLETE"}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${isReady ? "bg-emerald-500" : "bg-red-500"}`} style={{ width: `${score}%` }} />
      </div>
    </section>
  );
}
