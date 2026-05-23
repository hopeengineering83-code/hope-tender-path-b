"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

// Gap 16 fix — accepts the split-readiness flags from
// TenderGenerationReadiness so the panel can render two distinct
// states:
//   • Support package readiness (vault fallback OK)
//   • Full proposal readiness    (tender-specific evidence required)
// The "Generate Docs" button is gated by FULL_PROPOSAL_READY, not just
// the legacy `ready` flag, so the panel can never show green while
// the Bid Control Verdict says NOT_READY.
type GenerationReadiness = {
  ready: boolean;
  // Optional for back-compat — older callers that haven't migrated still
  // work, they just lose the split-state nuance.
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
  error?: string;
  code?: string;
  nextAction?: string;
  warnings?: string[];
  tender?: unknown;
  diagnosticId?: string;
  failedStage?: string;
};

function shortAction(action?: string): string {
  if (action === "RUN_ENGINE") return "Run Engine first.";
  if (action === "REVIEW_MATCHES") return "Review/select matching evidence.";
  if (action === "OPEN_KNOWLEDGE_REVIEW") return "Open the Knowledge Review board.";
  if (action === "OPEN_COMPANY_READINESS") return "Open Company Readiness.";
  if (action === "OPEN_ANALYSIS_QUALITY") return "Review Analysis Quality.";
  if (action === "OPEN_MATCHING_QUALITY") return "Review Matching Quality.";
  if (action === "EDIT_TENDER") return "Edit the tender details.";
  if (action === "RETRY_AS_BACKGROUND_JOB") return "Retry as a background job.";
  if (action === "RETRY_AFTER_BACKOFF") return "Wait a minute and retry.";
  return "Review the tender readiness panels.";
}

export function GenerationActionPanel({ tenderId, readiness }: { tenderId: string; readiness: GenerationReadiness | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [kind, setKind] = useState<"success" | "error" | "info">("info");

  const blockers = readiness?.blockers ?? [];
  const warnings = readiness?.warnings ?? [];
  const supportReady = readiness?.supportPackageReady ?? readiness?.ready ?? false;
  // Full-proposal-ready is the STRICT gate. When the server returns the
  // split-readiness shape (post-Gap-6), use it. Older callers fall back to
  // the legacy `ready` flag.
  const fullProposalReady = readiness?.fullProposalReady ?? readiness?.ready ?? false;
  const fullProposalBlockers = readiness?.fullProposalBlockers ?? [];
  const autoPromotionAvailable = Boolean(
    readiness?.counts
    && ((readiness.counts.selectedExperts ?? 0) === 0 && (readiness.counts.reviewedExpertMatches ?? 0) > 0
      || (readiness.counts.selectedProjects ?? 0) === 0 && (readiness.counts.reviewedProjectMatches ?? 0) > 0),
  );

  async function runGenerate() {
    setRunning(true);
    setMessage(null);
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

  // Panel colour reflects the STRICT gate so the user can't mistake "support
  // package would generate" for "full proposal is ready". Green = full
  // proposal ready, amber = support-package-ready-only, red = neither.
  const panelClass = fullProposalReady
    ? "border-emerald-200 bg-emerald-50"
    : supportReady
      ? "border-amber-200 bg-amber-50"
      : "border-red-200 bg-red-50";
  const labelClass = fullProposalReady
    ? "text-emerald-700"
    : supportReady
      ? "text-amber-700"
      : "text-red-700";

  const headlineText = fullProposalReady
    ? "Full proposal generation gate: passes"
    : supportReady
      ? "Only support-package generation is allowed — full proposal blocked"
      : "Resolve generation blockers first";

  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${panelClass}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${labelClass}`}>Generation action</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">{headlineText}</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            This action follows the server-side generation-readiness gate, including reviewed-match auto-promotion. The &quot;Generate Docs&quot; button is gated by the strict full-proposal readiness — vault fallback alone does not unlock it.
          </p>
          {autoPromotionAvailable && (
            <p className="mt-2 text-xs font-medium text-emerald-700">Reviewed matches are available for automatic promotion if no manual selection has been made.</p>
          )}

          {/* Gap 16 — surface the split state plainly so reviewers know which
              kind of output they can produce and which they cannot. */}
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className={`rounded-full px-3 py-1 font-semibold ${supportReady ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
              Support package: {supportReady ? "ready" : "blocked"}
            </span>
            <span className={`rounded-full px-3 py-1 font-semibold ${fullProposalReady ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
              Full proposal: {fullProposalReady ? "ready" : "blocked"}
            </span>
          </div>
        </div>
        <button
          onClick={runGenerate}
          disabled={!fullProposalReady || running || isPending}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          title={!fullProposalReady ? "Full proposal generation is blocked — resolve the blockers listed below." : undefined}
        >
          {running || isPending ? "Generating…" : "Generate Docs"}
        </button>
      </div>

      {/* PRIOR BUG (May 17 screenshots): when both gates were blocked,
          the panel rendered BOTH fullProposalBlockers AND the raw
          blockers list. Since fullProposalBlockers already contains the
          topic-deduped union of full-proposal-specific + inherited
          support-package blockers, rendering `blockers` again caused
          duplicate complaints with slightly different wording —
          notably "Full proposal generation is blocked: client name is
          empty or a placeholder." appearing alongside "Client name is
          not set. Fill the tender Client Name before...".
          FIX: when full proposal is blocked, show ONLY the deduped
          fullProposalBlockers. Show raw `blockers` only in the
          "support-only-blocked" state (full proposal ready but
          something blocks even the support package) — that path uses
          the original wording without overlap. */}
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
  );
}
