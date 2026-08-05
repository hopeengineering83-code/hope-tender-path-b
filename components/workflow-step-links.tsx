"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { openParentDetailsAndScroll } from "@/lib/ui/tender-workflow-sync";
import { emitTenderWorkflowSync } from "@/lib/ui/tender-workflow-sync";
import { TENDER_WORKFLOW_STAGES } from "@/lib/tender-workflow-stages";
import { CheckCircleIcon, ArrowRightIcon, ChevronDownIcon, SparklesIcon, BoltIcon } from "./icons";

const STEP_LABELS = TENDER_WORKFLOW_STAGES.map((stage) => stage.label);

type RecoveryAction = "AI_ANALYZE" | "RUN_ENGINE";

type CapabilityResponse = {
  authenticated?: boolean;
  canMutateTender?: boolean;
};

function recoveryForCanonicalDecision(currentAction: string): RecoveryAction | null {
  if (currentAction === "RUN_AI_ANALYZE" || currentAction === "RESUME_AI_ANALYZE") {
    return "AI_ANALYZE";
  }
  if (currentAction === "RUN_ENGINE") return "RUN_ENGINE";
  return null;
}

export function WorkflowStepLinks({
  currentIndex,
  currentAction,
}: {
  currentIndex: number;
  currentAction: string;
}) {
  const params = useParams<{ id?: string | string[] }>();
  const router = useRouter();
  const rawId = params?.id;
  const tenderId = Array.isArray(rawId) ? rawId[0] : rawId;
  const [interactive, setInteractive] = useState(false);
  const [canMutate, setCanMutate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInteractive(true);
    let active = true;
    void fetch("/api/auth/workflow-capabilities", { method: "GET", cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as CapabilityResponse;
        if (active) setCanMutate(response.ok && body.canMutateTender === true);
      })
      .catch(() => {
        if (active) setCanMutate(false);
      });
    return () => { active = false; };
  }, []);

  const handleClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>, selectors: string[]) => {
    event.preventDefault();
    const element = selectors
      .map((selector) => document.querySelector(selector))
      .find((candidate): candidate is Element => candidate !== null);
    if (!element) return;
    openParentDetailsAndScroll(element);
  }, []);

  const complete = currentIndex >= STEP_LABELS.length;
  const safeIndex = complete ? STEP_LABELS.length - 1 : Math.max(0, currentIndex);
  const currentStage = TENDER_WORKFLOW_STAGES[safeIndex];
  const currentLabel = currentStage.label;
  const recoveryAction = useMemo(() => recoveryForCanonicalDecision(currentAction), [currentAction]);

  /**
   * Nudge a durable recovery job that was explicitly requested by an operator.
   * Normal workflow orchestration remains server-owned and does not depend on
   * this browser request or on the page remaining open.
   */
  async function wakeWorker(jobType: "AI_ANALYZE" | "ENGINE_RUN") {
    const couldNotStart =
      "Queued, but the background worker could not be started from here. It stays queued and runs when a worker next picks it up.";
    try {
      const response = await fetch(`/api/ai-jobs/run-next?jobType=${jobType}`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) setMessage(couldNotStart);
    } catch {
      setMessage(couldNotStart);
    }
  }

  async function runRecoveryAction(action: RecoveryAction) {
    if (!tenderId || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const endpoint = action === "AI_ANALYZE"
        ? `/api/tenders/${tenderId}/manual-ai-analyze`
        : `/api/tenders/${tenderId}/engine`;
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
      });
      const body = await response.json().catch(() => ({})) as { error?: string; jobId?: string; status?: string };
      if (!response.ok || !body.jobId) {
        throw new Error(body.error ?? `${action === "AI_ANALYZE" ? "AI analysis" : "Engine"} recovery could not be queued.`);
      }

      setMessage(action === "AI_ANALYZE"
        ? "AI analysis recovery queued. Canonical facts are promoted only after complete grounded analysis succeeds."
        : "Engine recovery queued. Automatic matching, Build Plan, generation, validation, finalization, and package reconciliation will resume.");
      emitTenderWorkflowSync({ tenderId, source: action === "AI_ANALYZE" ? "recovery-ai-analyze" : "recovery-run-engine" });
      await wakeWorker(action === "AI_ANALYZE" ? "AI_ANALYZE" : "ENGINE_RUN");
      router.refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Workflow recovery failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      {complete ? (
        <p className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-800">
          <CheckCircleIcon /> Workflow complete
        </p>
      ) : (
        <a
          href={interactive ? currentStage.targets[0] : undefined}
          onClick={interactive ? (event) => handleClick(event, currentStage.targets) : undefined}
          aria-disabled={!interactive}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white ${interactive ? "bg-slate-900 hover:bg-slate-800" : "cursor-wait bg-slate-500"}`}
          title={interactive ? `Open ${currentLabel} status` : "Preparing workflow navigation"}
        >
          <ArrowRightIcon /> Open {currentLabel} status
        </a>
      )}

      {!complete && recoveryAction && canMutate && (
        <details className="rounded-lg border border-amber-200 bg-amber-50/70">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-amber-900">
            Diagnostics and recovery
          </summary>
          <div className="space-y-2 border-t border-amber-200 px-3 py-3">
            <p className="text-xs text-amber-900">
              The normal workflow continues automatically. Use this only after diagnosing a stalled or failed durable job.
            </p>
            <button
              type="button"
              disabled={busy || !tenderId}
              onClick={() => void runRecoveryAction(recoveryAction)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-900 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {recoveryAction === "AI_ANALYZE" ? <SparklesIcon /> : <BoltIcon />}
              {busy ? "Queuing recovery…" : recoveryAction === "AI_ANALYZE" ? "Retry AI analysis" : "Retry Engine"}
            </button>
          </div>
        </details>
      )}

      {message && <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">{message}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>}

      <details className="group rounded-lg border border-slate-200 bg-white/70">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold text-slate-700 marker:content-none">
          View full workflow
          <span aria-hidden="true" className="transition-transform group-open:rotate-180">
            <ChevronDownIcon />
          </span>
        </summary>
        <nav className="flex flex-wrap gap-1.5 border-t border-slate-200 p-3" aria-label="Full tender workflow" aria-busy={!interactive}>
          {TENDER_WORKFLOW_STAGES.map((stage, index) => {
            const done = index < currentIndex;
            const active = index === currentIndex;
            const baseClass = done
              ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
              : active
                ? "bg-slate-900 text-white hover:bg-slate-800"
                : "bg-slate-100 text-slate-500 hover:bg-slate-200";

            return (
              <a
                key={stage.stage}
                href={interactive ? stage.targets[0] : undefined}
                onClick={interactive ? (event) => handleClick(event, stage.targets) : undefined}
                aria-current={active ? "step" : undefined}
                aria-disabled={!interactive}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${interactive ? baseClass : "cursor-wait bg-slate-100 text-slate-400"}`}
                title={interactive ? `Go to ${stage.label}` : "Preparing workflow navigation"}
              >
                <span aria-hidden="true" className="inline-flex items-center">
                  {done ? <CheckCircleIcon className="mr-0.5" /> : active ? <ArrowRightIcon className="mr-0.5" /> : null}
                </span>
                {stage.label}
              </a>
            );
          })}
        </nav>
      </details>
    </div>
  );
}
