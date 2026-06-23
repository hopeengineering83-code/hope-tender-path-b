"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SparklesIcon, RefreshIcon } from "./icons";

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

// Bounded exponential delay: 30s, 1m, 3m, 10m — must match server RETRY_DELAYS_MS
const RETRY_DELAYS_MS = [30_000, 60_000, 180_000, 600_000];
const MAX_RETRY_COUNT = RETRY_DELAYS_MS.length;

/**
 * AIAnalyzePanel — unified durable workflow with provider-aware auto-retry.
 *
 * - Normal button uses POST /api/tenders/[id]/ai-analyze?mode=background (202)
 * - Triggers /api/ai-jobs/run-next?jobType=AI_ANALYZE (surfaces 401/403/429/500)
 * - Polls /api/ai-jobs/[jobId] until terminal
 * - Polls /api/ai-providers/availability while panel is visible + job failed/partial
 * - Auto-retry with bounded exponential delay (30s/1m/3m/10m) only when a provider is eligible
 * - Never auto-retries non-retryable failures (extraction, ownership, hash, etc.)
 * - Retry Now button always available after auto-retry stops
 */
export function AIAnalyzePanel({ tenderId, aiEnabled }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [analyzePhase, setAnalyzePhase] = useState("");
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [providerAvail, setProviderAvail] = useState<ProviderAvailability | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [nonRetryable, setNonRetryable] = useState(false);
  const [autoRetrySecondsLeft, setAutoRetrySecondsLeft] = useState<number | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const availPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRetryCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (availPollRef.current) clearInterval(availPollRef.current);
      if (autoRetryTimerRef.current) clearTimeout(autoRetryTimerRef.current);
      if (autoRetryCountdownRef.current) clearInterval(autoRetryCountdownRef.current);
    };
  }, []);

  function clearAllPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (availPollRef.current) { clearInterval(availPollRef.current); availPollRef.current = null; }
  }

  function cancelAutoRetry() {
    if (autoRetryTimerRef.current) { clearTimeout(autoRetryTimerRef.current); autoRetryTimerRef.current = null; }
    if (autoRetryCountdownRef.current) { clearInterval(autoRetryCountdownRef.current); autoRetryCountdownRef.current = null; }
    setAutoRetrySecondsLeft(null);
  }

  async function fetchAvailability() {
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
    } catch { /* best-effort */ }
  }

  function scheduleAutoRetry(jid: string, count: number) {
    cancelAutoRetry();
    if (count >= MAX_RETRY_COUNT || nonRetryable) {
      setAutoRetrySecondsLeft(null);
      return;
    }
    const delayIdx = Math.min(count, RETRY_DELAYS_MS.length - 1);
    const delayMs = RETRY_DELAYS_MS[delayIdx];
    const fireAt = Date.now() + delayMs;
    setAutoRetrySecondsLeft(Math.ceil(delayMs / 1000));

    autoRetryCountdownRef.current = setInterval(() => {
      const left = Math.ceil((fireAt - Date.now()) / 1000);
      if (left <= 0) {
        if (autoRetryCountdownRef.current) { clearInterval(autoRetryCountdownRef.current); autoRetryCountdownRef.current = null; }
        setAutoRetrySecondsLeft(null);
      } else {
        setAutoRetrySecondsLeft(left);
      }
    }, 1000);

    autoRetryTimerRef.current = setTimeout(() => {
      autoRetryTimerRef.current = null;
      if (providerAvail?.anyAvailable) {
        void handleAnalyzeBackground(jid);
      } else if (count + 1 < MAX_RETRY_COUNT) {
        scheduleAutoRetry(jid, count + 1);
      }
    }, delayMs);
  }

  async function handleAnalyzeBackground(existingJobId?: string) {
    cancelAutoRetry();
    clearAllPolling();
    setAnalyzing(true);
    setError("");
    setAnalyzePhase("Enqueuing analysis…");
    setAnalyzeProgress(5);

    let jid: string | null = existingJobId ?? null;
    try {
      if (!jid) {
        const enqueueRes = await fetch(`/api/tenders/${tenderId}/ai-analyze?mode=background`, { method: "POST" });
        if (enqueueRes.status === 401 || enqueueRes.status === 403) {
          setError("You are not authorized to run AI analysis. Please sign in again and retry.");
          setAnalyzing(false); setAnalyzeProgress(0); return;
        }
        if (enqueueRes.status === 429) {
          const d = await enqueueRes.json().catch(() => ({}));
          setError(d.error || "Rate limit exceeded. Please wait and retry.");
          setAnalyzing(false); setAnalyzeProgress(0); return;
        }
        if (enqueueRes.status === 422) {
          const d = await enqueueRes.json().catch(() => ({}));
          setError(d.error || "Extraction is not ready. Run OCR or re-upload.");
          setAnalyzing(false); setAnalyzeProgress(0); return;
        }
        if (!enqueueRes.ok || enqueueRes.status !== 202) {
          const d = await enqueueRes.json().catch(() => ({}));
          setError(d.error || `Failed to start analysis (HTTP ${enqueueRes.status}).`);
          setAnalyzing(false); setAnalyzeProgress(0); return;
        }
        const enqueued = await enqueueRes.json();
        jid = enqueued.jobId;
        if (!jid) { setError("No job ID returned. Refresh the page."); setAnalyzing(false); setAnalyzeProgress(0); return; }
      }
      setJobId(jid);
      setAnalyzePhase("Starting worker…");
      setAnalyzeProgress(10);

      const workerRes = await fetch(`/api/ai-jobs/run-next?jobType=AI_ANALYZE`, { method: "POST" });
      if (workerRes.status === 401 || workerRes.status === 403) {
        setError("Worker could not be started: your session has expired. Your analysis is queued and will be picked up automatically, but please sign in again to track progress.");
        setAnalyzing(false); setAnalyzeProgress(0); return;
      }
      if (workerRes.status === 429) {
        setError("Worker start rate-limited (HTTP 429). Your analysis is queued and will be picked up automatically.");
        setAnalyzing(false); setAnalyzeProgress(0); return;
      }
      if (workerRes.status >= 500) {
        const d = await workerRes.json().catch(() => ({}));
        setError(`Worker start failed (HTTP ${workerRes.status}). ${d.error ?? "The analysis is queued and will be picked up automatically."}`);
        setAnalyzing(false); setAnalyzeProgress(0); return;
      }

      pollJobStatus(jid);
    } catch {
      setError("Analysis failed due to a network error. If a job was queued it will be retried automatically.");
      setAnalyzing(false); setAnalyzeProgress(0);
    }
  }

  function pollJobStatus(jid: string) {
    let count = 0;
    const maxPolls = 240;
    const intervalMs = 2000;

    void checkOnce();
    pollRef.current = setInterval(() => { void checkOnce(); }, intervalMs);

    async function checkOnce() {
      count += 1;
      try {
        const res = await fetch(`/api/ai-jobs/${jid}`);
        if (res.status === 401 || res.status === 403) {
          clearAllPolling();
          setError("Session expired while polling. Please sign in again. The job continues running in the background.");
          setAnalyzing(false); setAnalyzeProgress(0); return;
        }
        if (!res.ok) {
          if (count >= maxPolls) {
            clearAllPolling();
            setError("Could not reach the status endpoint after repeated attempts. The job may still be running — refresh the page.");
            setAnalyzing(false); setAnalyzeProgress(0);
          }
          return;
        }
        const data = await res.json();
        const job = data?.job;
        if (!job) return;

        const steps: Array<{ message?: string | null }> = job.steps ?? [];
        const latestStep = steps[steps.length - 1];
        if (latestStep?.message) setAnalyzePhase(String(latestStep.message).slice(0, 70));

        const status: string = job.status;
        const output: Record<string, unknown> = job.output ?? {};

        if (status === "QUEUED" || status === "RUNNING") {
          const completed = typeof output.completedChunks === "number" ? output.completedChunks : 0;
          const total = typeof output.totalChunks === "number" ? output.totalChunks : 0;
          if (total > 0 && completed > 0) {
            setAnalyzeProgress(Math.min(Math.round(10 + (completed / total) * 80), 90));
          } else {
            setAnalyzeProgress(Math.min(10 + count * 2, 85));
          }
          return;
        }

        // ── Terminal ────────────────────────────────────────────────────
        clearAllPolling();

        if (status === "SUCCEEDED") {
          const reqCount = typeof output.requirementCount === "number" ? output.requirementCount : 0;
          setAnalyzePhase(`Analysis complete — ${reqCount} requirements extracted`);
          setAnalyzeProgress(100);
          setAnalyzing(false);
          setRetryCount(0);
          setNonRetryable(false);
          startTransition(() => router.refresh());
          return;
        }

        // PARTIAL_SUCCESS or FAILED
        const errMsg = (typeof job.errorMessage === "string" && job.errorMessage) ||
          (typeof output.errorMessage === "string" && output.errorMessage) ||
          "Analysis failed. Generation remains blocked.";
        setError(errMsg);
        setAnalyzeProgress(0);
        setAnalyzing(false);

        const rsRetryCount = typeof output.retryCount === "number" ? output.retryCount : 0;
        const rsNonRetryable = Boolean(output.nonRetryable);
        setRetryCount(rsRetryCount);
        setNonRetryable(rsNonRetryable);

        // Start availability polling (for the auto-retry + Retry button)
        void fetchAvailability();
        availPollRef.current = setInterval(() => { void fetchAvailability(); }, 10_000);

        // Schedule auto-retry ONLY if the failure is retryable
        if (!rsNonRetryable && rsRetryCount < MAX_RETRY_COUNT) {
          scheduleAutoRetry(jid, rsRetryCount);
        }

        startTransition(() => router.refresh());
      } catch {
        if (count >= maxPolls) {
          clearAllPolling();
          setError("Polling failed after repeated network errors. The job may still be running.");
          setAnalyzing(false); setAnalyzeProgress(0);
        }
      }
    }
  }

  // ── UI state ──────────────────────────────────────────────────────────
  const canRetry = !analyzing && Boolean(providerAvail?.anyAvailable);
  const showRetryUI = Boolean(error || (retryCount > 0 && !nonRetryable));
  const autoRetryLimitReached = retryCount >= MAX_RETRY_COUNT;
  const cooldownSeconds = providerAvail?.minCooldownMs ? Math.ceil(providerAvail.minCooldownMs / 1000) : null;

  function getStatusLabel(): string {
    if (analyzing) return "AI Analyze is already running";
    if (!providerAvail) return "Checking provider availability…";
    if (providerAvail.configuredCount === 0) return "No AI providers configured";
    if (!providerAvail.anyAvailable) {
      return cooldownSeconds ? `Providers unavailable — automatic retry in ${cooldownSeconds}s` : "Providers unavailable — retry later";
    }
    if (autoRetryLimitReached) return "Automatic retry limit reached — Retry Now";
    if (autoRetrySecondsLeft !== null && autoRetrySecondsLeft > 0) {
      return `Providers unavailable — automatic retry in ${autoRetrySecondsLeft}s`;
    }
    return "Provider available — Retry AI Analyze";
  }

  return (
    <section id="ai-analyze-section" className="mb-4 rounded-2xl border border-purple-100 bg-purple-50/30 p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-purple-700">AI analysis action</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">
            {analyzing ? "AI Analysis in progress" : "Run AI Analysis"}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Extract requirements, client details, and evaluation criteria. Analysis runs as a durable background job with automatic retry when providers recover.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {aiEnabled ? (
            <button
              onClick={() => handleAnalyzeBackground()}
              disabled={analyzing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
            >
              <SparklesIcon />
              {analyzing ? (analyzePhase || "Analyzing…") : "Run AI Analyze"}
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

      {/* ── Auto-retry status banner ─────────────────────────────────── */}
      {showRetryUI && !analyzing && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <p className="text-sm font-bold text-amber-900">{getStatusLabel()}</p>
              {!nonRetryable && !autoRetryLimitReached && autoRetrySecondsLeft !== null && (
                <p className="text-xs text-amber-800 mt-1">Retry {retryCount + 1}/{MAX_RETRY_COUNT}</p>
              )}
              {nonRetryable && (
                <p className="text-xs text-red-800 mt-1">Non-retryable failure. Fix the root cause and click Retry Now.</p>
              )}
              {autoRetryLimitReached && !nonRetryable && (
                <p className="text-xs text-amber-800 mt-1">Automatic retry limit reached ({MAX_RETRY_COUNT} attempts). Click Retry Now to try again manually.</p>
              )}
              {providerAvail?.anyAvailable && !autoRetryLimitReached && !nonRetryable && (
                <p className="text-xs text-green-800 mt-1">Provider recovered — resuming AI Analyze automatically.</p>
              )}
            </div>
            {/* Retry Now button — always visible when there's an error */}
            <button
              onClick={() => jobId && handleAnalyzeBackground(jobId)}
              disabled={!canRetry}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
              title={canRetry ? "Retry AI Analyze with the durable background path" : getStatusLabel()}
            >
              <RefreshIcon />
              Retry Now
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">Analysis Error</p>
          <p className="mt-1 text-red-700">{error}</p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => { setError(""); jobId && handleAnalyzeBackground(jobId); }}
              disabled={!canRetry}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              <RefreshIcon /> Retry AI Analyze
            </button>
            <button onClick={() => setError("")} className="text-xs font-medium underline hover:text-red-900">
              Dismiss
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
