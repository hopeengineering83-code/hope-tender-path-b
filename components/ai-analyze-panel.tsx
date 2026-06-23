"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SparklesIcon, ClockIcon, BoltIcon, RefreshIcon } from "./icons";

type ChunkProgress = {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  isPartial: boolean;
};

type AnalyzeResult = {
  ai: boolean;
  fallback: boolean;
  jobId: string | null;
  chunks: ChunkProgress | null;
  code: string | null;
  nextAction: string | null;
  providerDiagnostics: any | null;
  providerRetryAfterMs: number | null;
  resumableJobId: string | null;
};

type ProviderAvailability = {
  anyAvailable: boolean;
  minCooldownMs: number | null;
  configuredCount: number;
  availableCount: number;
};

type Props = {
  tenderId: string;
  initialContinueJobId?: string | null;
  aiEnabled: boolean;
};

/**
 * AIAnalyzePanel — the user-facing "Run AI Analyze" control.
 *
 * UNIFIED DURABLE WORKFLOW
 * ────────────────────────
 * The normal "Run AI Analyze" button enqueues a durable AI_ANALYZE job
 * via POST /api/tenders/[id]/ai-analyze?mode=background (HTTP 202), then
 * triggers /api/ai-jobs/run-next?jobType=AI_ANALYZE with the authenticated
 * session to start the worker immediately. The UI then polls
 * /api/ai-jobs/[jobId] for status until a terminal is reached.
 *
 * The direct SSE route is NOT used for normal production analysis.
 *
 * AUTOMATIC PROVIDER-AVAILABILITY RETRY
 * ─────────────────────────────────────
 * A "Retry AI Analyze" button becomes enabled automatically when at least
 * one configured provider is currently eligible (not in cooldown).
 * Availability is computed server-side via /api/ai-providers/availability
 * — not NEXT_PUBLIC_AI_ENABLED. Polling happens only while the panel is
 * visible AND the latest job is failed/partial/stuck/waiting-for-cooldown.
 * Stops after success, unmount, or a new active job.
 *
 * Worker-start errors (401/403/429/500 from run-next) are surfaced
 * clearly in the UI rather than silently swallowed.
 */
export function AIAnalyzePanel({ tenderId, initialContinueJobId, aiEnabled }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [analyzePhase, setAnalyzePhase] = useState("");
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null);
  const [continueJobId, setContinueJobId] = useState<string | null>(initialContinueJobId ?? null);
  const [error, setError] = useState("");
  const [providerAvail, setProviderAvail] = useState<ProviderAvailability | null>(null);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const availPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (availPollIntervalRef.current) clearInterval(availPollIntervalRef.current);
    };
  }, []);

  function cancelPolling() {
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
  }

  function cancelAvailPolling() {
    if (availPollIntervalRef.current) { clearInterval(availPollIntervalRef.current); availPollIntervalRef.current = null; }
  }

  // ── Provider-availability polling ─────────────────────────────────────
  // Polls /api/ai-providers/availability only while the panel is visible
  // AND the latest job is failed/partial/stuck/waiting-for-cooldown.
  // Stops after success, unmount, or a new active job.
  async function fetchProviderAvailability() {
    try {
      const res = await fetch("/api/ai-providers/availability");
      if (res.status === 401 || res.status === 403) return;
      if (!res.ok) return;
      const data = await res.json();
      setProviderAvail({
        anyAvailable: Boolean(data.anyAvailable),
        minCooldownMs: typeof data.minCooldownMs === "number" ? data.minCooldownMs : null,
        configuredCount: typeof data.configuredCount === "number" ? data.configuredCount : 0,
        availableCount: typeof data.availableCount === "number" ? data.availableCount : 0,
      });
    } catch {
      // Silent — availability is best-effort
    }
  }

  function startAvailPolling() {
    cancelAvailPolling();
    void fetchProviderAvailability();
    availPollIntervalRef.current = setInterval(() => {
      void fetchProviderAvailability();
    }, 10_000); // poll every 10s
  }

  function stopAvailPolling() {
    cancelAvailPolling();
  }

  // Start polling availability when there's an error or partial result
  // (i.e. the user might want to retry). Stop when analyzing or on success.
  useEffect(() => {
    if (error || (analyzeResult && !analyzeResult.ai)) {
      startAvailPolling();
    } else {
      stopAvailPolling();
    }
    return () => stopAvailPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, analyzeResult, analyzing]);

  // ── Durable background entry point ────────────────────────────────────
  async function handleAnalyzeBackground() {
    cancelPolling();
    setAnalyzing(true);
    setError("");
    setAnalyzeResult(null);
    setAnalyzePhase("Enqueuing analysis…");
    setAnalyzeProgress(5);

    let jobId: string | null = null;
    try {
      // 1. Enqueue the durable AI_ANALYZE job (HTTP 202)
      const enqueueUrl = `/api/tenders/${tenderId}/ai-analyze?mode=background`;
      const enqueueRes = await fetch(enqueueUrl, { method: "POST" });

      if (enqueueRes.status === 401 || enqueueRes.status === 403) {
        setError("You are not authorized to run AI analysis. Please sign in again and retry.");
        setAnalyzing(false);
        setAnalyzeProgress(0);
        return;
      }
      if (enqueueRes.status === 429) {
        const data = await enqueueRes.json().catch(() => ({}));
        setError(data.error || "Rate limit exceeded — too many analysis requests. Please wait a minute and retry.");
        setAnalyzing(false);
        setAnalyzeProgress(0);
        return;
      }
      if (enqueueRes.status === 422) {
        const data = await enqueueRes.json().catch(() => ({}));
        setError(data.error || "Extraction is not ready for AI analysis. Run OCR or re-upload a clearer document.");
        setAnalyzing(false);
        setAnalyzeProgress(0);
        return;
      }
      if (!enqueueRes.ok || enqueueRes.status !== 202) {
        const data = await enqueueRes.json().catch(() => ({}));
        setError(data.error || `Failed to start analysis (HTTP ${enqueueRes.status}).`);
        setAnalyzing(false);
        setAnalyzeProgress(0);
        return;
      }

      const enqueued = await enqueueRes.json();
      jobId = enqueued.jobId;
      if (!jobId) {
        setError("Analysis was accepted but no job ID was returned. Refresh the page and check the analysis status.");
        setAnalyzing(false);
        setAnalyzeProgress(0);
        return;
      }
      setContinueJobId(jobId);
      setAnalyzePhase("Starting worker…");
      setAnalyzeProgress(10);

      // 2. Trigger the worker with the authenticated session
      const workerRes = await fetch(`/api/ai-jobs/run-next?jobType=AI_ANALYZE`, { method: "POST" });

      if (workerRes.status === 401 || workerRes.status === 403) {
        cancelPolling();
        setError("Worker could not be started: your session has expired. Your analysis is queued and will be picked up automatically, but please sign in again to track progress.");
        setAnalyzing(false);
        setAnalyzeProgress(0);
        return;
      }
      if (workerRes.status === 429) {
        cancelPolling();
        setError("Worker start rate-limited (HTTP 429). Your analysis is queued and will be picked up automatically.");
        setAnalyzing(false);
        setAnalyzeProgress(0);
        return;
      }
      if (workerRes.status >= 500) {
        const data = await workerRes.json().catch(() => ({}));
        cancelPolling();
        setError(`Worker start failed (HTTP ${workerRes.status}). ${data.error ?? "The analysis is queued and will be picked up automatically, but the immediate start did not succeed."}`);
        setAnalyzing(false);
        setAnalyzeProgress(0);
        return;
      }

      // 3. Poll /api/ai-jobs/[jobId] until terminal
      pollJobStatus(jobId);
    } catch (err) {
      cancelPolling();
      setError("Analysis failed due to a network error. If a job was queued it will be retried automatically.");
      setAnalyzing(false);
      setAnalyzeProgress(0);
    }
  }

  // ── Job-status polling ────────────────────────────────────────────────
  function pollJobStatus(jobId: string) {
    let pollCount = 0;
    const maxPolls = 240; // ~8 minutes at 2s
    const intervalMs = 2000;

    void checkOnce();
    pollIntervalRef.current = setInterval(() => { void checkOnce(); }, intervalMs);

    async function checkOnce() {
      pollCount += 1;
      try {
        const res = await fetch(`/api/ai-jobs/${jobId}`);
        if (res.status === 401 || res.status === 403) {
          cancelPolling();
          setError("Session expired while polling analysis status. Please sign in again. The job continues running in the background.");
          setAnalyzing(false);
          setAnalyzeProgress(0);
          return;
        }
        if (!res.ok) {
          if (pollCount >= maxPolls) {
            cancelPolling();
            setError("Could not reach the status endpoint after repeated attempts. The job may still be running — refresh the page in a moment.");
            setAnalyzing(false);
            setAnalyzeProgress(0);
          }
          return;
        }
        const data = await res.json();
        const job = data?.job;
        if (!job) return;

        const steps: Array<{ message?: string | null }> = job.steps ?? [];
        const latestStep = steps[steps.length - 1];
        if (latestStep?.message) {
          setAnalyzePhase(String(latestStep.message).slice(0, 70));
        }

        const status: string = job.status;
        const output: Record<string, unknown> = job.output ?? {};

        if (status === "QUEUED" || status === "RUNNING") {
          const completed = typeof output.completedChunks === "number" ? output.completedChunks : 0;
          const total = typeof output.totalChunks === "number" ? output.totalChunks : 0;
          if (total > 0 && completed > 0) {
            const pct = Math.round(10 + (completed / total) * 80);
            setAnalyzeProgress(Math.min(pct, 90));
          } else {
            setAnalyzeProgress(Math.min(10 + pollCount * 2, 85));
          }
          if (pollCount >= maxPolls) {
            cancelPolling();
            setError("Analysis is taking longer than expected. It may still be running in the background — refresh the page in a moment to check the status.");
            setAnalyzing(false);
            setAnalyzeProgress(0);
          }
          return;
        }

        // ── Terminal ────────────────────────────────────────────────────
        cancelPolling();

        if (status === "SUCCEEDED") {
          const requirementCount = typeof output.requirementCount === "number" ? output.requirementCount : 0;
          setAnalyzePhase(`Analysis complete — ${requirementCount} requirements extracted`);
          setAnalyzeProgress(100);
          setAnalyzeResult({
            ai: true, fallback: false, jobId, chunks: null, code: null,
            nextAction: null, providerDiagnostics: null,
            providerRetryAfterMs: null, resumableJobId: null,
          });
          setContinueJobId(null);
          setAnalyzing(false);
          startTransition(() => router.refresh());
          return;
        }

        if (status === "PARTIAL_SUCCESS") {
          const total = typeof output.totalChunks === "number" ? output.totalChunks : 0;
          const completed = typeof output.completedChunks === "number" ? output.completedChunks : 0;
          const failed = typeof output.failedChunks === "number" ? output.failedChunks : 0;
          setAnalyzePhase("Analysis partial — some chunks failed");
          setAnalyzeProgress(100);
          setAnalyzeResult({
            ai: false, fallback: false, jobId,
            chunks: { total, completed, failed, skipped: 0, isPartial: true },
            code: "PARTIAL_SUCCESS", nextAction: "RETRY",
            providerDiagnostics: output, providerRetryAfterMs: null,
            resumableJobId: jobId,
          });
          setAnalyzing(false);
          startTransition(() => router.refresh());
          return;
        }

        // FAILED
        const errMsg: string =
          (typeof job.errorMessage === "string" && job.errorMessage) ||
          (typeof output.errorMessage === "string" && output.errorMessage) ||
          "Analysis failed. Canonical data was not promoted; generation remains blocked.";
        const code: string | null = typeof output.code === "string" ? output.code : null;
        setError(errMsg);
        setAnalyzeProgress(0);
        setAnalyzeResult({
          ai: false, fallback: false, jobId, chunks: null, code,
          nextAction: "RETRY", providerDiagnostics: output,
          providerRetryAfterMs: null, resumableJobId: jobId,
        });
        setAnalyzing(false);
        startTransition(() => router.refresh());
      } catch {
        if (pollCount >= maxPolls) {
          cancelPolling();
          setError("Analysis status polling failed after repeated network errors. The job may still be running — refresh the page in a moment.");
          setAnalyzing(false);
          setAnalyzeProgress(0);
        }
      }
    }
  }

  // ── Retry button state ────────────────────────────────────────────────
  // The retry button is enabled automatically when at least one provider
  // is currently eligible (server-side check). It is NOT based on
  // NEXT_PUBLIC_AI_ENABLED alone.
  const canRetry = !analyzing && Boolean(providerAvail?.anyAvailable);
  const showRetryButton = Boolean(error || (analyzeResult && !analyzeResult.ai));
  const cooldownSeconds = providerAvail?.minCooldownMs
    ? Math.ceil(providerAvail.minCooldownMs / 1000)
    : null;

  function getRetryLabel(): string {
    if (analyzing) return "AI Analyze is already running";
    if (!providerAvail) return "Checking provider availability…";
    if (providerAvail.configuredCount === 0) return "No AI providers configured";
    if (!providerAvail.anyAvailable) {
      return cooldownSeconds
        ? `Providers unavailable — retry after ${cooldownSeconds}s`
        : "Providers unavailable — retry later";
    }
    return "Provider available — Retry AI Analyze";
  }

  return (
    <section id="ai-analyze-section" className="mb-4 rounded-2xl border border-purple-100 bg-purple-50/30 p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-purple-700">AI analysis action</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">
            {analyzing ? "AI Analysis in progress" : continueJobId ? "Resume AI Analysis" : "Run AI Analysis"}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Extract requirements, client details, and evaluation criteria. Analysis runs as a durable background job and is resumable.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {aiEnabled ? (
            <button
              onClick={handleAnalyzeBackground}
              disabled={analyzing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
            >
              <SparklesIcon />
              {analyzing ? (analyzePhase || "Analyzing…") : continueJobId ? "Resume AI Analyze" : "Run AI Analyze"}
            </button>
          ) : (
            <span className="text-xs text-red-600 font-medium italic">AI providers not configured</span>
          )}
        </div>
      </div>

      {analyzing && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-purple-700 mb-1">
            <span>{analyzePhase}</span>
            <span>{analyzeProgress}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-purple-100">
            <div className="h-full bg-purple-600 transition-all duration-500" style={{ width: `${analyzeProgress}%` }} />
          </div>
        </div>
      )}

      {/* ── Auto-enabling Retry button ───────────────────────────────── */}
      {showRetryButton && !analyzing && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <p className="text-sm font-bold text-amber-900">{getRetryLabel()}</p>
              {providerAvail && providerAvail.configuredCount > 0 && !providerAvail.anyAvailable && cooldownSeconds && (
                <p className="text-xs text-amber-800 mt-1">
                  {providerAvail.availableCount}/{providerAvail.configuredCount} providers cooling down. Auto-retry enabled in {cooldownSeconds}s.
                </p>
              )}
              {providerAvail && providerAvail.anyAvailable && (
                <p className="text-xs text-green-800 mt-1">
                  {providerAvail.availableCount}/{providerAvail.configuredCount} providers ready.
                </p>
              )}
            </div>
            <button
              onClick={handleAnalyzeBackground}
              disabled={!canRetry}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title={canRetry ? "Retry AI Analyze with the durable background path" : getRetryLabel()}
            >
              <RefreshIcon />
              Retry AI Analyze
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">Analysis Error</p>
          <p className="mt-1 text-red-700">{error}</p>
          {analyzeResult?.providerDiagnostics && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium underline">Provider Diagnostics</summary>
              <pre className="mt-1 overflow-auto rounded bg-red-100 p-2 text-[10px] text-red-900 whitespace-pre-wrap break-words">
                {typeof analyzeResult.providerDiagnostics === "string"
                  ? analyzeResult.providerDiagnostics
                  : JSON.stringify(analyzeResult.providerDiagnostics, null, 2)}
              </pre>
            </details>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => { setError(""); handleAnalyzeBackground(); }}
              disabled={!canRetry}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              <RefreshIcon /> Retry AI Analyze
            </button>
            {continueJobId && (
              <button
                onClick={() => { setError(""); setContinueJobId(null); handleAnalyzeBackground(); }}
                disabled={analyzing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                <SparklesIcon /> Start Fresh
              </button>
            )}
            <button onClick={() => setError("")} className="text-xs font-medium underline hover:text-red-900">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {!analyzing && !error && analyzeResult?.chunks && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">
            Analysis partial — {analyzeResult.chunks.completed}/{analyzeResult.chunks.total} chunks completed, {analyzeResult.chunks.failed} failed.
          </p>
          <p className="text-xs text-amber-800 mt-1">
            Canonical data was not promoted. Generation, export, and Final ZIP remain blocked.
          </p>
        </div>
      )}

      {continueJobId && !analyzing && !error && !analyzeResult?.chunks && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-center justify-between">
          <p className="text-xs text-amber-800 font-medium">
            ⚠ Previous analysis was interrupted. You can resume from the last successful chunk.
          </p>
          <button
            onClick={() => { setContinueJobId(null); }}
            className="text-[10px] uppercase font-bold text-amber-700 hover:text-amber-900"
          >
            Start Fresh
          </button>
        </div>
      )}
    </section>
  );
}
