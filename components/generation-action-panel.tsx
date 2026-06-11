"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { GenerationProgressPanel } from "./generation-progress-panel";

type GenerationReadiness = {
  ready: boolean;
  supportPackageReady?: boolean;
  fullProposalReady?: boolean;
  fullProposalBlockers?: Array<{ code: string; message: string; nextAction?: string }>;
  blockers?: Array<{ code: string; message: string; nextAction?: string }>;
  warnings?: Array<{ code: string; message: string; nextAction?: string }>;
  counts?: {
    selectedExperts?: number;
    reviewedExpertMatches?: number;
    selectedProjects?: number;
    reviewedProjectMatches?: number;
  };
};

type GenerateResponse = {
  jobId?: string;
  error?: string;
  nextAction?: string;
  warnings?: string[];
  diagnosticId?: string;
};

function shortAction(action?: string): string {
  if (action === "RUN_ENGINE") return "Run Engine first.";
  if (action === "REVIEW_MATCHES") return "Review/select matching evidence.";
  if (action === "EDIT_TENDER_METADATA") return "Open Tender Detail and fill missing metadata.";
  if (action === "BUILD_SUBMISSION_PLAN") return "Run Build Plan first.";
  if (action === "RUN_OCR_OR_UPLOAD_CLEARER_SCAN") return "Run OCR or upload a clearer scan.";
  if (action === "OPEN_EXTRACTION_QUALITY") return "Check Extraction Quality.";
  return "Resolve the readiness blockers first.";
}

export function GenerationActionPanel({ tenderId, readiness }: { tenderId: string; readiness: GenerationReadiness | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [kind, setKind] = useState<"success" | "error" | "info">("info");
  const [jobId, setJobId] = useState<string | null>(null);

  const blockers = readiness?.blockers ?? [];
  const warnings = readiness?.warnings ?? [];
  const supportReady = readiness?.supportPackageReady ?? readiness?.ready ?? false;
  const fullProposalReady = readiness?.fullProposalReady ?? readiness?.ready ?? false;
  const fullProposalBlockers = readiness?.fullProposalBlockers ?? [];
  const blocked = !fullProposalReady;
  const actionDisabled = blocked || running || isPending;

  const autoPromotionAvailable = Boolean(
    readiness?.counts &&
    (((readiness.counts.selectedExperts ?? 0) === 0 && (readiness.counts.reviewedExpertMatches ?? 0) > 0) ||
      ((readiness.counts.selectedProjects ?? 0) === 0 && (readiness.counts.reviewedProjectMatches ?? 0) > 0)),
  );

  async function runGenerate() {
    if (!fullProposalReady) {
      setKind("error");
      setMessage("Generation is blocked. Resolve the listed full-proposal blockers first.");
      return;
    }
    setRunning(true);
    setMessage(null);
    setJobId(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/generate`, { method: "POST" });
      const data = await res.json().catch(() => ({})) as GenerateResponse;
      if (!res.ok) {
        const hint = data.nextAction ? ` ${shortAction(data.nextAction)}` : "";
        const diag = data.diagnosticId ? ` [diag ${data.diagnosticId}]` : "";
        setKind("error");
        setMessage(`${data.error || "Generation failed."}${hint}${diag}`.trim());
        return;
      }
      if (data.jobId) setJobId(data.jobId);
      const warningText = Array.isArray(data.warnings) && data.warnings.length > 0 ? ` Warnings: ${data.warnings.slice(0, 2).join(" ")}` : "";
      setKind("success");
      setMessage(`Generation completed.${warningText}`.trim());
      startTransition(() => router.refresh());
    } catch (error) {
      setKind("error");
      setMessage(error instanceof Error ? `Generation failed. ${error.message}` : "Generation failed due to a network/runtime error.");
    } finally {
      setRunning(false);
    }
  }

  const panelClass = fullProposalReady
    ? "border-emerald-200 bg-emerald-50"
    : supportReady
      ? "border-amber-200 bg-amber-50"
      : "border-red-200 bg-red-50";
  const labelClass = fullProposalReady ? "text-emerald-700" : supportReady ? "text-amber-700" : "text-red-700";
  const headlineText = fullProposalReady
    ? "Full proposal generation gate: passes"
    : supportReady
      ? "Support evidence available — full proposal blocked"
      : "Generation blocked";

  return (
    <>
      <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${panelClass}`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className={`text-xs font-semibold uppercase tracking-wide ${labelClass}`}>Generation action</p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">{headlineText}</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              The Generate Docs action is controlled by the strict full-proposal readiness gate. When blocked, the button is disabled and no green action state is shown.
            </p>
            {autoPromotionAvailable && (
              <p className="mt-2 text-xs font-medium text-emerald-700">Reviewed matches are available for automatic promotion if no manual selection has been made.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className={`rounded-full px-3 py-1 font-semibold ${supportReady ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>Support evidence: {supportReady ? "available" : "blocked"}</span>
              <span className={`rounded-full px-3 py-1 font-semibold ${fullProposalReady ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>Full proposal: {fullProposalReady ? "ready" : "blocked"}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={runGenerate}
            disabled={actionDisabled}
            aria-disabled={actionDisabled}
            className={fullProposalReady
              ? "rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              : "cursor-not-allowed rounded-lg border border-red-200 bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-500"}
            title={blocked ? "Generation blocked — resolve the blockers listed below." : "Generate proposal documents."}
          >
            {running || isPending ? "Generating…" : blocked ? "Resolve blockers first" : "Generate Docs"}
          </button>
        </div>

        {!fullProposalReady && fullProposalBlockers.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Full proposal blocked because:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-800">
              {fullProposalBlockers.slice(0, 6).map((item, index) => <li key={`fp-${item.code}-${index}`}>{item.message}</li>)}
            </ul>
          </div>
        )}

        {fullProposalReady && !supportReady && blockers.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-800">
            {blockers.slice(0, 4).map((item, index) => <li key={`b-${item.code}-${index}`}>{item.message}</li>)}
          </ul>
        )}

        {(fullProposalReady || supportReady) && warnings.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-emerald-800">
            {warnings.slice(0, 3).map((item, index) => <li key={`w-${item.code}-${index}`}>{item.message}</li>)}
          </ul>
        )}

        {message && (
          <div className={`mt-3 rounded-xl border px-3 py-2 text-sm ${kind === "success" ? "border-emerald-200 bg-white text-emerald-800" : kind === "error" ? "border-red-200 bg-white text-red-700" : "border-slate-200 bg-white text-slate-700"}`}>
            {message}
          </div>
        )}
      </section>
      <GenerationProgressPanel tenderId={tenderId} jobId={jobId} />
    </>
  );
}
