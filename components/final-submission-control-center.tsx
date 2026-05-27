"use client";

import { useMemo, useState } from "react";

type ExportReadiness = {
  ok: boolean;
  summary?: { totalBlockers?: number; documentBlockers?: number; tenderLevelBlockers?: number; advisoryWarnings?: number };
  message?: string;
};

type GenerationReadinessLike = {
  ready?: boolean;
  fullProposalReady?: boolean;
  supportPackageReady?: boolean;
  readyForFullProposal?: boolean;
  readyForSupportPackage?: boolean;
  analysisSourceGate?: string;
  fullProposalBlockers?: Array<{ code?: string; message?: string }>;
  blockers?: Array<{ code?: string; message?: string }>;
  warnings?: Array<{ code?: string; message?: string }>;
} | null;

function pillClass(state: "done" | "blocked" | "unknown") {
  if (state === "done") return "bg-emerald-100 text-emerald-700";
  if (state === "blocked") return "bg-red-100 text-red-700";
  return "bg-slate-100 text-slate-600";
}

function stepBorder(state: "done" | "blocked" | "unknown") {
  if (state === "done") return "border-emerald-200 bg-emerald-50";
  if (state === "blocked") return "border-red-200 bg-red-50";
  return "border-slate-200 bg-slate-50";
}

export function FinalSubmissionControlCenter({ tenderId, generationReadiness }: { tenderId: string; generationReadiness: GenerationReadinessLike }) {
  const [exportReadiness, setExportReadiness] = useState<ExportReadiness | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generationBlocked = Boolean(
    generationReadiness?.analysisSourceGate === "BLOCKED_REGEX_FALLBACK" ||
    (generationReadiness?.fullProposalBlockers?.length ?? 0) > 0 ||
    (generationReadiness?.blockers?.length ?? 0) > 0,
  );
  const generationReady = Boolean(generationReadiness?.fullProposalReady || generationReadiness?.readyForFullProposal || generationReadiness?.ready) && !generationBlocked;

  const steps = useMemo(() => {
    const exportState = exportReadiness ? (exportReadiness.ok ? "done" : "blocked") : "unknown";
    return [
      {
        no: 1,
        title: "Analyze tender",
        state: generationReadiness?.analysisSourceGate === "BLOCKED_REGEX_FALLBACK" ? "blocked" as const : "unknown" as const,
        status: generationReadiness?.analysisSourceGate === "BLOCKED_REGEX_FALLBACK" ? "Re-run AI analysis" : "Check analysis panels",
        action: "Open Analysis Quality",
        href: "#analysis-quality",
      },
      {
        no: 2,
        title: "Generate required documents",
        state: generationReady ? "done" as const : generationBlocked ? "blocked" as const : "unknown" as const,
        status: generationReady ? "Generation gate passed" : generationBlocked ? "Blocked" : "Not confirmed",
        action: "Open Generate Docs",
        href: "#generate-docs-action",
      },
      {
        no: 3,
        title: "Resolve final export blockers",
        state: exportState as "done" | "blocked" | "unknown",
        status: exportReadiness ? (exportReadiness.ok ? "Export gate passed" : `${exportReadiness.summary?.documentBlockers ?? 0} document blockers · ${exportReadiness.summary?.tenderLevelBlockers ?? 0} tender blockers`) : "Not checked",
        action: "Open Export Readiness",
        href: "#export-readiness",
      },
      {
        no: 4,
        title: "Download final ZIP",
        state: exportReadiness?.ok ? "done" as const : "blocked" as const,
        status: exportReadiness?.ok ? "Available" : "Resolve blockers first",
        action: exportReadiness?.ok ? "Download ZIP" : "Download blocked",
        href: exportReadiness?.ok ? `/api/tenders/${tenderId}/download?type=zip` : "#export-readiness",
      },
    ];
  }, [exportReadiness, generationBlocked, generationReadiness?.analysisSourceGate, generationReady, tenderId]);

  async function checkFinalExport() {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/export-readiness`, { method: "GET" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Export readiness failed (${res.status})`);
      setExportReadiness(data.exportReadiness);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export readiness failed");
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Final Submission Control Center</h2>
          <p className="mt-1 text-xs text-slate-500">
            Approved means the tender record is approved for processing. It does not mean final submission is ready; final submission requires Step 3 export gate to pass.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void checkFinalExport()}
          disabled={checking}
          className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {checking ? "Checking final export…" : "Check final submission status"}
        </button>
      </div>

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {steps.map((step) => (
          <div key={step.no} className={`rounded-xl border p-3 ${stepBorder(step.state)}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-500">Step {step.no}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${pillClass(step.state)}`}>{step.status}</span>
            </div>
            <h3 className="mt-2 text-sm font-semibold text-slate-900">{step.title}</h3>
            {step.no === 4 && !exportReadiness?.ok ? (
              <button type="button" disabled className="mt-3 inline-flex cursor-not-allowed text-xs font-medium text-slate-400">
                Download blocked — resolve blockers first ({exportReadiness?.summary?.totalBlockers ?? "?"})
              </button>
            ) : (
              <a
                className={`mt-3 inline-flex text-xs font-medium ${step.href.startsWith("/api/") ? "text-emerald-700 hover:text-emerald-800" : "text-slate-700 hover:text-slate-900"}`}
                href={step.href}
                target={step.href.startsWith("/api/") ? "_blank" : undefined}
                rel={step.href.startsWith("/api/") ? "noreferrer" : undefined}
              >
                {step.action}
              </a>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        <span className="font-semibold">Rule:</span> do not submit or download the final ZIP until Step 3 says Export gate passed. A green generation panel alone is not final submission approval.
      </div>
    </section>
  );
}
