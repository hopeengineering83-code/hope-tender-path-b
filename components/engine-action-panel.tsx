"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type ExtractionBlocker = {
  fileName?: string;
  quality?: {
    severity?: string;
    score?: number;
    warnings?: string[];
    blockers?: string[];
  };
};

type EngineResponse = {
  success?: boolean;
  error?: string;
  code?: string;
  nextAction?: string;
  hint?: string;
  detail?: string;
  diagnosticId?: string;
  blockers?: ExtractionBlocker[];
  extractionWarnings?: ExtractionBlocker[];
  tender?: unknown;
  // Async-mode fields (?async=true → 202 with jobId)
  async?: boolean;
  jobId?: string;
  message?: string;
  // Structured failure info from job.output or engine postconditions
  failedStage?: string;
  safeModeAvailable?: boolean;
  reused?: boolean;
  inputStats?: { fileCount?: number; totalChars?: number; safeModeAvailable?: boolean };
};

// Async polling — escapes the 60s Vercel Hobby cap by enqueuing an
// ENGINE_RUN AiJob and watching it from the browser.
const POLL_INTERVAL_MS = 3000;
// Extended to 10 minutes for large tenders (the prior 5-minute window
// kept giving up on multi-file analyses while the worker was still
// running). The user-facing message also clarifies that a poll
// timeout is NOT a worker failure — the job typically completes in
// the background and the user just needs to refresh.
const MAX_POLL_DURATION_MS = 10 * 60 * 1000;

function actionLabel(action?: string) {
  if (action === "UPLOAD_TENDER_DOCUMENT") return "Upload the tender/RFP document, then run Engine.";
  if (action === "OPEN_EXTRACTION_QUALITY") return "Open Extraction Quality and fix/OCR weak files.";
  if (action === "RETRY_OR_REDUCE_INPUT") return "Retry, or reduce duplicate/oversized tender inputs.";
  if (action === "RETRY_BACKGROUND_JOB") return "Click 'Run in background' again — this was a temporary network failure.";
  if (action === "RETRY_AFTER_DATABASE_CHECK") return "Check database/Vercel runtime, then retry.";
  if (action === "RETRY_AS_BACKGROUND_JOB") return "Click \"Run in background\" — escapes the 60s Vercel function cap.";
  if (action === "OPEN_TENDER_LIST") return "Return to tender list and reopen this tender.";
  if (action === "LOGIN_AGAIN") return "Sign in again, then retry.";
  if (action === "OPEN_EXTRACTION_ANALYSIS_MATCHING_QUALITY") return "Review Extraction, Analysis, and Matching Quality panels.";
  if (action === "REFRESH_TO_CHECK_STATUS") return "Click \"Check status now\" or refresh — the worker is finishing in the background.";
  if (action === "RUN_ENGINE_SAFE_MODE") return "Re-run in Safe Mode — reduces text, skips AI rematch, uses deterministic matching only.";
  if (action === "REVIEW_MATCHING_INPUTS") return "Review vault experts/projects and re-run Engine to generate match rows.";
  return null;
}

async function parseEngineResponse(res: Response): Promise<EngineResponse> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await res.json() as EngineResponse;
  }
  const text = await res.text().catch(() => "");
  const clean = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 320);

  // Detect Vercel's function-invocation timeout. When the route exceeds
  // the 60s function budget, Vercel responds at the platform layer with
  // an HTML error page containing "FUNCTION_INVOCATION_TIMEOUT" — our
  // route's catch block never runs, so actionableEngineError can't map
  // it. Recognise the pattern here and surface the correct
  // RETRY_AS_BACKGROUND_JOB hint instead of the generic
  // "Check database/Vercel runtime, then retry" that misled users on
  // the May 16 screenshot.
  const isVercelTimeout = res.status === 504 || /function_invocation_timeout/i.test(clean) || /function_invocation_timeout/i.test(res.statusText ?? "");

  if (isVercelTimeout) {
    return {
      error: "Engine run exceeded the 60s Vercel function budget.",
      code: "ENGINE_VERCEL_TIMEOUT",
      detail: clean || `Vercel returned ${res.status} ${res.statusText || "Function Invocation Timeout"} before the route could respond.`,
      nextAction: "RETRY_AS_BACKGROUND_JOB",
      hint: "Click \"Run in background\" — the async ENGINE_RUN job has its own 60s function budget per chunk and survives chunked sub-jobs. For very large tenders this is the only reliable path on Vercel Hobby.",
    };
  }

  return {
    error: `Engine run failed: server returned a non-JSON response (${res.status} ${res.statusText || "HTTP error"}).`,
    code: "NON_JSON_RESPONSE",
    detail: clean || "No response body was returned. Check Vercel function logs for this request.",
    nextAction: res.status === 401 ? "LOGIN_AGAIN" : "RETRY_AFTER_DATABASE_CHECK",
    hint: "This usually means the route crashed before returning JSON, authentication redirected, or the deployment is serving an error page.",
  };
}

// Vaults with more than this many total reviewed records typically exceed
// Vercel's 60 s function cap during matching — safe mode is recommended.
const LARGE_VAULT_THRESHOLD = 30;

export function EngineActionPanel({
  tenderId,
  vaultReviewedExperts = 0,
  vaultReviewedProjects = 0,
}: {
  tenderId: string;
  vaultReviewedExperts?: number;
  vaultReviewedProjects?: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EngineResponse | null>(null);
  // Async-mode UX — when null we're in sync mode; otherwise this is the
  // active jobId being polled and the latest progress message.
  const [asyncStatus, setAsyncStatus] = useState<{ jobId: string; message: string } | null>(null);
  const isLargeVault = (vaultReviewedExperts + vaultReviewedProjects) > LARGE_VAULT_THRESHOLD;

  async function runEngine(force = false) {
    setRunning(true);
    setResult(null);
    setAsyncStatus(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/engine${force ? "?force=true" : ""}`, { method: "POST" });
      const data = await parseEngineResponse(res);
      if (!res.ok) {
        // ─── Auto-promote to background on Vercel function timeout ──────
        // The 60s Hobby cap is the single biggest source of "Run Engine
        // didn't work" pain. The user-merged production tender showed
        // FUNCTION_INVOCATION_TIMEOUT three runs in a row before the
        // user remembered to click "Run in background" manually. When
        // we detect the timeout signature, transparently retry in async
        // mode — same click, same expectation, just with the path that
        // actually works on Hobby for large tenders.
        const isVercelTimeout = data.code === "ENGINE_VERCEL_TIMEOUT" || data.code === "GENERATION_TIMEOUT" || res.status === 504;
        if (isVercelTimeout) {
          setResult({
            ...data,
            error: `${data.error ?? "Engine hit the 60s Vercel cap."} Auto-retrying in background mode…`,
            code: "AUTO_PROMOTING_TO_BACKGROUND",
            nextAction: "RETRY_AS_BACKGROUND_JOB",
          });
          // Fire the async path. The setRunning(false) in the finally
          // below releases the button; runEngineAsync re-asserts it
          // and drives its own state machine until the poll completes.
          await runEngineAsync(force);
          return;
        }
        setResult(data);
        return;
      }
      setResult({ ...data, success: true, error: "Engine completed successfully." });
      startTransition(() => router.refresh());
    } catch (error) {
      setResult({
        error: error instanceof Error ? `Engine run failed: ${error.message}` : "Engine run failed due to a network/runtime error.",
        code: "NETWORK_OR_RUNTIME_ERROR",
        nextAction: "RETRY_OR_REDUCE_INPUT",
      });
    } finally {
      setRunning(false);
    }
  }

  // Async mode — enqueue + worker + poll. Escapes the 60s Hobby cap for
  // large tenders where the synchronous engine pipeline would time out.
  // extraParams allows callers to pass ?safe=true or ?skipAiRematch=true.
  async function runEngineAsync(force = false, extraParams: Record<string, string> = {}) {
    setRunning(true);
    setResult(null);
    setAsyncStatus(null);
    try {
      // 1. Enqueue the job — returns 202 with { jobId }
      const qs = new URLSearchParams({ async: "true", ...extraParams });
      if (force) qs.set("force", "true");
      const enqueueRes = await fetch(`/api/tenders/${tenderId}/engine?${qs.toString()}`, { method: "POST" });
      const enqueueData = await parseEngineResponse(enqueueRes);
      if (!enqueueRes.ok || !enqueueData.jobId) {
        setResult(enqueueData);
        return;
      }
      const jobId = enqueueData.jobId;
      setAsyncStatus({ jobId, message: "Engine queued. Kicking off worker…" });

      // 2. Kick off the worker (fire-and-forget — separate 60s function invocation)
      fetch("/api/ai-jobs/run-next", { method: "POST" }).catch(() => {
        // worker may already be running; not fatal — polling will still observe progress
      });

      // 3. Poll status every 3s until SUCCEEDED / FAILED / timeout
      const startedAt = Date.now();
      let finalStatus: "SUCCEEDED" | "FAILED" | null = null;
      let finalJob: {
        errorMessage?: string | null;
        output?: Record<string, unknown> | null;
        steps?: Array<{ stepName?: string; message?: string }>;
      } | null = null;
      while (Date.now() - startedAt < MAX_POLL_DURATION_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const pollRes = await fetch(`/api/ai-jobs/${jobId}`, { method: "GET" });
        if (!pollRes.ok) continue; // transient — keep polling
        const { job } = await pollRes.json() as {
          job: {
            status: string;
            errorMessage?: string | null;
            output?: Record<string, unknown> | null;
            steps?: Array<{ stepName?: string; message?: string }>;
          };
        };
        const lastStep = job.steps?.[job.steps.length - 1];
        setAsyncStatus({ jobId, message: lastStep?.message ?? `Worker status: ${job.status}` });
        if (job.status === "SUCCEEDED" || job.status === "FAILED") {
          finalStatus = job.status;
          finalJob = job;
          break;
        }
      }

      if (finalStatus === "SUCCEEDED") {
        setResult({ success: true, async: true, jobId, error: "Engine completed successfully (background)." });
        startTransition(() => router.refresh());
      } else if (finalStatus === "FAILED") {
        const jobOutput = finalJob?.output as Record<string, unknown> | null | undefined;
        const engineCode = typeof jobOutput?.code === "string" ? jobOutput.code : "ASYNC_ENGINE_FAILED";
        const failedStage = typeof jobOutput?.failedStage === "string" ? jobOutput.failedStage : undefined;
        const engineNextAction = typeof jobOutput?.nextAction === "string" ? jobOutput.nextAction : "RETRY_OR_REDUCE_INPUT";
        setResult({
          error: `Engine background run failed: ${finalJob?.errorMessage ?? "unknown worker error"}`,
          code: engineCode,
          nextAction: engineNextAction,
          failedStage,
          safeModeAvailable: jobOutput?.safeModeAvailable === true,
          jobId,
        });
      } else {
        // A poll timeout is NOT a failure — the worker is still running
        // on Vercel and will complete the job in the background. The
        // user just needs to refresh (the page will pick up the new
        // matches + analysis as soon as the worker writes them).
        // Display a calm, actionable message instead of an error.
        setResult({
          error: "Engine is still running in the background (10 min poll window elapsed). The worker continues — refresh in 1-2 minutes to see the completed engine run.",
          code: "ASYNC_POLL_TIMEOUT",
          nextAction: "REFRESH_TO_CHECK_STATUS",
          jobId,
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      const isNetworkFailure = msg === "Failed to fetch" || msg.toLowerCase().includes("network") || msg.toLowerCase().includes("connection");
      setResult({
        error: isNetworkFailure
          ? "Connection failed — the server could not be reached. This is usually a temporary network issue."
          : `Engine async run failed: ${msg || "unknown error"}`,
        code: "NETWORK_OR_RUNTIME_ERROR",
        nextAction: isNetworkFailure ? "RETRY_BACKGROUND_JOB" : "RETRY_OR_REDUCE_INPUT",
      });
    } finally {
      setRunning(false);
      setAsyncStatus(null);
    }
  }

  const ok = result?.success === true;
  const action = actionLabel(result?.nextAction);
  const extractionBlocked = result?.code === "EXTRACTION_NOT_READY";

  return (
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Run Engine control</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">Run tender engine with structured diagnostics</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Use this panel for Run Engine. It displays error code, next action, hint, detail, extraction blockers, and diagnostic ID from the backend.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {extractionBlocked && (
            <button
              onClick={() => runEngine(true)}
              disabled={running || isPending}
              className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Force run once
            </button>
          )}
          <button
            onClick={() => runEngine(false)}
            disabled={running || isPending}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            title="Synchronous — bound to 60s Vercel route cap"
          >
            {running || isPending ? "Running…" : "Run Engine"}
          </button>
          <button
            onClick={() => runEngineAsync(false)}
            disabled={running || isPending}
            className="rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
            title="Queues an AiJob and watches it in the background — escapes the 60s cap for large tenders"
          >
            {running && asyncStatus ? "Running in background…" : "⏳ Run in background"}
          </button>
        </div>
      </div>

      {isLargeVault && !result && !running && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-semibold">Large vault detected — use Safe Mode for reliable matching</p>
          <p className="mt-1">
            Your vault has <strong>{vaultReviewedExperts}</strong> reviewed expert(s) and <strong>{vaultReviewedProjects}</strong> reviewed project(s).
            Matching this many records can exceed Vercel&apos;s 60-second function limit.
            Use <strong>Run Safe Mode</strong> (skips AI rematch, uses deterministic scoring) for a reliable first run.
            You can follow up with a full AI rematch once matches exist.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => runEngineAsync(false, { safe: "true", skipAiRematch: "true" })}
              disabled={running || isPending}
              className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Run Safe Mode (recommended)
            </button>
            <button
              onClick={() => runEngineAsync(false)}
              disabled={running || isPending}
              className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Run full mode anyway
            </button>
          </div>
        </div>
      )}

      {asyncStatus && (
        <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-800">
          <p className="font-semibold">Background engine run in progress…</p>
          <p className="mt-1">{asyncStatus.message}</p>
          <p className="mt-2 text-xs text-indigo-600">
            Job ID: <span className="font-mono">{asyncStatus.jobId}</span> · polls every 3s · 10-min poll ceiling (worker continues beyond that)
          </p>
        </div>
      )}

      {result && (
        <div className={`mt-4 rounded-xl border p-4 text-sm ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : result?.code === "ASYNC_POLL_TIMEOUT" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-800"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{result.error ?? (ok ? "Engine completed." : "Engine failed.")}</p>
            {result.code && <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold">{result.code}</span>}
            {result.diagnosticId && <span className="rounded-full bg-white px-2 py-0.5 text-xs font-mono">{result.diagnosticId}</span>}
          </div>
          {action && <p className="mt-2"><strong>Next action:</strong> {action}</p>}
          {result.hint && <p className="mt-1"><strong>Hint:</strong> {result.hint}</p>}
          {result.detail && <p className="mt-1"><strong>Detail:</strong> {result.detail}</p>}

          {/* ASYNC_POLL_TIMEOUT — the worker is still running on Vercel
              but the browser stopped polling. Give the user a one-click
              "Check status now" affordance that fetches the job once
              more and either resolves (showing success/failure) or
              prompts a page refresh. Avoids the user having to know
              that "the worker may still be running" means "click
              refresh to see the result". */}
          {result.code === "ASYNC_POLL_TIMEOUT" && result.jobId && (
            <button
              type="button"
              onClick={async () => {
                try {
                  const r = await fetch(`/api/ai-jobs/${result.jobId}`, { method: "GET" });
                  const j = await r.json().catch(() => ({}));
                  const jobStatus = j?.job?.status ?? j?.status;
                  const jobError = j?.job?.errorMessage ?? j?.errorMessage;
                  if (jobStatus === "SUCCEEDED") {
                    setResult({ success: true, async: true, jobId: result.jobId, error: "Engine completed successfully (background)." });
                    startTransition(() => router.refresh());
                  } else if (jobStatus === "FAILED") {
                    setResult({
                      error: `Engine background run failed: ${jobError ?? "unknown worker error"}`,
                      code: "ASYNC_ENGINE_FAILED",
                      nextAction: "RETRY_OR_REDUCE_INPUT",
                      jobId: result.jobId,
                    });
                  } else {
                    setResult({
                      ...result,
                      error: `Worker status: ${jobStatus ?? "RUNNING"} — still working. Try again in 1-2 min.`,
                    });
                  }
                } catch {
                  // Keep current result on network error — user can click again.
                }
              }}
              className="mt-3 rounded-lg border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
            >
              Check status now
            </button>
          )}

          {result.code === "NETWORK_OR_RUNTIME_ERROR" && result.nextAction === "RETRY_BACKGROUND_JOB" && (
            <button
              type="button"
              onClick={() => { setResult(null); runEngineAsync(); }}
              className="mt-3 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50"
            >
              Retry background run
            </button>
          )}

          {(result.code === "ASYNC_ENGINE_FAILED" || result.code === "ASYNC_ENGINE_TIMEOUT") && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => runEngineAsync(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Retry from start
              </button>
              <button
                type="button"
                onClick={() => runEngineAsync(false, { safe: "true" })}
                className="rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
                title="Deduplicates text and skips AI rematch — more reliable for large tenders"
              >
                Run Safe Mode
              </button>
              <button
                type="button"
                onClick={() => runEngineAsync(false, { skipAiRematch: "true" })}
                className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100"
                title="Skips the 12-perspective AI rematch — faster but no AI score refinement"
              >
                Skip AI Rematch
              </button>
              {result.failedStage && (
                <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs text-red-700">
                  Failed at: {result.failedStage}
                </span>
              )}
            </div>
          )}

          {Array.isArray(result.blockers) && result.blockers.length > 0 && (
            <div className="mt-3 rounded-lg bg-white p-3">
              <p className="font-semibold">Extraction blockers</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {result.blockers.slice(0, 5).map((blocker, index) => (
                  <li key={`${blocker.fileName ?? "file"}-${index}`}>
                    {blocker.fileName ?? "File"}: {blocker.quality?.severity ?? "blocked"}
                    {typeof blocker.quality?.score === "number" ? ` (${blocker.quality.score}/100)` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
