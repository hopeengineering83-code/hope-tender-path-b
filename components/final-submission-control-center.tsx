"use client";

import { useMemo, useState, useEffect } from "react";
import { SnapshotConsistencyBadge } from "./snapshot-consistency-badge";
import { subscribeTenderWorkflowSync } from "../lib/ui/tender-workflow-sync";

type ExportReadiness = {
  ok: boolean;
  summary?: {
    totalBlockers?: number;
    documentBlockers?: number;
    tenderLevelBlockers?: number;
    advisoryWarnings?: number;
    strictTwoEnvelope?: boolean;
    envelopeBreakdown?: { TECHNICAL?: number; FINANCIAL?: number; ADMIN?: number };
    planStatus?: string;
  };
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

type StepShape = {
  no: number;
  title: string;
  state: "done" | "blocked" | "unknown";
  status: string;
  // When `href` is set we render a real <a>. When omitted the action is
  // rendered as a non-link <span> — critical for Step 4 so a blocked ZIP
  // cannot be clicked through. The download route also enforces this
  // server-side via the canonical readiness gate.
  href?: string;
  action: string;
};

export function FinalSubmissionControlCenter({ tenderId, generationReadiness }: { tenderId: string; generationReadiness: GenerationReadinessLike }) {
  const [exportReadiness, setExportReadiness] = useState<ExportReadiness | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to cross-panel workflow sync so this panel auto-refreshes
  // when other panels take actions.
  useEffect(() => {
    return subscribeTenderWorkflowSync(tenderId, () => { void checkFinalExport(); });
  }, [tenderId]);

  const generationBlocked = Boolean(
    generationReadiness?.analysisSourceGate === "BLOCKED_REGEX_FALLBACK" ||
    (generationReadiness?.fullProposalBlockers?.length ?? 0) > 0 ||
    (generationReadiness?.blockers?.length ?? 0) > 0,
  );
  const generationReady = Boolean(generationReadiness?.fullProposalReady || generationReadiness?.readyForFullProposal || generationReadiness?.ready) && !generationBlocked;

  const strictTwoEnvelope = exportReadiness?.summary?.strictTwoEnvelope ?? false;
  const docBlockers = exportReadiness?.summary?.documentBlockers ?? 0;
  const tenderBlockers = exportReadiness?.summary?.tenderLevelBlockers ?? 0;
  const advisoryCount = exportReadiness?.summary?.advisoryWarnings ?? 0;
  const envelopeBreakdown = exportReadiness?.summary?.envelopeBreakdown;

  const steps: StepShape[] = useMemo(() => {
    const exportState: "done" | "blocked" | "unknown" = exportReadiness ? (exportReadiness.ok ? "done" : "blocked") : "unknown";
    const step3Status = exportReadiness
      ? exportReadiness.ok
        ? `Export gate passed${advisoryCount > 0 ? ` · ${advisoryCount} advisor${advisoryCount === 1 ? "y" : "ies"} (non-blocking)` : ""}`
        : `${docBlockers} document blockers · ${tenderBlockers} tender blockers · ${advisoryCount} advisories`
      : "Not checked";

    // Step 4 — the ZIP download. NEVER include an href when the canonical
    // gate is blocked. Two-envelope tenders are surfaced to the user but
    // still routed via Export Readiness Panel, which renders the per-
    // envelope download links.
    const step4: StepShape = exportReadiness?.ok
      ? strictTwoEnvelope
        ? {
            no: 4,
            title: "Download final ZIP",
            state: "done",
            status: "Two-envelope tender — open Export Readiness to download technical + financial ZIPs separately",
            action: "Open Export Readiness",
            href: "#export-readiness",
          }
        : {
            no: 4,
            title: "Download final ZIP",
            state: "done",
            status: "Available",
            action: "Download ZIP",
            href: `/api/tenders/${tenderId}/download?type=zip`,
          }
      : {
          no: 4,
          title: "Download final ZIP",
          state: "blocked",
          status: exportReadiness ? `Blocked — ${exportReadiness.summary?.totalBlockers ?? 0} blocker(s)` : "Run Step 3 first",
          action: "Download blocked — resolve blockers first",
          // intentionally NO href when blocked
        };

    return [
      {
        no: 1,
        title: "Analyze tender",
        state: (generationReadiness?.analysisSourceGate === "BLOCKED_REGEX_FALLBACK" ? "blocked" : "unknown") as "done" | "blocked" | "unknown",
        status: generationReadiness?.analysisSourceGate === "BLOCKED_REGEX_FALLBACK" ? "Re-run AI analysis" : "Check analysis panels",
        action: "Open Analysis Quality",
        href: "#analysis-quality",
      },
      {
        no: 2,
        title: "Generate required documents",
        state: (generationReady ? "done" : generationBlocked ? "blocked" : "unknown") as "done" | "blocked" | "unknown",
        status: generationReady ? "Generation gate passed" : generationBlocked ? "Blocked" : "Not confirmed",
        action: "Open Generate Docs",
        href: "#generated-documents",
      },
      {
        no: 3,
        title: "Resolve final export blockers",
        state: exportState,
        status: step3Status,
        action: "Open Export Readiness",
        href: "#export-readiness",
      },
      step4,
    ];
  }, [exportReadiness, generationBlocked, generationReadiness?.analysisSourceGate, generationReady, tenderId, docBlockers, tenderBlockers, advisoryCount, strictTwoEnvelope]);

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
            Tender workflow approval does not mean final submission approval. Generation readiness only means documents can be generated; final export is separate and must pass the canonical export gate.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void checkFinalExport()}
          disabled={checking}
          className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {checking ? "Checking final export…" : "Check final submission status"}
        </button>
      </div>

      {/* Additive honest-UI overlay: show the authoritative release-snapshot
          export verdict + revision, and warn if this panel's locally-checked
          export readiness disagrees with it. Never replaces the check above. */}
      <SnapshotConsistencyBadge
        tenderId={tenderId}
        verdict="export"
        localEligible={exportReadiness ? exportReadiness.ok : undefined}
        localLabel="Final Submission"
      />

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {steps.map((step) => {
          const isBlocked = step.state === "blocked";
          const isStep4Blocked = step.no === 4 && isBlocked;
          // No green styling and NO href on a blocked Step 4 ZIP. We render
          // a non-link <span> in that case so the user cannot accidentally
          // click through to a blocked download.
          const actionClass = isStep4Blocked
            ? "mt-3 inline-flex text-xs font-medium text-slate-400 cursor-not-allowed"
            : isBlocked
              ? "mt-3 inline-flex text-xs font-medium text-red-700 hover:text-red-800"
              : "mt-3 inline-flex text-xs font-medium text-emerald-700 hover:text-emerald-800";
          return (
            <div key={step.no} className={`rounded-xl border p-3 ${stepBorder(step.state)}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-500">Step {step.no}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${pillClass(step.state)}`}>{step.status}</span>
              </div>
              <h3 className="mt-2 text-sm font-semibold text-slate-900">{step.title}</h3>
              {step.href ? (
                <a
                  className={actionClass}
                  href={step.href}
                  target={step.href.startsWith("/api/") ? "_blank" : undefined}
                  rel={step.href.startsWith("/api/") ? "noreferrer" : undefined}
                >
                  {step.action}
                </a>
              ) : (
                <span className={actionClass} aria-disabled="true" title="Resolve blockers above before downloading.">
                  {step.action}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {strictTwoEnvelope && exportReadiness?.ok && envelopeBreakdown && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
          <span className="font-semibold">Two-envelope tender:</span>{" "}
          Open <strong>Export Readiness</strong> and download the TECHNICAL ({envelopeBreakdown.TECHNICAL ?? 0} file(s)) and FINANCIAL ({envelopeBreakdown.FINANCIAL ?? 0} file(s)) ZIPs separately.
          {(envelopeBreakdown.ADMIN ?? 0) > 0 && <> ADMIN ({envelopeBreakdown.ADMIN}) is a third envelope.</>}
        </div>
      )}

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        <span className="font-semibold">Rule:</span> do not submit or download the final ZIP until Step 3 says Export gate passed. A green generation panel alone is not final submission approval.
      </div>
    </section>
  );
}
