"use client";

import { useEffect, useState } from "react";
import { type ReleaseSnapshot } from "../lib/engine/release-snapshot";

/**
 * Final Submission Control Center
 *
 * Consumes the unified ReleaseSnapshot.
 * Rule 4: Final ZIP remains stricter than ordinary review screens.
 */
export function FinalSubmissionControlCenter({ tenderId, generationReadiness }: { tenderId: string; generationReadiness?: any }) {
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

  const { eligibility } = snapshot;

  const steps = [
    { no: 1, title: "AI Analysis", status: snapshot.analysis.state === "AI_SUCCEEDED" ? "SUCCESS" : "BLOCKED", ready: snapshot.analysis.state === "AI_SUCCEEDED" },
    { no: 2, title: "Metadata Grounding", status: !snapshot.metadata.hasGenerationBlocker ? "GROUNDED" : "UNGROUNDED", ready: !snapshot.metadata.hasGenerationBlocker },
    { no: 3, title: "Generation", status: eligibility.readyForGeneration ? "READY" : "BLOCKED", ready: eligibility.readyForGeneration },
    { no: 4, title: "Final ZIP", status: eligibility.readyForFinalZip ? "AVAILABLE" : "BLOCKED", ready: eligibility.readyForFinalZip },
  ];

  return (
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Final Submission Control Center</h2>
          <p className="mt-1 text-xs text-slate-500">
            Rule 4: Central gate is authoritative. No output created before release eligibility.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {steps.map((step) => (
          <div key={step.no} className={`rounded-xl border p-3 ${step.ready ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-500">Step {step.no}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${step.ready ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                {step.status}
              </span>
            </div>
            <h3 className="mt-2 text-sm font-semibold text-slate-900">{step.title}</h3>
            {step.no === 4 && step.ready ? (
              <a
                href={`/api/tenders/${tenderId}/download?type=zip`}
                className="mt-3 inline-flex text-xs font-medium text-emerald-700 hover:text-emerald-800"
              >
                Download ZIP
              </a>
            ) : step.no === 4 ? (
              <span className="mt-3 inline-flex text-xs font-medium text-slate-400 cursor-not-allowed">
                ZIP Blocked
              </span>
            ) : null}
          </div>
        ))}
      </div>

      {!eligibility.readyForFinalZip && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          <span className="font-semibold text-red-900">Release Blocked:</span> Resolve the blockers in the readiness panels above before final ZIP is available.
        </div>
      )}
    </section>
  );
}
