'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { PlayIcon, BoltIcon, ClockIcon } from './icons';

type ExtractionBlocker = {
  fileName?: string;
  quality?: {
    severity?: string;
    score?: number;
    warnings?: string[];
    blockers?: string[];
  };
};

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
  blockers?: ExtractionBlocker[];
  // Partial-success blockers (string[] from engine route when AI matching fails
  // but deterministic extraction succeeds). Separate from ExtractionBlocker[]
  // to avoid type collision.
  partialBlockers?: string[];
  evidenceMatchingBlocker?: { code: string; message: string } | null;
  analysisMethod?: string;
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

export type EngineAsyncStatus = { jobId: string; message: string };

// Async polling — escapes the 60s Vercel Hobby cap by enqueuing an
// ENGINE_RUN AiJob and watching it from the browser.
const POLL_INTERVAL_MS = 3000;
// Extended to 10 minutes for large tenders (the prior 5-minute window
// kept giving up on multi-file analyses while the worker was still
// running). The user-facing message also clarifies that a poll
// timeout is NOT a worker failure — the job typically completes in
// the background and the user just needs to refresh.
const MAX_POLL_DURATION_MS = 10 * 60 * 1000;

export const CANONICAL_SAFE_MODE_PARAMS = Object.freeze({
  safe: 'true',
  skipAiRematch: 'true',
} as const);

export function canonicalSafeModeParams(): Record<string, string> {
  return { ...CANONICAL_SAFE_MODE_PARAMS };
}

function actionLabel(action?: string) {
  if (action === 'UPLOAD_TENDER_DOCUMENT')
    return 'Upload the tender/RFP document, then run Engine.';
  if (action === 'OPEN_EXTRACTION_QUALITY')
    return 'Open Extraction Quality and fix/OCR weak files.';
  if (action === 'RETRY_OR_REDUCE_INPUT')
    return 'Retry, or reduce duplicate/oversized tender inputs.';
  if (action === 'RETRY_BACKGROUND_JOB')
    return "Click 'Run in background' again — this was a temporary network failure.";
  if (action === 'RETRY_AFTER_DATABASE_CHECK') return 'Check database/Vercel runtime, then retry.';
  if (action === 'RETRY_AS_BACKGROUND_JOB')
    return 'Click "Run in background" — escapes the 60s Vercel function cap.';
  if (action === 'OPEN_TENDER_LIST') return 'Return to tender list and reopen this tender.';
  if (action === 'LOGIN_AGAIN') return 'Sign in again, then retry.';
  if (action === 'OPEN_EXTRACTION_ANALYSIS_MATCHING_QUALITY')
    return 'Review Extraction, Analysis, and Matching Quality panels.';
  if (action === 'REFRESH_TO_CHECK_STATUS')
    return 'Click "Check status now" or refresh — the worker is finishing in the background.';
  if (action === 'RUN_ENGINE_SAFE_MODE')
    return 'Re-run in Safe Mode — reduces text, skips AI rematch, uses deterministic matching only.';
  if (action === 'REVIEW_MATCHING_INPUTS')
    return 'Review vault experts/projects and re-run Engine to generate match rows.';
  return null;
}

async function parseEngineResponse(res: Response): Promise<EngineResponse> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await res.json()) as EngineResponse;
  }
  const text = await res.text().catch(() => '');
  const clean = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320);

  // Detect Vercel's function-invocation timeout. When the route exceeds
  // the 60s function budget, Vercel responds at the platform layer with
  // an HTML error page containing "FUNCTION_INVOCATION_TIMEOUT" — our
  // route's catch block never runs, so actionableEngineError can't map
  // it. Recognise the pattern here and surface the correct
  // RETRY_AS_BACKGROUND_JOB hint instead of the generic
  // "Check database/Vercel runtime, then retry" that misled users on
  // the May 16 screenshot.
  const isVercelTimeout =
    res.status === 504 ||
    /function_invocation_timeout/i.test(clean) ||
    /function_invocation_timeout/i.test(res.statusText ?? '');

  if (isVercelTimeout) {
    return {
      error: 'Engine run exceeded the 60s Vercel function budget.',
      code: 'ENGINE_VERCEL_TIMEOUT',
      detail:
        clean ||
        `Vercel returned ${res.status} ${res.statusText || 'Function Invocation Timeout'} before the route could respond.`,
      nextAction: 'RETRY_AS_BACKGROUND_JOB',
      hint: 'Click "Run in background" — the async ENGINE_RUN job has its own 60s function budget per chunk and survives chunked sub-jobs. For very large tenders this is the only reliable path on Vercel Hobby.',
    };
  }

  return {
    error: `Engine run failed: server returned a non-JSON response (${res.status} ${res.statusText || 'HTTP error'}).`,
    code: 'NON_JSON_RESPONSE',
    detail: clean || 'No response body was returned. Check Vercel function logs for this request.',
    nextAction: res.status === 401 ? 'LOGIN_AGAIN' : 'RETRY_AFTER_DATABASE_CHECK',
    hint: 'This usually means the route crashed before returning JSON, authentication redirected, or the deployment is serving an error page.',
  };
}

// Vaults with more than this many total reviewed records typically exceed
// Vercel's 60 s function cap during matching — safe mode is recommended.
const LARGE_VAULT_THRESHOLD = 30;

// Returned (and rendered) when a read-only role's callback is invoked
// anyway — e.g. via a stale closure, devtools, or a future code path that
// forgets the conditional rendering. No network request is made.
export const ENGINE_MUTATION_BLOCKED_RESULT: EngineResponse = {
  error: 'Engine actions are read-only for your role. No request was sent.',
  code: 'ROLE_READ_ONLY_MUTATION_BLOCKED',
  detail:
    'Engine runs require the ADMIN or PROPOSAL_MANAGER role. The server enforces this independently; this client-side guard exists so a read-only session can never dispatch the request in the first place.',
};

export type EngineRunCallbacks = {
  setRunning: (running: boolean) => void;
  setResult: (result: EngineResponse | null) => void;
  setAsyncStatus: (status: EngineAsyncStatus | null) => void;
  /** Called after a confirmed successful run (sync postconditions passed or async job SUCCEEDED). */
  onSuccess: () => void;
};

export type EngineRunOptions = {
  tenderId: string;
  /** Server-derived role capability. When false, no POST is ever dispatched. */
  canMutate: boolean;
  force?: boolean;
  lifecycleBlockersExist?: boolean;
  callbacks: EngineRunCallbacks;
};

export type EngineAsyncRunOptions = EngineRunOptions & {
  extraParams?: Record<string, string>;
  /** Test/preview overrides — production callers use the defaults. */
  pollIntervalMs?: number;
  maxPollDurationMs?: number;
};

// The ACTUAL dispatch path behind the "Run Engine" / "Force run once"
// buttons. Exported so tests can prove that a manually triggered callback
// cannot send a POST when canMutate is false.
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
    const res = await fetch(`/api/tenders/${tenderId}/engine${force ? '?force=true' : ''}`, {
      method: 'POST',
    });
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
      const isVercelTimeout =
        data.code === 'ENGINE_VERCEL_TIMEOUT' ||
        data.code === 'GENERATION_TIMEOUT' ||
        res.status === 504;
      if (isVercelTimeout) {
        callbacks.setResult({
          ...data,
          error: `${data.error ?? 'Engine hit the 60s Vercel cap.'} Auto-retrying in background mode…`,
          code: 'AUTO_PROMOTING_TO_BACKGROUND',
          nextAction: 'RETRY_AS_BACKGROUND_JOB',
        });
        // Fire the async path. The setRunning(false) in the finally
        // below releases the button; executeEngineRunAsync re-asserts
        // it and drives its own state machine until the poll completes.
        await executeEngineRunAsync({ ...options, force });
        return;
      }
      callbacks.setResult(data);
      return;
    }
    // ─── Engine response honesty: partial success ──────────────────────
    // When the engine returns HTTP 200 with `partial: true`, AI matching
    // failed but deterministic extraction succeeded. The response carries
    // `blockers[]` (string[]) and `nextAction` so the UI can surface the real
    // state instead of a misleading "Engine run completed" green. The user
    // must see that evidence rows require review — not a silent 0-row state.
    if (data.partial) {
      const rawBlockers = (data as { blockers?: string[] }).blockers;
      const blockerText =
        Array.isArray(rawBlockers) && rawBlockers.length > 0
          ? rawBlockers.join(' ')
          : 'AI evidence matching did not complete. Review-required fallback rows were created for source-grounded requirements.';
      callbacks.setResult({
        ...data,
        success: false,
        error: `Engine completed partially. ${blockerText}`,
        code: data.evidenceMatchingBlocker?.code ?? 'EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED',
        nextAction: data.nextAction ?? 'REVIEW_MATCHING_INPUTS',
      });
      callbacks.onSuccess();
      return;
    }
    // "Engine succeeded" here means the engine HTTP run passed its
    // postconditions — it does NOT mean tender readiness is green. Downstream
    // blockers (regex fallback unapproved, metadata incomplete, submission
    // plan not built, evidence uncoverage) still apply. Per spec rule 8,
    // the success message must include the TRUE next action after
    // refreshing lifecycle, not a generic "Engine ran" message that hides
    // remaining blockers. The Recovery Command Center is the canonical
    // source for the next action — we mirror its headline here and
    // explicitly point the user at the readiness panels below.
    const warningCount = Array.isArray(data?.extractionWarnings)
      ? data.extractionWarnings.length
      : 0;
    callbacks.setResult({
      ...data,
      success: true,
      error:
        warningCount > 0
          ? `Engine run completed with ${warningCount} extraction warning(s). Review the Next Required Action above and readiness panels for the true next action — remaining blockers (analysis source, evidence coverage, submission plan, document generation) still apply before Generate Docs.`
          : lifecycleBlockersExist
            ? 'Engine completed. The Next Required Action above and readiness panels show the true next action — remaining blockers (evidence confirmation, document generation, or export-blocker resolution) may still be required before Generate Docs.'
            : 'Engine run completed. Review the Next Required Action above and readiness panels for the canonical next action.',
    });
    callbacks.onSuccess();
  } catch (error) {
    callbacks.setResult({
      error:
        error instanceof Error
          ? `Engine run failed: ${error.message}`
          : 'Engine run failed due to a network/runtime error.',
      code: 'NETWORK_OR_RUNTIME_ERROR',
      nextAction: 'RETRY_OR_REDUCE_INPUT',
    });
  } finally {
    callbacks.setRunning(false);
  }
}

// Async mode — enqueue + worker + poll. Escapes the 60s Hobby cap for
// large tenders where the synchronous engine pipeline would time out.
// extraParams allows callers to pass ?safe=true or ?skipAiRematch=true.
// Exported for the same reason as executeEngineRun: the read-only guard
// must be provable on the real dispatch path, not a simulation.
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
    // 1. Enqueue the job — returns 202 with { jobId }
    const qs = new URLSearchParams({ async: 'true', ...extraParams });
    if (force) qs.set('force', 'true');
    const enqueueRes = await fetch(`/api/tenders/${tenderId}/engine?${qs.toString()}`, {
      method: 'POST',
    });
    const enqueueData = await parseEngineResponse(enqueueRes);
    if (!enqueueRes.ok || !enqueueData.jobId) {
      callbacks.setResult(enqueueData);
      return;
    }
    const jobId = enqueueData.jobId;
    callbacks.setAsyncStatus({ jobId, message: 'Engine queued. Kicking off worker…' });

    // 2. Kick off the worker (fire-and-forget — separate 60s function invocation)
    fetch('/api/ai-jobs/run-next', { method: 'POST' }).catch(() => {
      // worker may already be running; not fatal — polling will still observe progress
    });

    // 3. Poll status every 3s until SUCCEEDED / FAILED / timeout
    const startedAt = Date.now();
    let finalStatus: 'SUCCEEDED' | 'FAILED' | null = null;
    let finalJob: {
      errorMessage?: string | null;
      output?: Record<string, unknown> | null;
      steps?: Array<{ stepName?: string; message?: string }>;
    } | null = null;
    while (Date.now() - startedAt < maxPollDurationMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const pollRes = await fetch(`/api/ai-jobs/${jobId}`, { method: 'GET' });
      if (!pollRes.ok) continue; // transient — keep polling
      const { job } = (await pollRes.json()) as {
        job: {
          status: string;
          errorMessage?: string | null;
          output?: Record<string, unknown> | null;
          steps?: Array<{ stepName?: string; message?: string }>;
        };
      };
      const lastStep = job.steps?.[job.steps.length - 1];
      callbacks.setAsyncStatus({
        jobId,
        message: lastStep?.message ?? `Worker status: ${job.status}`,
      });
      if (job.status === 'SUCCEEDED' || job.status === 'FAILED') {
        finalStatus = job.status;
        finalJob = job;
        break;
      }
    }

    if (finalStatus === 'SUCCEEDED') {
      // Per spec rule 8: include the true next action hint in the success
      // message. When lifecycleBlockersExist is true, the user MUST be told
      // that "Engine completed" does NOT equal "ready to generate" — the
      // Recovery Command Center has the canonical next action.
      callbacks.setResult({
        success: true,
        async: true,
        jobId,
        error: lifecycleBlockersExist
          ? 'Engine completed; blockers remain — review the Next Required Action above for the true next action (evidence confirmation, document generation, or export-blocker resolution).'
          : 'Engine completed successfully (background). Review the Next Required Action above for the canonical next action.',
      });
      callbacks.onSuccess();
    } else if (finalStatus === 'FAILED') {
      const jobOutput = finalJob?.output as Record<string, unknown> | null | undefined;
      const engineCode =
        typeof jobOutput?.code === 'string' ? jobOutput.code : 'ASYNC_ENGINE_FAILED';
      const failedStage =
        typeof jobOutput?.failedStage === 'string' ? jobOutput.failedStage : undefined;
      const engineNextAction =
        typeof jobOutput?.nextAction === 'string' ? jobOutput.nextAction : 'RETRY_OR_REDUCE_INPUT';
      callbacks.setResult({
        error: `Engine background run failed: ${finalJob?.errorMessage ?? 'unknown worker error'}`,
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
      callbacks.setResult({
        error:
          'Engine is still running in the background (10 min poll window elapsed). The worker continues — refresh in 1-2 minutes to see the completed engine run.',
        code: 'ASYNC_POLL_TIMEOUT',
        nextAction: 'REFRESH_TO_CHECK_STATUS',
        jobId,
      });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    const isNetworkFailure =
      msg === 'Failed to fetch' ||
      msg.toLowerCase().includes('network') ||
      msg.toLowerCase().includes('connection');
    callbacks.setResult({
      error: isNetworkFailure
        ? 'Connection failed — the server could not be reached. This is usually a temporary network issue.'
        : `Engine async run failed: ${msg || 'unknown error'}`,
      code: 'NETWORK_OR_RUNTIME_ERROR',
      nextAction: isNetworkFailure ? 'RETRY_BACKGROUND_JOB' : 'RETRY_OR_REDUCE_INPUT',
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
  /** Server-derived role capability. Fail-closed: a caller that omits
   *  this prop gets a read-only panel, never an exposed mutation. */
  canMutate?: boolean;
  /** When true, the success message notes that readiness blockers remain so the
   *  user doesn't mistake "engine completed" for "ready to generate". */
  lifecycleBlockersExist?: boolean;
  /** Initial-state seams so render tests (and previews) can exercise the
   *  timeout/failure/retry states without a live engine run. */
  initialResult?: EngineResponse | null;
  initialAsyncStatus?: EngineAsyncStatus | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EngineResponse | null>(initialResult);
  // Async-mode UX — when null we're in sync mode; otherwise this is the
  // active jobId being polled and the latest progress message.
  const [asyncStatus, setAsyncStatus] = useState<EngineAsyncStatus | null>(initialAsyncStatus);
  const isLargeVault = vaultReviewedExperts + vaultReviewedProjects > LARGE_VAULT_THRESHOLD;

  const callbacks: EngineRunCallbacks = {
    setRunning,
    setResult,
    setAsyncStatus,
    onSuccess: () => startTransition(() => router.refresh()),
  };

  // Both wrappers delegate to the exported dispatchers, which re-check
  // canMutate before any network call — conditional rendering hides these
  // controls for read-only roles, and this guard holds even if a callback
  // is somehow invoked anyway.
  async function runEngineAsync(force = false, extraParams: Record<string, string> = {}) {
    if (!canMutate) return;
    await executeEngineRunAsync({
      tenderId,
      canMutate,
      force,
      extraParams,
      lifecycleBlockersExist,
      callbacks,
    });
  }

  const ok = result?.success === true;
  const action = actionLabel(result?.nextAction);
  // NOTE: The old `extractionBlocked = result?.code === "EXTRACTION_NOT_READY"`
  // branch was dead code — the engine route never returns EXTRACTION_NOT_READY
  // (that code belongs to the ai-analyze route). The "Force run once" button
  // was therefore never rendered, and even if it had been, the engine route
  // explicitly ignores ?force=true ("there is deliberately no ?force= escape
  // hatch"). Removed to avoid implying a force-run affordance exists.

  return (
    <section
      id="run-engine-action"
      className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Run Engine control
          </p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">
            Run tender engine with structured diagnostics
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Use this panel for Run Engine. It displays error code, next action, hint, detail,
            extraction blockers, and diagnostic ID from the backend.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canMutate && (
            running || isPending ? (
              <button
                type="button"
                disabled
                aria-live="polite"
                className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-800 opacity-80"
                title="One engine run is already queued or running; use the background status below for progress."
              >
                <ClockIcon /> Engine running…
              </button>
            ) : (
              <>
                <button
                  onClick={() => runEngineAsync(false, canonicalSafeModeParams())}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
                  title="Recommended safe mode queues a background job with safe=true and skipAiRematch=true."
                >
                  <BoltIcon /> Run Safe Mode — Recommended
                </button>
                <button
                  onClick={() => runEngineAsync(false)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-100"
                  title="Queues the full AI engine in the background. Use after Safe Mode if AI rematch is needed."
                >
                  <PlayIcon /> Run Full AI in Background
                </button>
              </>
            )
          )}
          {!canMutate && (
            <p className="text-xs text-slate-500 italic self-center">
              Read-only — engine actions require ADMIN or PROPOSAL_MANAGER role
            </p>
          )}
        </div>
      </div>

      {canMutate && isLargeVault && !result && !running && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-semibold">Large vault detected — Safe Mode is recommended</p>
          <p className="mt-1">
            Your vault has <strong>{vaultReviewedExperts}</strong> reviewed expert(s) and{' '}
            <strong>{vaultReviewedProjects}</strong> reviewed project(s). Use the single{' '}
            <strong>Run Safe Mode — Recommended</strong> action above first; it queues the canonical
            safe run with <code>safe=true</code> and <code>skipAiRematch=true</code>.
          </p>
        </div>
      )}

      {asyncStatus && (
        <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-800">
          <p className="font-semibold">Background engine run in progress…</p>
          <p className="mt-1">{asyncStatus.message}</p>
          <p className="mt-2 text-xs text-indigo-600">
            Job ID: <span className="font-mono">{asyncStatus.jobId}</span> · polls every 3s · 10-min
            poll ceiling (worker continues beyond that)
          </p>
        </div>
      )}

      {result && (
        <div
          className={`mt-4 rounded-xl border p-4 text-sm ${ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : result?.code === 'ASYNC_POLL_TIMEOUT' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-800'}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">
              {result.error ?? (ok ? 'Engine completed.' : 'Engine failed.')}
            </p>
            {result.code && (
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold">
                {result.code}
              </span>
            )}
            {result.diagnosticId && (
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-mono">
                {result.diagnosticId}
              </span>
            )}
          </div>
          {action && (
            <p className="mt-2">
              <strong>Next action:</strong> {action}
            </p>
          )}
          {result.hint && (
            <p className="mt-1">
              <strong>Hint:</strong> {result.hint}
            </p>
          )}
          {result.detail && (
            <p className="mt-1">
              <strong>Detail:</strong> {result.detail}
            </p>
          )}

          {/* ASYNC_POLL_TIMEOUT — the worker is still running on Vercel
              but the browser stopped polling. Give the user a one-click
              "Check status now" affordance that fetches the job once
              more and either resolves (showing success/failure) or
              prompts a page refresh. Avoids the user having to know
              that "the worker may still be running" means "click
              refresh to see the result". GET-only — stays available to
              read-only roles. */}
          {result.code === 'ASYNC_POLL_TIMEOUT' && result.jobId && (
            <button
              type="button"
              onClick={async () => {
                try {
                  const r = await fetch(`/api/ai-jobs/${result.jobId}`, { method: 'GET' });
                  const j = await r.json().catch(() => ({}));
                  const jobStatus = j?.job?.status ?? j?.status;
                  const jobError = j?.job?.errorMessage ?? j?.errorMessage;
                  if (jobStatus === 'SUCCEEDED') {
                    setResult({
                      success: true,
                      async: true,
                      jobId: result.jobId,
                      error: lifecycleBlockersExist
                        ? 'Engine completed; blockers remain — review the Next Required Action above for the true next action.'
                        : 'Engine completed successfully (background). Review the Next Required Action above for the canonical next action.',
                    });
                    startTransition(() => router.refresh());
                  } else if (jobStatus === 'FAILED') {
                    setResult({
                      error: `Engine background run failed: ${jobError ?? 'unknown worker error'}`,
                      code: 'ASYNC_ENGINE_FAILED',
                      nextAction: 'RETRY_OR_REDUCE_INPUT',
                      jobId: result.jobId,
                    });
                  } else {
                    setResult({
                      ...result,
                      error: `Worker status: ${jobStatus ?? 'RUNNING'} — still working. Try again in 1-2 min.`,
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

          {canMutate &&
            result.code === 'NETWORK_OR_RUNTIME_ERROR' &&
            result.nextAction === 'RETRY_BACKGROUND_JOB' && (
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  void runEngineAsync();
                }}
                className="mt-3 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50"
              >
                Retry background run
              </button>
            )}

          {canMutate &&
            (result.code === 'ASYNC_ENGINE_FAILED' || result.code === 'ASYNC_ENGINE_TIMEOUT') && (
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
                  onClick={() => runEngineAsync(false, canonicalSafeModeParams())}
                  className="rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
                  title="Deduplicates text and skips AI rematch — more reliable for large tenders"
                >
                  Run Safe Mode
                </button>
                {result.failedStage && (
                  <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs text-red-700">
                    Failed at: {result.failedStage}
                  </span>
                )}
              </div>
            )}

          {!canMutate &&
            (result.code === 'ASYNC_ENGINE_FAILED' ||
              result.code === 'ASYNC_ENGINE_TIMEOUT' ||
              result.nextAction === 'RETRY_BACKGROUND_JOB') && (
              <p className="mt-3 text-xs text-slate-500 italic">
                Read-only — retry actions require ADMIN or PROPOSAL_MANAGER role
              </p>
            )}

          {Array.isArray(result.blockers) && result.blockers.length > 0 && (
            <div className="mt-3 rounded-lg bg-white p-3">
              <p className="font-semibold">Extraction blockers</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {result.blockers.slice(0, 5).map((blocker, index) => (
                  <li key={`${blocker.fileName ?? 'file'}-${index}`}>
                    {blocker.fileName ?? 'File'}: {blocker.quality?.severity ?? 'blocked'}
                    {typeof blocker.quality?.score === 'number'
                      ? ` (${blocker.quality.score}/100)`
                      : ''}
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
