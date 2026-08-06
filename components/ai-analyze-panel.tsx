"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, CrossIcon, SparklesIcon } from "./icons";

type JobStatus = "QUEUED" | "RUNNING" | "PARTIAL_SUCCESS" | "SUCCEEDED" | "FAILED" | "CANCELED";

type Props = {
  tenderId: string;
  initialContinueJobId?: string | null;
  aiEnabled: boolean;
  canMutate?: boolean;
  analysisAlreadySucceeded?: boolean;
  extractionComplete?: boolean;
  sourceIntegrityValid?: boolean;
  hasActiveJob?: boolean;
};

const POLL_INTERVAL_MS = 3_000;
const TERMINAL: JobStatus[] = ["SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "CANCELED"];

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function AIAnalyzePanel({
  tenderId,
  initialContinueJobId = null,
  aiEnabled,
  canMutate = false,
  analysisAlreadySucceeded = false,
  extractionComplete = false,
  sourceIntegrityValid = true,
  hasActiveJob = false,
}: Props) {
  const router = useRouter();
  const [analyzing, setAnalyzing] = useState(Boolean(initialContinueJobId) || hasActiveJob);
  const [phase, setPhase] = useState(initialContinueJobId ? "AI Analyze is queued." : "");
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(initialContinueJobId ? "QUEUED" : null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  type ProviderDiag = {
    provider: string;
    configured: boolean;
    ok: boolean;
    reason: string | null;
    latencyMs: number | null;
  };
  const [diag, setDiag] = useState<{
    anyWorking: boolean;
    summary: string;
    perProvider: ProviderDiag[];
  } | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);

  useEffect(() => {
    if (!initialContinueJobId) return;

    let active = true;
    setAnalyzing(true);
    setJobStatus("QUEUED");
    setPhase("AI Analyze is queued — waiting for the durable worker.");

    async function watchJob() {
      while (active) {
        let job: {
          status: JobStatus;
          errorMessage: string | null;
          steps?: Array<{ message: string | null }>;
        } | null = null;
        try {
          const response = await fetch(`/api/ai-jobs/${initialContinueJobId}`, {
            method: "GET",
            cache: "no-store",
          });
          if (response.ok) {
            const body = await response.json().catch(() => null);
            job = body?.job ?? null;
          }
        } catch {
          // The job is durable. Retry the status read without creating work.
        }

        if (job) {
          setJobStatus(job.status);
          const lastStep = job.steps?.at(-1)?.message;
          if (lastStep) setPhase(lastStep);

          if (TERMINAL.includes(job.status)) {
            setAnalyzing(false);
            if (job.status === "SUCCEEDED") {
              setPhase("AI Analyze complete. Run Engine to continue.");
              router.refresh();
            } else if (job.status === "PARTIAL_SUCCESS") {
              setError("AI Analyze completed only partially. Run Engine remains blocked until a complete grounded analysis succeeds. You may retry AI Analyze.");
            } else if (job.status === "CANCELED") {
              setError(job.errorMessage || "AI Analyze was canceled. Retry AI Analyze when the blocking condition is resolved.");
            } else {
              setError(job.errorMessage || "AI Analyze failed. Correct the provider or extraction issue, then retry AI Analyze.");
            }
            return;
          }
        }

        await sleep(POLL_INTERVAL_MS);
      }
    }

    void watchJob();
    return () => { active = false; };
  }, [initialContinueJobId, router]);

  const runAiAnalyze = useCallback(async () => {
    if (submitting || analyzing) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/tenders/${tenderId}/manual-ai-analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const msg = body?.error || `AI Analyze could not start (HTTP ${response.status}).`;
        setError(msg);
        return;
      }
      if (body?.jobId) {
        setJobStatus("QUEUED");
        setAnalyzing(true);
        setPhase("AI Analyze is queued — waiting for the durable worker.");
        // Trigger the job-watching effect by updating initialContinueJobId-like state.
        // We simulate this by setting a local state the effect depends on.
        window.dispatchEvent(new CustomEvent("ai-analyze-started", { detail: { jobId: body.jobId } }));
        // Re-fetch the job status via a lightweight inline poll.
        const jobId = body.jobId as string;
        let active = true;
        const poll = async () => {
          while (active) {
            try {
              const r = await fetch(`/api/ai-jobs/${jobId}`, { cache: "no-store" });
              if (r.ok) {
                const b = await r.json().catch(() => null);
                const j = b?.job;
                if (j) {
                  setJobStatus(j.status);
                  const lastStep = j.steps?.at(-1)?.message;
                  if (lastStep) setPhase(lastStep);
                  if (TERMINAL.includes(j.status)) {
                    setAnalyzing(false);
                    if (j.status === "SUCCEEDED") {
                      setPhase("AI Analyze complete. Run Engine to continue.");
                      router.refresh();
                    } else if (j.status === "PARTIAL_SUCCESS") {
                      setError("AI Analyze completed only partially. Run Engine remains blocked until a complete grounded analysis succeeds. You may retry AI Analyze.");
                    } else {
                      setError(j.errorMessage || "AI Analyze failed. Retry AI Analyze after correcting the issue.");
                    }
                    return;
                  }
                }
              }
            } catch {
              // retry
            }
            await sleep(POLL_INTERVAL_MS);
          }
        };
        void poll();
        return () => { active = false; };
      }
    } catch {
      setError("Network error. The job may still have been created — reload to check status.");
    } finally {
      setSubmitting(false);
    }
  }, [submitting, analyzing, tenderId, router]);

  async function runProviderDiagnostics() {
    setDiagnosing(true);
    setDiag(null);
    try {
      const response = await fetch("/api/ai-providers/diagnostics?live=1", {
        method: "GET",
        cache: "no-store",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body) {
        setDiag({
          anyWorking: false,
          summary: response.status === 403
            ? "ADMIN or PROPOSAL_MANAGER access is required for provider diagnostics."
            : "Provider diagnostics could not be completed.",
          perProvider: [],
        });
      } else {
        setDiag({
          anyWorking: Boolean(body.anyWorking),
          summary: String(body.summary ?? ""),
          perProvider: Array.isArray(body.perProvider) ? body.perProvider : [],
        });
      }
    } catch {
      setDiag({
        anyWorking: false,
        summary: "The provider diagnostics endpoint could not be reached.",
        perProvider: [],
      });
    } finally {
      setDiagnosing(false);
    }
  }

  const analysisComplete = jobStatus === "SUCCEEDED" || (!analyzing && jobStatus === null && analysisAlreadySucceeded);

  // Button visibility logic:
  // - Visible when extraction is complete, source integrity is valid, at least one
  //   AI provider is available, the user has the required role, there is no active
  //   duplicate job, and the current revision has not already completed successfully.
  const canRunAnalyze = canMutate
    && aiEnabled
    && extractionComplete
    && sourceIntegrityValid
    && !analyzing
    && !analysisComplete
    && !submitting;

  // Determine the truthful status label
  const statusLabel = analyzing
    ? "AI Analyze is running."
    : analysisComplete
      ? "AI Analyze complete. Run Engine to continue."
      : !extractionComplete
        ? "Source extraction is running automatically."
        : !aiEnabled
          ? "No AI provider is configured."
          : !sourceIntegrityValid
            ? "Source integrity check failed. Re-extract or re-upload the source files."
            : "Extraction complete. Run AI Analyze to continue.";

  const headingLabel = analyzing
    ? "AI Analyze running"
    : analysisComplete
      ? "Analysis complete"
      : !extractionComplete
        ? "Waiting for extraction"
        : !aiEnabled
          ? "AI provider required"
          : "Ready for AI Analyze";

  // Determine button disabled reason (for aria-disabled and title)
  const disabledReason = !canMutate
    ? "You do not have permission to run AI Analyze."
    : !aiEnabled
      ? "Configure at least one supported AI provider."
      : !extractionComplete
        ? "Wait for source extraction to complete."
        : !sourceIntegrityValid
          ? "Source integrity check failed."
          : analyzing
            ? "An AI Analyze job is already running."
            : analysisComplete
              ? "AI Analyze already completed successfully for this revision."
              : null;

  return (
    <section id="ai-analyze-section" className="mb-4 rounded-2xl border border-purple-100 bg-purple-50/30 p-5 shadow-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI analysis</p>
        <h2 className="mt-1 text-lg font-bold text-slate-900">{headingLabel}</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">{statusLabel}</p>
      </div>

      {/* Run AI Analyze button — visible when eligible */}
      {canMutate && !analysisComplete && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => void runAiAnalyze()}
            disabled={!canRunAnalyze}
            aria-disabled={!canRunAnalyze}
            aria-busy={submitting || analyzing}
            title={disabledReason ?? "Run AI Analyze"}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              canRunAnalyze
                ? "bg-purple-600 text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
                : "cursor-not-allowed bg-slate-300 text-slate-500"
            }`}
          >
            <SparklesIcon />
            {submitting ? "Starting…" : analyzing ? "AI Analyze running…" : "Run AI Analyze"}
          </button>
          {disabledReason && !canRunAnalyze && (
            <p className="mt-2 text-xs text-slate-500" role="note">{disabledReason}</p>
          )}
        </div>
      )}

      {analyzing && (
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-xs text-purple-700">
            <span>{phase || "Working…"}</span>
            <span>{jobStatus ?? ""}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-purple-100">
            <div className="h-full w-1/2 animate-pulse bg-purple-600" />
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">AI Analyze did not complete</p>
          <p className="mt-1 text-red-700">{error}</p>
          {canMutate && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void runAiAnalyze()}
                disabled={submitting || analyzing || !aiEnabled || !extractionComplete}
                className="rounded-lg border border-purple-300 bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-60"
              >
                {submitting ? "Starting…" : "Retry AI Analyze"}
              </button>
              <button
                type="button"
                onClick={() => void runProviderDiagnostics()}
                disabled={diagnosing}
                className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-50 disabled:opacity-60"
              >
                {diagnosing ? "Checking providers…" : "Check provider diagnostics"}
              </button>
            </div>
          )}
        </div>
      )}

      {diag && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
          <p className={`text-xs font-semibold ${diag.anyWorking ? "text-emerald-700" : "text-red-700"}`}>
            {diag.summary}
          </p>
          {diag.perProvider.length > 0 && (
            <ul className="mt-2 space-y-1">
              {diag.perProvider.map((provider) => (
                <li key={provider.provider} className="flex items-start gap-2 text-xs">
                  <span className={`mt-0.5 ${provider.ok ? "text-emerald-600" : provider.configured ? "text-red-600" : "text-slate-400"}`}>
                    {provider.ok ? <CheckIcon /> : provider.configured ? <CrossIcon /> : "—"}
                  </span>
                  <span className="font-medium text-slate-700">{provider.provider}</span>
                  <span className="text-slate-500">
                    {provider.ok
                      ? `OK${typeof provider.latencyMs === "number" ? ` (${provider.latencyMs}ms)` : ""}`
                      : provider.reason ?? (provider.configured ? "failed" : "not configured")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
