"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SparklesIcon, RefreshIcon } from "./icons";

type JobStatus = "QUEUED" | "RUNNING" | "PARTIAL_SUCCESS" | "SUCCEEDED" | "FAILED" | "CANCELED";

type Props = {
  tenderId: string;
  initialContinueJobId?: string | null;
  aiEnabled: boolean;
};

const POLL_INTERVAL_MS = 3_000;
const TERMINAL: JobStatus[] = ["SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "CANCELED"];

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function AIAnalyzePanel({ tenderId, aiEnabled }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [analyzing, setAnalyzing] = useState(false);
  const [phase, setPhase] = useState("");
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState("");
  // Worker-start failures (401/403/500 from run-next) are surfaced SEPARATELY
  // and never silently swallowed — the job is still queued, so we keep polling.
  const [workerError, setWorkerError] = useState("");

  // Set to true on unmount / new run so an in-flight poll loop stops cleanly.
  const cancelledRef = useRef(false);
  useEffect(() => {
    return () => { cancelledRef.current = true; };
  }, []);

  // Durable background analysis: enqueue ONE AI_ANALYZE job, kick the worker,
  // and poll the job until it reaches a terminal state. This deliberately does
  // NOT use the direct SSE route — that path is bounded by the Vercel function
  // limit and is not the durable worker.
  async function handleBackgroundAnalyze() {
    cancelledRef.current = false;
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
      let job: { status: JobStatus; errorMessage: string | null; steps?: Array<{ message: string | null }> } | null = null;
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
        } else if (job.status === "PARTIAL_SUCCESS") {
          setError("Analysis is only partial — some tender content could not be analyzed. Generation and export stay blocked until a full analysis succeeds.");
          startTransition(() => router.refresh());
        } else {
          setError(job.errorMessage || "AI analysis failed. You can retry.");
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
          <p className="text-xs font-semibold uppercase tracking-wide text-purple-700">AI analysis action</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">
            {analyzing ? "AI Analysis in progress" : "Run AI Analysis"}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Extract requirements, client details, and evaluation criteria. Analysis runs as a durable
            background job so it survives function timeouts.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {aiEnabled ? (
            <button
              onClick={handleBackgroundAnalyze}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
            >
              <SparklesIcon />
              {analyzing ? (phase || "Analyzing…") : "Run AI Analyze"}
            </button>
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

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">Analysis {jobStatus === "PARTIAL_SUCCESS" ? "Incomplete" : "Error"}</p>
          <p className="mt-1 text-red-700">{error}</p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => { setError(""); handleBackgroundAnalyze(); }}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              <RefreshIcon /> Retry AI Analyze
            </button>
            <button
              onClick={() => setError("")}
              className="text-xs font-medium underline hover:text-red-900"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
