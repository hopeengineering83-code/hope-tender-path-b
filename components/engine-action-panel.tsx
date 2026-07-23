"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BoltIcon, ClockIcon, ChevronDownIcon, ArrowRightIcon } from "./icons";
import { formatOperationalCode, formatOperationalReason } from "../lib/operational-labels";

type ExtractionBlocker = {
  fileName?: string;
  quality?: {
    severity?: string;
    score?: number;
    warnings?: string[];
    blockers?: string[];
  };
};

export function describeEngineBlocker(blocker: ExtractionBlocker | string): string {
  if (typeof blocker === "string") return formatOperationalReason(blocker);
  const name = blocker.fileName?.trim();
  const severity = blocker.quality?.severity?.trim();
  if (!name && !severity) {
    return "A source file is blocked, but the engine returned no detailed diagnostic. Open Extraction Quality for the full report.";
  }
  const score = typeof blocker.quality?.score === "number" ? ` (${blocker.quality.score}/100)` : "";
  return `${name ?? "Unnamed file"}: ${formatOperationalCode(severity ?? "EXTRACTION_BLOCKED")}${score}`;
}

export type EngineResponse = {
  success?: boolean;
  ok?: boolean;
  partial?: boolean;
  error?: string;
  code?: string;
  nextAction?: string;
  hint?: string;
  detail?: string;
  diagnosticId?: string;
  blockers?: (ExtractionBlocker | string)[];
  partialBlockers?: string[];
  evidenceMatchingBlocker?: { code: string; message: string } | null;
  analysisMethod?: string;
  extractionWarnings?: ExtractionBlocker[];
  tender?: unknown;
  async?: boolean;
  jobId?: string;
  message?: string;
  failedStage?: string;
  safeModeAvailable?: boolean;
  reused?: boolean;
  inputStats?: { fileCount?: number; totalChars?: number; safeModeAvailable?: boolean };
};

export type EngineAsyncStatus = { jobId: string; message: string };

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000;
const LARGE_VAULT_THRESHOLD = 30;

function actionLabel(action?: string) {
  if (action === "UPLOAD_TENDER_DOCUMENT") return "Upload the tender source document, then run Engine.";
  if (action === "OPEN_EXTRACTION_QUALITY") return "Open Extraction Quality and repair weak or unreadable files.";
  if (action === "RETRY_OR_REDUCE_INPUT") return "Retry, or remove duplicate and oversized tender inputs.";
  if (action === "RETRY_BACKGROUND_JOB") return "Retry the background run; the previous request failed before completion.";
  if (action === "RETRY_AFTER_DATABASE_CHECK") return "Check database/runtime readiness, then retry.";
  if (action === "RETRY_AS_BACKGROUND_JOB") return "Run the engine in the background.";
  if (action === "OPEN_TENDER_LIST") return "Return to the tender list and reopen this tender.";
  if (action === "LOGIN_AGAIN") return "Sign in again, then retry.";
  if (action === "OPEN_EXTRACTION_ANALYSIS_MATCHING_QUALITY") return "Review Extraction, Analysis, and Matching Quality.";
  if (action === "REFRESH_TO_CHECK_STATUS") return "Check status again or refresh the workspace.";
  if (action === "RUN_ENGINE_SAFE_MODE") return "Run Safe Mode for a deterministic first pass.";
  if (action === "REVIEW_MATCHING_INPUTS") return "Review the tender requirements and vault classifications, then rerun Safe Mode.";
  return null;
}

function humanBlockerSummary(blockers: string[] | undefined): string {
  if (!Array.isArray(blockers) || blockers.length === 0) {
    return "Evidence matching needs review before the workflow can continue.";
  }
  return blockers.map((blocker) => formatOperationalReason(blocker)).join("; ");
}

async function parseEngineResponse(res: Response): Promise<EngineResponse> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await res.json() as EngineResponse;
  }

  const text = await res.text().catch(() => "");
  const clean = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 320);
  const isVercelTimeout = res.status === 504 || /function_invocation_timeout/i.test(clean) || /function_invocation_timeout/i.test(res.statusText ?? "");

  if (isVercelTimeout) {
    return {
      error: "The synchronous engine request exceeded the hosting time limit.",
      code: "ENGINE_VERCEL_TIMEOUT",
      detail: clean || `The platform returned ${res.status} ${res.statusText || "Function Invocation Timeout"}.`,
      nextAction: "RETRY_AS_BACKGROUND_JOB",
      hint: "Use the background engine path for large tender packages.",
    };
  }

  return {
    error: `The engine returned an invalid server response (${res.status} ${res.statusText || "HTTP error"}).`,
    code: "NON_JSON_RESPONSE",
    detail: clean || "No response body was returned.",
    nextAction: res.status === 401 ? "LOGIN_AGAIN" : "RETRY_AFTER_DATABASE_CHECK",
    hint: "The route may have failed before returning JSON, authentication may have expired, or the deployment may be unavailable.",
  };
}

export const ENGINE_MUTATION_BLOCKED_RESULT: EngineResponse = {
  error: "Engine actions are read-only for your role. No request was sent.",
  code: "ROLE_READ_ONLY_MUTATION_BLOCKED",
  detail: "Engine runs require the ADMIN or PROPOSAL_MANAGER role. The server enforces this independently.",
};

export type EngineRunCallbacks = {
  setRunning: (running: boolean) => void;
  setResult: (result: EngineResponse | null) => void;
  setAsyncStatus: (status: EngineAsyncStatus | null) => void;
  onSuccess: () => void;
};

export type EngineRunOptions = {
  tenderId: string;
  canMutate: boolean;
  force?: boolean;
  lifecycleBlockersExist?: boolean;
  callbacks: EngineRunCallbacks;
};

export type EngineAsyncRunOptions = EngineRunOptions & {
  extraParams?: Record<string, string>;
  pollIntervalMs?: number;
  maxPollDurationMs?: number;
};

export async function executeEngineRun(options: EngineRunOptions): Promise<void> {
  const { tenderId, canMutate, force = false, lifecycleBlockersExist = false, callbacks } = options;
  if (!canMutate) {
    callbacks.setResult(ENGINE_MUTATION_BLOCKED_RESULT);
    return;
  }

  callbacks.setRunning(true);
  callbacks.setResult(null);
  callbacks.setAsyncStatus(null);
  try {
    const res = await fetch(`/api/tenders/${tenderId}/engine${force ? "?force=true" : ""}`, { method: "POST" });
    const data = await parseEngineResponse(res);
    if (!res.ok) {
      const isVercelTimeout = data.code === "ENGINE_VERCEL_TIMEOUT" || data.code === "GENERATION_TIMEOUT" || res.status === 504;
      if (isVercelTimeout) {
        callbacks.setResult({
          ...data,
          error: "The synchronous engine request reached the hosting time limit. Continuing in the background…",
          code: "AUTO_PROMOTING_TO_BACKGROUND",
          nextAction: "RETRY_AS_BACKGROUND_JOB",
        });
        await executeEngineRunAsync({ ...options, force });
        return;
      }
      callbacks.setResult(data);
      return;
    }

    if (data.partial) {
      const rawBlockers = (data as { blockers?: string[] }).blockers;
      callbacks.setResult({
        ...data,
        success: false,
        error: "Engine processing completed, but evidence matching still needs review.",
        detail: humanBlockerSummary(rawBlockers),
        code: data.evidenceMatchingBlocker?.code ?? "EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED",
        nextAction: data.nextAction ?? "REVIEW_MATCHING_INPUTS",
      });
      callbacks.onSuccess();
      return;
    }

    const warningCount = Array.isArray(data?.extractionWarnings) ? data.extractionWarnings.length : 0;
    callbacks.setResult({
      ...data,
      success: true,
      error: warningCount > 0
        ? `Engine completed with ${warningCount} extraction warning(s). Follow the Next Required Action card above.`
        : lifecycleBlockersExist
          ? "Engine completed. Workflow blockers remain; follow the Next Required Action card above."
          : "Engine completed. Follow the Next Required Action card above.",
    });
    callbacks.onSuccess();
  } catch (error) {
    callbacks.setResult({
      error: error instanceof Error ? `Engine run failed: ${error.message}` : "Engine run failed because of a network or runtime error.",
      code: "NETWORK_OR_RUNTIME_ERROR",
      nextAction: "RETRY_OR_REDUCE_INPUT",
    });
  } finally {
    callbacks.setRunning(false);
  }
}

export async function executeEngineRunAsync(options: EngineAsyncRunOptions): Promise<void> {
  const {
    tenderId,
    canMutate,
    force = false,
    extraParams = {},
    lifecycleBlockersExist = false,
    callbacks,
    pollIntervalMs = POLL_INTERVAL_MS,
    maxPollDurationMs = MAX_POLL_DURATION_MS,
  } = options;

  if (!canMutate) {
    callbacks.setResult(ENGINE_MUTATION_BLOCKED_RESULT);
    return;
  }

  callbacks.setRunning(true);
  callbacks.setResult(null);
  callbacks.setAsyncStatus(null);
  try {
    const qs = new URLSearchParams({ async: "true", ...extraParams });
    if (force) qs.set("force", "true");
    const enqueueRes = await fetch(`/api/tenders/${tenderId}/engine?${qs.toString()}`, { method: "POST" });
    const enqueueData = await parseEngineResponse(enqueueRes);
    if (!enqueueRes.ok || !enqueueData.jobId) {
      callbacks.setResult(enqueueData);
      return;
    }

    const jobId = enqueueData.jobId;
    callbacks.setAsyncStatus({ jobId, message: "Engine queued. Starting background worker…" });
    fetch("/api/ai-jobs/run-next", { method: "POST" }).catch(() => {});

    const startedAt = Date.now();
    let finalStatus: "SUCCEEDED" | "FAILED" | null = null;
    let finalJob: {
      errorMessage?: string | null;
      output?: Record<string, unknown> | null;
      steps?: Array<{ stepName?: string; message?: string }>;
    } | null = null;

    while (Date.now() - startedAt < maxPollDurationMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      const pollRes = await fetch(`/api/ai-jobs/${jobId}`, { method: "GET" });
      if (!pollRes.ok) continue;
      const { job } = await pollRes.json() as {
        job: {
          status: string;
          errorMessage?: string | null;
          output?: Record<string, unknown> | null;
          steps?: Array<{ stepName?: string; message?: string }>;
        };
      };
      const lastStep = job.steps?.[job.steps.length - 1];
      callbacks.setAsyncStatus({ jobId, message: lastStep?.message ?? `Worker status: ${formatOperationalCode(job.status)}` });
      if (job.status === "SUCCEEDED" || job.status === "FAILED") {
        finalStatus = job.status;
        finalJob = job;
        break;
      }
    }

    if (finalStatus === "SUCCEEDED") {
      const jobOutput = finalJob?.output as Record<string, unknown> | null | undefined;
      const engineResult = (jobOutput?.result ?? jobOutput) as {
        partial?: boolean;
        blockers?: string[];
        nextAction?: string | null;
        evidenceMatchingBlocker?: { code: string; message: string } | null;
        code?: string;
      } | undefined;
      const isPartial = engineResult?.partial === true || engineResult?.code === "ENGINE_COMPLETED_WITH_BLOCKERS";

      if (isPartial) {
        const rawBlockers = engineResult?.blockers;
        callbacks.setResult({
          success: false,
          async: true,
          jobId,
          error: "Background engine processing completed, but evidence matching still needs review.",
          detail: humanBlockerSummary(rawBlockers),
          code: engineResult?.evidenceMatchingBlocker?.code ?? engineResult?.code ?? "EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED",
          nextAction: engineResult?.nextAction ?? "REVIEW_MATCHING_INPUTS",
          blockers: Array.isArray(rawBlockers) ? rawBlockers : undefined,
        });
        callbacks.onSuccess();
        return;
      }

      callbacks.setResult({
        success: true,
        async: true,
        jobId,
        error: lifecycleBlockersExist
          ? "Engine completed. Workflow blockers remain; follow the Next Required Action card above."
          : "Engine completed in the background. Follow the Next Required Action card above.",
      });
      callbacks.onSuccess();
    } else if (finalStatus === "FAILED") {
      const jobOutput = finalJob?.output as Record<string, unknown> | null | undefined;
      callbacks.setResult({
        error: `Background engine run failed: ${finalJob?.errorMessage ?? "No worker detail was returned."}`,
        code: typeof jobOutput?.code === "string" ? jobOutput.code : "ASYNC_ENGINE_FAILED",
        nextAction: typeof jobOutput?.nextAction === "string" ? jobOutput.nextAction : "RETRY_OR_REDUCE_INPUT",
        failedStage: typeof jobOutput?.failedStage === "string" ? jobOutput.failedStage : undefined,
        safeModeAvailable: jobOutput?.safeModeAvailable === true,
        jobId,
      });
    } else {
      callbacks.setResult({
        error: "The engine is still running in the background. The browser stopped polling, but the worker continues.",
        code: "ASYNC_POLL_TIMEOUT",
        nextAction: "REFRESH_TO_CHECK_STATUS",
        jobId,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const networkFailure = message === "Failed to fetch" || /network|connection/i.test(message);
    callbacks.setResult({
      error: networkFailure
        ? "Connection failed before the background engine request completed."
        : `Background engine run failed: ${message || "No runtime detail was returned."}`,
      code: "NETWORK_OR_RUNTIME_ERROR",
      nextAction: networkFailure ? "RETRY_BACKGROUND_JOB" : "RETRY_OR_REDUCE_INPUT",
    });
  } finally {
    callbacks.setRunning(false);
    callbacks.setAsyncStatus(null);
  }
}

export function EngineActionPanel({
  tenderId,
  vaultReviewedExperts = 0,
  vaultReviewedProjects = 0,
  lifecycleBlockersExist = false,
  canMutate = false,
  initialResult = null,
  initialAsyncStatus = null,
}: {
  tenderId: string;
  vaultReviewedExperts?: number;
  vaultReviewedProjects?: number;
  canMutate?: boolean;
  lifecycleBlockersExist?: boolean;
  initialResult?: EngineResponse | null;
  initialAsyncStatus?: EngineAsyncStatus | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EngineResponse | null>(initialResult);
  const [asyncStatus, setAsyncStatus] = useState<EngineAsyncStatus | null>(initialAsyncStatus);
  const isLargeVault = (vaultReviewedExperts + vaultReviewedProjects) > LARGE_VAULT_THRESHOLD;

  const callbacks: EngineRunCallbacks = {
    setRunning,
    setResult,
    setAsyncStatus,
    onSuccess: () => startTransition(() => router.refresh()),
  };

  async function runEngineAsync(force = false, extraParams: Record<string, string> = {}) {
    if (!canMutate) return;
    await executeEngineRunAsync({ tenderId, canMutate, force, extraParams, lifecycleBlockersExist, callbacks });
  }

  const ok = result?.success === true;
  const action = actionLabel(result?.nextAction);
  const technicalDetails = [
    result?.code ? `Code: ${result.code}` : null,
    result?.diagnosticId ? `Diagnostic: ${result.diagnosticId}` : null,
    result?.failedStage ? `Stage: ${result.failedStage}` : null,
    result?.jobId ? `Job: ${result.jobId}` : null,
  ].filter(Boolean);

  return (
    <section id="run-engine-action" className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Engine</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">Create tender-specific evidence matches</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Safe Mode is the recommended deterministic first pass. Use Full AI only as an optional semantic refinement after match rows exist.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          {canMutate && (
            <button
              onClick={() => runEngineAsync(false, { safe: "true", skipAiRematch: "true" })}
              disabled={running || isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              title="Deterministic matching first pass"
            >
              {running && asyncStatus ? <><ClockIcon /> Running…</> : <><BoltIcon /> Run Safe Mode — Recommended</>}
            </button>
          )}
          {canMutate && (
            <details className="group rounded-lg border border-indigo-200 bg-indigo-50">
              <summary className="flex cursor-pointer list-none items-center gap-1 px-3 py-2 text-xs font-semibold text-indigo-800 marker:content-none">
                Advanced AI refinement <span className="transition-transform group-open:rotate-180"><ChevronDownIcon /></span>
              </summary>
              <div className="border-t border-indigo-200 p-2">
                <button
                  onClick={() => runEngineAsync(false)}
                  disabled={running || isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
                  title="Queue full AI evidence matching in the background"
                >
                  {running && asyncStatus ? <><ClockIcon /> Running…</> : <><ClockIcon /> Run Full AI in Background</>}
                </button>
              </div>
            </details>
          )}
          {!canMutate && (
            <p className="text-xs text-slate-500 italic self-center">Read-only — engine actions require ADMIN or PROPOSAL_MANAGER role</p>
          )}
        </div>
      </div>

      {canMutate && isLargeVault && !result && !running && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-semibold">Large reviewed vault — start with Safe Mode</p>
          <p className="mt-1">
            The vault contains <strong>{vaultReviewedExperts}</strong> reviewed expert(s) and <strong>{vaultReviewedProjects}</strong> reviewed project(s). Safe Mode creates the reliable first-pass match rows before optional AI refinement.
          </p>
        </div>
      )}

      {asyncStatus && (
        <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-800">
          <p className="font-semibold">Background engine run in progress…</p>
          <p className="mt-1">{formatOperationalReason(asyncStatus.message)}</p>
          <details className="mt-2 text-xs text-indigo-600">
            <summary className="cursor-pointer font-medium">Technical job details</summary>
            <p className="mt-1 font-mono break-all">{asyncStatus.jobId}</p>
          </details>
        </div>
      )}

      {result && (
        <div className={`mt-4 rounded-xl border p-4 text-sm ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : result.code === "ASYNC_POLL_TIMEOUT" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-800"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{result.error ?? (ok ? "Engine completed." : "Engine needs attention.")}</p>
            {result.code && <span title={result.code} className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold">{formatOperationalCode(result.code)}</span>}
          </div>
          {action && <p className="mt-2"><strong>Next action:</strong> {action}</p>}
          {result.hint && <p className="mt-1"><strong>Guidance:</strong> {formatOperationalReason(result.hint)}</p>}
          {result.detail && <p className="mt-1"><strong>Detail:</strong> {formatOperationalReason(result.detail)}</p>}

          {/* Direct link to Company Vault when the engine says to review matching inputs.
              This connects the Run Engine to the Company Vault so the user can navigate
              directly to the review page instead of hunting for it in the sidebar. */}
          {(result.nextAction === "REVIEW_MATCHING_INPUTS" || result.code === "ENGINE_COMPLETED_WITH_BLOCKERS") && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/dashboard/company/review"
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white no-underline hover:bg-slate-800"
              >
                Review Company Vault <ArrowRightIcon />
              </Link>
              <Link
                href="/dashboard/company/review-board"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 no-underline hover:bg-slate-50"
              >
                Open Review Board
              </Link>
            </div>
          )}

          {technicalDetails.length > 0 && (
            <details className="mt-3 rounded-lg border border-current/10 bg-white/70 p-3 text-xs">
              <summary className="cursor-pointer font-semibold">Technical diagnostics</summary>
              <ul className="mt-2 space-y-1 font-mono break-all">
                {technicalDetails.map((detail) => <li key={detail}>{detail}</li>)}
              </ul>
            </details>
          )}

          {result.code === "ASYNC_POLL_TIMEOUT" && result.jobId && (
            <button
              type="button"
              onClick={async () => {
                try {
                  const response = await fetch(`/api/ai-jobs/${result.jobId}`, { method: "GET" });
                  const json = await response.json().catch(() => ({}));
                  const jobStatus = json?.job?.status ?? json?.status;
                  const jobError = json?.job?.errorMessage ?? json?.errorMessage;
                  if (jobStatus === "SUCCEEDED") {
                    setResult({
                      success: true,
                      async: true,
                      jobId: result.jobId,
                      error: lifecycleBlockersExist
                        ? "Engine completed. Workflow blockers remain; follow the Next Required Action card above."
                        : "Engine completed in the background. Follow the Next Required Action card above.",
                    });
                    startTransition(() => router.refresh());
                  } else if (jobStatus === "FAILED") {
                    setResult({
                      error: `Background engine run failed: ${jobError ?? "No worker detail was returned."}`,
                      code: "ASYNC_ENGINE_FAILED",
                      nextAction: "RETRY_OR_REDUCE_INPUT",
                      jobId: result.jobId,
                    });
                  } else {
                    setResult({
                      ...result,
                      error: `The worker is ${formatOperationalCode(jobStatus ?? "RUNNING").toLowerCase()}. Check again shortly.`,
                    });
                  }
                } catch {
                  // Preserve the current result so the user can retry this read-only check.
                }
              }}
              className="mt-3 rounded-lg border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"
            >
              Check status now
            </button>
          )}

          {canMutate && result.code === "NETWORK_OR_RUNTIME_ERROR" && result.nextAction === "RETRY_BACKGROUND_JOB" && (
            <button
              type="button"
              onClick={() => { setResult(null); void runEngineAsync(); }}
              className="mt-3 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-50"
            >
              Retry background run
            </button>
          )}

          {canMutate && (result.code === "ASYNC_ENGINE_FAILED" || result.code === "ASYNC_ENGINE_TIMEOUT") && (
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
              >
                Run Safe Mode
              </button>
              <button
                type="button"
                onClick={() => runEngineAsync(false, { skipAiRematch: "true" })}
                className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
              >
                Skip AI Rematch
              </button>
            </div>
          )}

          {!canMutate && (result.code === "ASYNC_ENGINE_FAILED" || result.code === "ASYNC_ENGINE_TIMEOUT" || result.nextAction === "RETRY_BACKGROUND_JOB") && (
            <p className="mt-3 text-xs text-slate-500 italic">Read-only — retry actions require ADMIN or PROPOSAL_MANAGER role</p>
          )}

          {Array.isArray(result.blockers) && result.blockers.length > 0 && (
            <div className="mt-3 rounded-lg bg-white p-3">
              <p className="font-semibold">Follow-up items</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {result.blockers.slice(0, 5).map((blocker, index) => (
                  <li key={index}>{describeEngineBlocker(blocker)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
