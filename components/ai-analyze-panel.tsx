"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SparklesIcon, RefreshIcon, CheckIcon, CrossIcon } from "./icons";

type JobStatus = "QUEUED" | "RUNNING" | "PARTIAL_SUCCESS" | "SUCCEEDED" | "FAILED" | "CANCELED";

type Props = {
  tenderId: string;
  initialContinueJobId?: string | null;
  aiEnabled: boolean;
  canMutate?: boolean;
};

const POLL_INTERVAL_MS = 3_000;
const TERMINAL: JobStatus[] = ["SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "CANCELED"];

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function AIAnalyzePanel({ tenderId, aiEnabled, canMutate = false }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [analyzing, setAnalyzing] = useState(false);
  const [phase, setPhase] = useState("");
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState("");
  // Worker-start failures (401/403/500 from run-next) are surfaced SEPARATELY
  // and never silently swallowed — the job is still queued, so we keep polling.
  const [workerError, setWorkerError] = useState("");

  // Provider self-test: when a run fails, the user can ask "which provider is
  // actually broken and why" instead of guessing. Hits the live diagnostics
  // endpoint, which reports per-provider ok / redacted-reason (no keys).
  type ProviderDiag = { provider: string; configured: boolean; ok: boolean; reason: string | null; latencyMs: number | null };
  const [diag, setDiag] = useState<{ anyWorking: boolean; summary: string; perProvider: ProviderDiag[] } | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);

  async function runProviderDiagnostics() {
    setDiagnosing(true);
    setDiag(null);
    try {
      const res = await fetch(`/api/ai-providers/diagnostics?live=1`, { method: "GET" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) {
        setDiag({ anyWorking: false, summary: res.status === 403 ? "You need the ADMIN or PROPOSAL_MANAGER role to run provider diagnostics." : "Could not run provider diagnostics.", perProvider: [] });
      } else {
        setDiag({ anyWorking: Boolean(json.anyWorking), summary: String(json.summary ?? ""), perProvider: Array.isArray(json.perProvider) ? json.perProvider : [] });
      }
    } catch {
      setDiag({ anyWorking: false, summary: "Could not reach the diagnostics endpoint.", perProvider: [] });
    } finally {
      setDiagnosing(false);
    }
  }

  // Auto-retry-when-available: when a run stops short because providers are
  // cooling down, we schedule a retry for when they recover. The durable path
  // resumes from the last completed chunk, so retries never restart from zero.
  const [autoRetrySecondsLeft, setAutoRetrySecondsLeft] = useState<number | null>(null);
  const [willResume, setWillResume] = useState(false);
  const autoRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRetryCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Set to true on unmount / new run so an in-flight poll loop stops cleanly.
  const cancelledRef = useRef(false);
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (autoRetryTimerRef.current) clearTimeout(autoRetryTimerRef.current);
      if (autoRetryCountdownRef.current) clearInterval(autoRetryCountdownRef.current);
    };
  }, []);

  function cancelAutoRetry() {
    if (autoRetryTimerRef.current) { clearTimeout(autoRetryTimerRef.current); autoRetryTimerRef.current = null; }
    if (autoRetryCountdownRef.current) { clearInterval(autoRetryCountdownRef.current); autoRetryCountdownRef.current = null; }
    setAutoRetrySecondsLeft(null);
  }

  function scheduleAutoRetry(delayMs: number, resume: boolean) {
    cancelAutoRetry();
    setWillResume(resume);
    const fireAt = Date.now() + delayMs;
    setAutoRetrySecondsLeft(Math.ceil(delayMs / 1000));
    autoRetryCountdownRef.current = setInterval(() => {
      const left = Math.ceil((fireAt - Date.now()) / 1000);
      if (left <= 0) { cancelAutoRetry(); } else { setAutoRetrySecondsLeft(left); }
    }, 1000);
    autoRetryTimerRef.current = setTimeout(() => {
      autoRetryTimerRef.current = null;
      setAutoRetrySecondsLeft(null);
      void handleBackgroundAnalyze();
    }, delayMs);
  }

  // Durable background analysis: enqueue ONE AI_ANALYZE job, kick the worker,
  // and poll the job until it reaches a terminal state. This deliberately does
  // NOT use the direct SSE route — that path is bounded by the Vercel function
  // limit and is not the durable worker.
  async function handleBackgroundAnalyze() {
    cancelledRef.current = false;
    cancelAutoRetry();
    setAnalyzing(true);
    setError("");
    setWorkerError("");
    setJobStatus(null);
    setPhase("Queuing durable analysis job…");

    let jobId: string;
    try {
      const res = await fetch(`/api/tenders/${tenderId}/ai-analyze?mode=background`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (res.status !== 202 || !data?.jobId) {
        setError(data?.error || "Failed to start AI analysis.");
        setAnalyzing(false);
        setPhase("");
        return;
      }
      jobId = data.jobId as string;
      setJobStatus("QUEUED");
      setPhase("Job queued — starting worker…");
    } catch {
      setError("Could not reach the server to start analysis.");
      setAnalyzing(false);
      setPhase("");
      return;
    }

    // Trigger the worker using the authenticated session. Inspect the response:
    // 401/403/500 MUST be visible — we surface them but keep polling because the
    // job is already durably queued and a scheduled recovery worker can run it.
    try {
      const workerRes = await fetch(`/api/ai-jobs/run-next?jobType=AI_ANALYZE`, { method: "POST" });
      if (workerRes.status === 401) {
        setWorkerError("Worker authorization failed (401). Your session may have expired — sign in again. The job stays queued.");
      } else if (workerRes.status === 403) {
        setWorkerError("Worker permission denied (403). You need the ADMIN or PROPOSAL_MANAGER role to run analysis. The job stays queued.");
      } else if (workerRes.status >= 500) {
        setWorkerError(`Worker failed to start (HTTP ${workerRes.status}). The job is queued; the scheduled recovery worker will retry it.`);
      }
    } catch {
      setWorkerError("Could not reach the analysis worker. The job is queued; the scheduled recovery worker will retry it.");
    }

    // Poll the job to its terminal state.
    await pollJob(jobId);
  }

  async function pollJob(jobId: string) {
    while (!cancelledRef.current) {
      await sleep(POLL_INTERVAL_MS);
      if (cancelledRef.current) return;
      let job: { status: JobStatus; errorMessage: string | null; steps?: Array<{ message: string | null }>; output?: { providerRetryAfterMs?: number | null; resumableJobId?: string | null } | null } | null = null;
      try {
        const res = await fetch(`/api/ai-jobs/${jobId}`, { method: "GET" });
        if (!res.ok) continue; // transient — keep polling
        const body = await res.json().catch(() => null);
        job = body?.job ?? null;
      } catch {
        continue; // transient network error — keep polling
      }
      if (!job) continue;

      setJobStatus(job.status);
      const lastStep = job.steps && job.steps.length > 0 ? job.steps[job.steps.length - 1]?.message : null;
      if (lastStep) setPhase(lastStep);

      if (TERMINAL.includes(job.status)) {
        setAnalyzing(false);
        if (job.status === "SUCCEEDED") {
          setPhase("Analysis complete — requirements and client details promoted.");
          startTransition(() => router.refresh());
        } else if (job.status === "PARTIAL_SUCCESS" || job.status === "FAILED") {
          setError(job.status === "PARTIAL_SUCCESS"
            ? "Analysis is only partial — some tender content could not be analyzed. Generation and export stay blocked until a full analysis succeeds."
            : (job.errorMessage || "AI analysis failed. You can retry."));
          // Auto-retry when providers recover, resuming from the last completed
          // chunk (the durable job is re-armed + checkpoints replayed).
          const providerRetryAfterMs = typeof job.output?.providerRetryAfterMs === "number" ? job.output.providerRetryAfterMs : null;
          if (providerRetryAfterMs !== null) {
            scheduleAutoRetry(Math.max(providerRetryAfterMs, 5_000), Boolean(job.output?.resumableJobId));
          }
        }
        return;
      }
    }
  }

  const busy = analyzing || isPending;

  return (
    <section id="ai-analyze-section" className="mb-4 rounded-2xl border border-purple-100 bg-purple-50/30 p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-purple-700">Step 1 · AI analysis</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">
            {analyzing ? "AI Analysis in progress" : "Run AI Analysis"}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Extract requirements, client details, and evaluation criteria from tender documents.
            Run this first, then use the Engine below to create evidence matches.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {aiEnabled && canMutate ? (
            <button
              onClick={handleBackgroundAnalyze}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-60"
            >
              <SparklesIcon />
              {analyzing ? (phase || "Analyzing…") : "Run AI Analyze"}
            </button>
          ) : aiEnabled && !canMutate ? (
            <span className="text-xs text-slate-500 font-medium italic">Read-only — AI Analyze requires ADMIN or PROPOSAL_MANAGER role</span>
          ) : (
            <span className="text-xs text-red-600 font-medium italic">AI providers not configured</span>
          )}
        </div>
      </div>

      {analyzing && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-purple-700 mb-1">
            <span>{phase || "Working…"}</span>
            <span>{jobStatus ?? ""}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-purple-100">
            <div className="h-full w-1/2 animate-pulse bg-purple-600" />
          </div>
        </div>
      )}

      {workerError && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Worker start warning</p>
          <p className="mt-1 text-amber-800">{workerError}</p>
        </div>
      )}

      {autoRetrySecondsLeft !== null && autoRetrySecondsLeft > 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
          <span className="text-xs font-medium text-blue-800">
            Providers cooling down — auto-retrying in {autoRetrySecondsLeft}s
            {willResume ? " (resumes from the last completed chunk)" : ""}
          </span>
          {canMutate && (
          <button
            onClick={() => { cancelAutoRetry(); handleBackgroundAnalyze(); }}
            disabled={analyzing}
            className="ml-auto rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            title="Retry now and resume from the last completed chunk"
          >
            Retry now
          </button>
          )}
          <button onClick={cancelAutoRetry} className="text-xs text-blue-600 underline hover:text-blue-800">
            Cancel
          </button>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">Analysis {jobStatus === "PARTIAL_SUCCESS" ? "Incomplete" : "Error"}</p>
          <p className="mt-1 text-red-700">{error}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {canMutate && (
            <button
              onClick={() => { setError(""); handleBackgroundAnalyze(); }}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              <RefreshIcon /> Retry AI Analyze
            </button>
            )}
            <button
              onClick={runProviderDiagnostics}
              disabled={diagnosing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
              title="Run a live test of every AI provider to see which key is working and why a run fails"
            >
              {diagnosing ? "Testing providers…" : "Diagnose providers"}
            </button>
            <button
              onClick={() => setError("")}
              className="text-xs font-medium underline hover:text-red-900"
            >
              Dismiss
            </button>
          </div>

          {diag && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
              <p className={`text-xs font-semibold ${diag.anyWorking ? "text-emerald-700" : "text-red-700"}`}>
                {diag.summary}
              </p>
              {diag.perProvider.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {diag.perProvider.map((p) => (
                    <li key={p.provider} className="flex items-start gap-2 text-xs">
                      <span className={`mt-0.5 ${p.ok ? "text-emerald-600" : p.configured ? "text-red-600" : "text-slate-400"}`}>
                        {p.ok ? <CheckIcon /> : p.configured ? <CrossIcon /> : "—"}
                      </span>
                      <span className="font-medium text-slate-700">{p.provider}</span>
                      <span className="text-slate-500">
                        {p.ok
                          ? `OK${typeof p.latencyMs === "number" ? ` (${p.latencyMs}ms)` : ""}`
                          : p.reason ?? (p.configured ? "failed" : "not configured")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
