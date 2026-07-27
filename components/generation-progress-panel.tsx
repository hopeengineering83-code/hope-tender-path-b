"use client";

// GenerationProgressPanel — live polling panel for document generation jobs.
// Polls /api/ai-jobs/[jobId] every 2 seconds while the job is QUEUED or
// RUNNING and shows step-by-step progress, elapsed time, and final result.
// Auto-hides 10 seconds after SUCCEEDED.

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, CrossIcon, ClockIcon } from "./icons";

// ─── Types (mirrors the shape returned by GET /api/ai-jobs/[id]) ─────────────

type StepStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";

interface JobStep {
  stepIndex: number;
  stepName: string;
  status: string;
  message: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

type JobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "PARTIAL_SUCCESS" | "FAILED" | "CANCELED";

interface JobData {
  id: string;
  jobType: string;
  status: JobStatus;
  errorMessage: string | null;
  output: Record<string, unknown> | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  steps: JobStep[];
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface GenerationProgressPanelProps {
  tenderId: string;
  jobId: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isTerminal(status: JobStatus): boolean {
  return status === "SUCCEEDED" || status === "PARTIAL_SUCCESS" || status === "FAILED" || status === "CANCELED";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem === 0 ? `${mins}m` : `${mins}m ${rem}s`;
}

function stepIcon(status: string) {
  if (status === "SUCCEEDED") return <CheckIcon />;
  if (status === "FAILED") return <CrossIcon />;
  if (status === "RUNNING") return <ClockIcon />;
  return null;
}

function stepRowClass(status: string): string {
  if (status === "SUCCEEDED") return "text-emerald-700";
  if (status === "FAILED") return "text-red-600";
  if (status === "RUNNING") return "text-blue-700 font-semibold";
  return "text-slate-400";
}

function StatusBadge({ status }: { status: JobStatus }) {
  const map: Record<JobStatus, string> = {
    QUEUED: "bg-slate-100 text-slate-700",
    RUNNING: "bg-blue-100 text-blue-700",
    SUCCEEDED: "bg-emerald-100 text-emerald-700",
    PARTIAL_SUCCESS: "bg-amber-100 text-amber-800",
    FAILED: "bg-red-100 text-red-700",
    CANCELED: "bg-slate-100 text-slate-500",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${map[status] ?? "bg-slate-100 text-slate-700"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

// Simple CSS spinner — no extra deps.
function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700"
      aria-label="Loading"
    />
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GenerationProgressPanel({ tenderId: _tenderId, jobId }: GenerationProgressPanelProps) {
  const [job, setJob] = useState<JobData | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number>(0);
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState(false);

  // Stable ref for the hide-after-success timer so it can be cleared on unmount.
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Polling ────────────────────────────────────────────────────────────────

  const poll = useCallback(async () => {
    if (!jobId) return;
    try {
      const res = await fetch(`/api/ai-jobs/${jobId}`, { cache: "no-store" });
      if (!res.ok) {
        // 404 immediately after enqueue is fine — worker hasn't started yet.
        if (res.status !== 404) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          setFetchError(body.error ?? `HTTP ${res.status}`);
        }
        return;
      }
      const data = await res.json() as { job?: JobData };
      if (data.job) {
        setJob(data.job);
        setFetchError(null);
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Network error");
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;

    // Reset state when jobId changes (new generation run).
    setJob(null);
    setFetchError(null);
    setElapsed(0);
    setCollapsed(false);
    setHidden(false);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);

    // Initial fetch immediately.
    void poll();

    // Poll every 2 seconds.
    const intervalId = setInterval(() => { void poll(); }, 2_000);

    return () => { clearInterval(intervalId); };
  }, [jobId, poll]);

  // Stop polling once terminal; schedule auto-hide on SUCCEEDED.
  useEffect(() => {
    if (!job) return;
    if (isTerminal(job.status)) {
      // Stop elapsed counter.
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
      if (job.status === "SUCCEEDED") {
        hideTimerRef.current = setTimeout(() => setHidden(true), 10_000);
      }
    }
  }, [job]);

  // Live elapsed-time counter while RUNNING.
  useEffect(() => {
    if (!job || job.status !== "RUNNING" || !job.startedAt) return;

    const start = new Date(job.startedAt).getTime();

    // Update immediately, then every second.
    setElapsed(Date.now() - start);
    elapsedTimerRef.current = setInterval(() => {
      setElapsed(Date.now() - start);
    }, 1_000);

    return () => {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, [job?.status, job?.startedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  // ── Render guards ──────────────────────────────────────────────────────────

  if (!jobId) return null;
  if (hidden) return null;

  // Before first successful poll, show a minimal "waiting" state.
  if (!job && !fetchError) {
    return (
      <section className="mb-4 rounded-2xl border border-blue-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <Spinner />
          <p className="text-sm text-slate-600">Waiting for generation job to start…</p>
        </div>
      </section>
    );
  }

  if (!job && fetchError) {
    return (
      <section className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm">
        <p className="text-sm text-red-700">Progress panel error: {fetchError}</p>
      </section>
    );
  }

  // TypeScript narrow — job is non-null from here.
  const j = job!;

  // ── Duration display ───────────────────────────────────────────────────────

  let durationLabel: string | null = null;
  if (j.status === "RUNNING" && elapsed > 0) {
    durationLabel = formatDuration(elapsed);
  } else if (j.startedAt && j.finishedAt) {
    const ms = new Date(j.finishedAt).getTime() - new Date(j.startedAt).getTime();
    durationLabel = formatDuration(ms);
  } else if (j.startedAt) {
    const ms = Date.now() - new Date(j.startedAt).getTime();
    durationLabel = formatDuration(ms);
  }

  // ── Output: doc count ─────────────────────────────────────────────────────

  let docsGenerated: number | null = null;
  if (j.output) {
    const raw = j.output.supportDocumentCount ?? j.output.docsGenerated;
    if (typeof raw === "number") docsGenerated = raw;
  }

  // ── Panel border/bg colour ────────────────────────────────────────────────

  const panelClass =
    j.status === "SUCCEEDED" || j.status === "PARTIAL_SUCCESS"
      ? "border-emerald-200 bg-white"
      : j.status === "FAILED" || j.status === "CANCELED"
        ? "border-red-200 bg-red-50"
        : "border-blue-200 bg-white";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${panelClass}`} aria-live="polite">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {j.status === "RUNNING" && <Spinner />}
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Generation progress</p>
          <StatusBadge status={j.status} />
          {durationLabel && (
            <span className="text-xs text-slate-500 tabular-nums">{durationLabel}</span>
          )}
        </div>

        <button
          onClick={() => setCollapsed((c) => !c)}
          className="shrink-0 rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100"
          aria-label={collapsed ? "Expand progress panel" : "Collapse progress panel"}
        >
          {collapsed ? "Show" : "Hide"}
        </button>
      </div>

      {!collapsed && (
        <div className="mt-3 space-y-3">
          {/* Success message */}
          {(j.status === "SUCCEEDED" || j.status === "PARTIAL_SUCCESS") && (
            <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {j.status === "PARTIAL_SUCCESS" ? "Generation completed with warnings." : "Documents generated successfully."}
              {docsGenerated !== null && (
                <span className="ml-1 font-semibold">{docsGenerated} document{docsGenerated !== 1 ? "s" : ""} created.</span>
              )}
              {" "}This panel hides automatically in 10 seconds.
            </div>
          )}

          {/* Failure message */}
          {(j.status === "FAILED" || j.status === "CANCELED") && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
              {j.status === "CANCELED" ? "Job was canceled." : "Generation failed."}
              {j.errorMessage && (
                <span className="ml-1">{j.errorMessage.slice(0, 300)}</span>
              )}
            </div>
          )}

          {/* Steps list */}
          {j.steps.length > 0 && (
            <ol className="space-y-1 text-sm" aria-label="Generation steps">
              {j.steps.map((step, i) => (
                <li key={step.stepIndex ?? i} className={`flex items-start gap-2 ${stepRowClass(step.status)}`}>
                  <span className="mt-0.5 w-4 shrink-0 text-center font-mono text-xs select-none" aria-hidden="true">
                    {stepIcon(step.status)}
                  </span>
                  <span className="min-w-0 break-words">
                    <span className="font-medium">{step.stepName}</span>
                    {step.message && (
                      <span className="ml-1.5 text-xs opacity-75">{step.message.slice(0, 120)}</span>
                    )}
                  </span>
                  {step.finishedAt && step.startedAt && (
                    <span className="ml-auto shrink-0 text-xs opacity-60 tabular-nums">
                      {formatDuration(new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime())}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}

          {/* Queued / no steps yet */}
          {j.status === "QUEUED" && j.steps.length === 0 && (
            <p className="text-sm text-slate-500">Job is queued — waiting for a worker to pick it up…</p>
          )}

          {/* Running / no steps yet */}
          {j.status === "RUNNING" && j.steps.length === 0 && (
            <p className="text-sm text-slate-500">Generation started — step details will appear shortly.</p>
          )}

          {/* Fetch error (non-fatal, poll keeps running) */}
          {fetchError && (
            <p className="text-xs text-amber-800">Status fetch warning: {fetchError}</p>
          )}
        </div>
      )}
    </section>
  );
}
