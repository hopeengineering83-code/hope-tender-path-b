"use client";

import { useEffect, useState } from "react";
import { type ReleaseSnapshot } from "../lib/engine/release-snapshot";

/**
 * Bid Control Verdict Panel
 *
 * Consumes the unified ReleaseSnapshot.
 * Rule 4: Consolidation of strict release truth.
 */
export function BidControlVerdictPanel({ tenderId }: { tenderId: string }) {
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

  if (loading) return <div className="animate-pulse h-40 bg-slate-100 rounded-2xl" />;
  if (!snapshot) return null;

  const { eligibility, requirements, metadata, buildPlan } = snapshot;
  const isReady = eligibility.readyForFinalZip;

  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${isReady ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bid Control Verdict</p>
          <h2 className={`mt-1 text-2xl font-bold ${isReady ? "text-emerald-900" : "text-red-900"}`}>
            {isReady ? "READY FOR RELEASE" : "RELEASE BLOCKED"}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Consolidates strict generation readiness, source grounding, and vault evidence into one release signal.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl bg-white p-3 border border-slate-100">
          <p className="text-xs text-slate-500">Full Proposal</p>
          <p className={`text-lg font-bold ${eligibility.readyForGeneration ? "text-emerald-700" : "text-red-700"}`}>
            {eligibility.readyForGeneration ? "Ready" : "Blocked"}
          </p>
        </div>
        <div className="rounded-xl bg-white p-3 border border-slate-100">
          <p className="text-xs text-slate-500">Metadata Grounding</p>
          <p className={`text-lg font-bold ${metadata.groundedFields === metadata.totalFields ? "text-emerald-700" : "text-amber-700"}`}>
            {metadata.groundedFields} / {metadata.totalFields}
          </p>
        </div>
        <div className="rounded-xl bg-white p-3 border border-slate-100">
          <p className="text-xs text-slate-500">Requirement Traceability</p>
          <p className={`text-lg font-bold ${requirements.traced === requirements.mandatory ? "text-emerald-700" : "text-amber-700"}`}>
            {requirements.traced} / {requirements.mandatory}
          </p>
        </div>
        <div className="rounded-xl bg-white p-3 border border-slate-100">
          <p className="text-xs text-slate-500">Evidence Coverage</p>
          <p className={`text-lg font-bold ${requirements.evidenceCovered >= requirements.mandatory ? "text-emerald-700" : "text-amber-700"}`}>
            {requirements.evidenceCovered} / {requirements.mandatory}
          </p>
        </div>
      </div>

      {eligibility.blockers.length > 0 && (
        <div className="mt-4 rounded-xl border border-red-200 bg-white p-3 text-sm text-red-800">
          <p className="font-semibold">Blockers to fix before submission</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {eligibility.blockers.map((b) => <li key={b.code}>{b.message}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
