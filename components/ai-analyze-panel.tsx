"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AiAnalyzeStatusBanner } from "./ai-analyze-status-banner";

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
  extractionWarnings: any[] | null;
  providerDiagnostics: any | null;
  providerRetryAfterMs: number | null;
  resumableJobId: string | null;
};

type Props = {
  tenderId: string;
  initialContinueJobId?: string | null;
  aiEnabled: boolean;
};

export function AIAnalyzePanel({ tenderId, initialContinueJobId, aiEnabled }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [analyzePhase, setAnalyzePhase] = useState("");
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null);
  const [continueJobId, setContinueJobId] = useState<string | null>(initialContinueJobId ?? null);
  const [error, setError] = useState("");

  const [autoRetryAt, setAutoRetryAt] = useState<number | null>(null);
  const [autoRetrySecondsLeft, setAutoRetrySecondsLeft] = useState<number | null>(null);
  const autoRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRetryCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (autoRetryTimerRef.current) clearTimeout(autoRetryTimerRef.current);
      if (autoRetryCountdownRef.current) clearInterval(autoRetryCountdownRef.current);
    };
  }, []);

  function cancelAutoRetry() {
    if (autoRetryTimerRef.current) { clearTimeout(autoRetryTimerRef.current); autoRetryTimerRef.current = null; }
    if (autoRetryCountdownRef.current) { clearInterval(autoRetryCountdownRef.current); autoRetryCountdownRef.current = null; }
    setAutoRetryAt(null);
    setAutoRetrySecondsLeft(null);
  }

  function scheduleAutoRetry(delayMs: number, resumeJobId: string | null) {
    cancelAutoRetry();
    if (resumeJobId) setContinueJobId(resumeJobId);
    const fireAt = Date.now() + delayMs;
    setAutoRetryAt(fireAt);
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
      setAutoRetryAt(null);
      setAutoRetrySecondsLeft(null);
      void handleAnalyzeStreaming();
    }, delayMs);
  }

  async function handleAnalyzeStreaming() {
    cancelAutoRetry();
    setAnalyzing(true);
    setError("");
    setAnalyzePhase("Connecting…");
    setAnalyzeProgress(5);
    try {
      const analyzeUrl = continueJobId
        ? `/api/tenders/${tenderId}/ai-analyze?continue=${encodeURIComponent(continueJobId)}`
        : `/api/tenders/${tenderId}/ai-analyze`;
      const res = await fetch(analyzeUrl, {
        method: "POST",
        headers: { "Accept": "text/event-stream" },
      });

      if (!res.ok || !res.body) {
        // Fall back to non-streaming path or show error
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Analysis failed to start");
        setAnalyzing(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      let streamedFallback = false;

      while (!done) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(part.slice(6));
            if (event.phase === "analyzing" && event.chunk !== undefined) {
              const total = event.totalChunks ?? "?";
              setAnalyzePhase(`Analyzing chunk ${event.chunk}/${total}`);
              const pct = event.totalChunks ? Math.round(20 + (event.chunk / event.totalChunks) * 55) : 50;
              setAnalyzeProgress(pct);
            } else if (event.phase === "extracting") {
              setAnalyzePhase(event.message?.slice(0, 50) ?? "Extracting…");
              setAnalyzeProgress(15);
            } else if (event.phase === "saving") {
              setAnalyzePhase("Saving analysis results…");
              setAnalyzeProgress(90);
            } else if (event.phase === "starting") {
              setAnalyzePhase("Preparing tender content…");
              setAnalyzeProgress(8);
            } else if (event.phase === "complete") {
              setAnalyzePhase(
                event.fallback
                  ? "Analysis complete — AI unavailable, regex fallback used"
                  : `Analysis complete — ${event.requirementCount ?? 0} requirements extracted`
              );
              setAnalyzeProgress(100);
              if (event.fallback) {
                streamedFallback = true;
                setAnalyzeResult({
                  ai: false,
                  fallback: true,
                  jobId: event.jobId ?? null,
                  chunks: null,
                  code: event.code ?? null,
                  nextAction: event.nextAction ?? null,
                  extractionWarnings: null,
                  providerDiagnostics: event.providerDiagnostics ?? null,
                  providerRetryAfterMs: typeof event.providerRetryAfterMs === "number" ? event.providerRetryAfterMs : null,
                  resumableJobId: event.resumableJobId ?? null,
                });
                if (typeof event.providerRetryAfterMs === "number" && event.providerRetryAfterMs !== null) {
                  scheduleAutoRetry(Math.max(event.providerRetryAfterMs, 5_000), event.resumableJobId ?? null);
                }
              }
              if (event.status !== "AI_ANALYSIS_PARTIAL") {
                setContinueJobId(null);
              } else if (event.jobId) {
                setContinueJobId(event.jobId);
              }
              done = true;
            } else if (event.phase === "error") {
              setError(event.message ?? "Analysis failed");
              done = true;
            }
          } catch { /* ignore */ }
        }
      }

      if (done && !streamedFallback) {
        startTransition(() => {
          router.refresh();
        });
      } else {
        startTransition(() => {
          router.refresh();
        });
      }
    } catch (err) {
      setError("Analysis failed due to a network error.");
    } finally {
      setAnalyzing(false);
      setAnalyzePhase("");
      setAnalyzeProgress(0);
    }
  }

  const showAutoRetryBanner = autoRetrySecondsLeft !== null && autoRetrySecondsLeft > 0;

  return (
    <section id="ai-analyze-section" className="mb-4 rounded-2xl border border-purple-100 bg-purple-50/30 p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-purple-700">AI analysis action</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">
            {analyzing ? "AI Analysis in progress" : continueJobId ? "Resume AI Analysis" : "Run AI Analysis"}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Extract requirements, client details, and evaluation criteria. Analysis is chunked and resumable.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {aiEnabled ? (
            <button
              onClick={handleAnalyzeStreaming}
              disabled={analyzing}
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {analyzing ? (analyzePhase || "Analyzing…") : continueJobId ? "✦ Resume AI Analyze" : "✦ Run AI Analyze"}
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
            <div
              className="h-full bg-purple-600 transition-all duration-500"
              style={{ width: `${analyzeProgress}%` }}
            />
          </div>
        </div>
      )}

      {showAutoRetryBanner && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-xl">⏳</span>
              <div>
                <p className="text-sm font-bold text-amber-900">AI providers cooling down</p>
                <p className="text-xs text-amber-700">
                  Automatically retrying {analyzeResult?.resumableJobId ? "to resume " : ""}in <strong>{autoRetrySecondsLeft}</strong> seconds...
                </p>
              </div>
            </div>
            <button
              onClick={cancelAutoRetry}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50"
            >
              Cancel Auto-retry
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">Analysis failed</p>
          <p className="mt-1">{error}</p>
          <button
            onClick={() => setError("")}
            className="mt-2 text-xs font-medium underline hover:text-red-900"
          >
            Dismiss
          </button>
        </div>
      )}

      {!analyzing && !error && analyzeResult?.chunks && (
        <div className="mt-4">
          <AiAnalyzeStatusBanner
            chunks={analyzeResult.chunks}
            jobId={analyzeResult.jobId}
            isAnalyzing={false}
            onContinue={handleAnalyzeStreaming}
            onRetry={() => { setContinueJobId(null); handleAnalyzeStreaming(); }}
          />
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
