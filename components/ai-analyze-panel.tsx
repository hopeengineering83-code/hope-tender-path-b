"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, CrossIcon, SparklesIcon } from "./icons";
import type { LiveProviderDiagnosticsResponse } from "../app/api/ai-providers/diagnostics/route";
import {
  describeAIAnalyzeWorkflowState,
  type CurrentEnginePresentationState,
} from "../lib/engine/workflow-panel-presentation";

export { describeAIAnalyzeWorkflowState } from "../lib/engine/workflow-panel-presentation";

type JobStatus = "QUEUED" | "RUNNING" | "PARTIAL_SUCCESS" | "SUCCEEDED" | "FAILED" | "CANCELED";

type Props = {
  tenderId: string;
  initialContinueJobId?: string | null;
  aiEnabled: boolean;
  canMutate?: boolean;
  /** Legacy server hints retained for call-site compatibility only. */
  analysisAlreadySucceeded?: boolean;
  extractionComplete?: boolean;
  sourceIntegrityValid?: boolean;
  hasActiveJob?: boolean;
};

type SourceReadiness = {
  analysisReady: boolean;
  byteIntegrityValid: boolean;
  extractionComplete: boolean;
  extractionQualityValid: boolean;
  duplicateFileCount: number;
  blockers: string[];
  analysisCurrent: boolean;
  analysisBlocker: string | null;
};

export type AIAnalyzeEngineState = CurrentEnginePresentationState;

/**
 * The row type comes FROM THE ROUTE. It used to be declared here as
 * `{ provider, configured, ok, reason, latencyMs }` — five fields the
 * diagnostics endpoint has never returned. Reading them off an `any` gave
 * `undefined` every time, which is falsy, so every provider rendered
 * "not configured" underneath a summary saying two of them had completed a
 * real extraction. Importing the contract makes that a compile error.
 */
type ProviderDiag = LiveProviderDiagnosticsResponse["perProvider"][number];

/** What the analysis capability test actually reported for this provider. */
function analysisOutcome(provider: ProviderDiag) {
  return provider.results.find((result) => result.capability === "analysis") ?? null;
}

/**
 * One line per provider, in the provider's own words.
 *
 * `usableForAiAnalyze` is the only thing that means "this provider can run AI
 * Analyze" — connectivity alone is not it, which is the distinction the
 * capability test exists to draw.
 */
function describeProvider(provider: ProviderDiag): string {
  const analysis = analysisOutcome(provider);
  const model = provider.resolvedModel ? ` · ${provider.resolvedModel}` : "";
  if (provider.usableForAiAnalyze) {
    const ms = analysis && analysis.durationMs > 0 ? ` (${analysis.durationMs}ms)` : "";
    return `OK${ms}${model}`;
  }
  const detail = analysis?.safeMessage ?? analysis?.category ?? null;
  const state = DIAGNOSTIC_STATE_LABEL[provider.diagnosticState] ?? provider.diagnosticState;
  return detail ? `${state} — ${detail}${model}` : `${state}${model}`;
}

const DIAGNOSTIC_STATE_LABEL: Record<ProviderDiag["diagnosticState"], string> = {
  KEY_MISSING: "not configured",
  CONFIGURATION_INVALID: "configuration invalid",
  MODEL_UNAVAILABLE: "model unavailable on this account",
  BILLING_BLOCKED: "billing",
  RATE_LIMITED: "rate limited",
  CONNECTIVITY_VERIFIED: "answered, but no structured extraction",
  ANALYSIS_VERIFIED: "analysis verified",
  GENERATION_VERIFIED: "generation verified",
  // Nothing was measured. Never rendered as a failure.
  NOT_TESTED: "not tested",
  CONFIGURED: "contacted, nothing proven",
};

/** Retry cadence for a readiness check that failed in transit. */
const READINESS_RETRY_INTERVAL_MS = 8_000;
const POLL_INTERVAL_MS = 3_000;
const TERMINAL: JobStatus[] = ["SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "CANCELED"];

/**
 * Category names, in the order they are tested. Shared by the whole-message
 * scan and the per-provider one so the two can never disagree about what a
 * given error means.
 */
const FAILURE_CATEGORY_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?:402|billing|payment required|insufficient (?:balance|credit|quota)|no credits remaining)/i, "BILLING"],
  [/(?:401|403|invalid api key|unauthori[sz]ed|not available in your subscription tier)/i, "AUTH_OR_CONFIGURATION_INVALID"],
  [/(?:429|rate.?limit)/i, "RATE_LIMITED"],
  [/(?:503|overload|temporarily unavailable|high demand)/i, "TEMPORARILY_UNAVAILABLE"],
  [/(?:timeout|timed out|deadline)/i, "TIMEOUT"],
  [/(?:output token budget|before producing any content)/i, "OUTPUT_BUDGET_TOO_SMALL"],
  [/(?:malformed|empty response|unusable structured)/i, "MALFORMED_RESPONSE"],
  [/(?:413|context (?:window|length)|request too large|prompt exceeds)/i, "REQUEST_TOO_LARGE"],
  [/in cooldown|cooling down/i, "SKIPPED_COOLING_DOWN"],
];

/** The canonical chain, lower-cased exactly as the server writes it. */
const PROVIDER_NAMES = [
  "gemini", "groq", "mistral", "zai", "cerebras",
  "openrouter", "openai", "together", "deepseek", "anthropic",
] as const;

const PROVIDER_LABEL: Record<(typeof PROVIDER_NAMES)[number], string> = {
  gemini: "Gemini",
  groq: "Groq",
  mistral: "Mistral",
  zai: "Z.ai",
  cerebras: "Cerebras",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  together: "Together",
  deepseek: "DeepSeek",
  anthropic: "Anthropic",
};

/**
 * What each category means to the person reading the tender page.
 *
 * The enum names are precise and are kept in the code, the tests and the
 * authenticated diagnostics. They are not, on their own, something an owner can
 * act on: "AUTH_OR_CONFIGURATION_INVALID" does not say "your plan does not
 * include the model this provider is configured with, and changing it is free".
 * The whole point of attributing a failure to a provider is that the owner can
 * tell what, if anything, is theirs to fix — so say it in words.
 */
const CATEGORY_PLAIN_LANGUAGE: Record<string, string> = {
  BILLING: "no credit on that account",
  AUTH_OR_CONFIGURATION_INVALID: "key or configured model rejected — check the key and that your plan includes the model",
  RATE_LIMITED: "rate limited right now",
  TEMPORARILY_UNAVAILABLE: "provider temporarily unavailable",
  TIMEOUT: "timed out",
  OUTPUT_BUDGET_TOO_SMALL: "its plan cannot fit this tender and an answer in one budget",
  MALFORMED_RESPONSE: "answered with nothing usable",
  REQUEST_TOO_LARGE: "request larger than the model accepts",
  SKIPPED_COOLING_DOWN: "skipped while cooling down after an earlier failure",
};

function describeCategories(categories: readonly string[]): string {
  return categories.map((c) => CATEGORY_PLAIN_LANGUAGE[c] ?? c.toLowerCase().replace(/_/g, " ")).join("; ");
}

function categoriesIn(text: string): string[] {
  return FAILURE_CATEGORY_RULES.filter(([pattern]) => pattern.test(text)).map(([, name]) => name);
}

/**
 * Pull the `provider: message` pairs the server already wrote.
 *
 * The durable AiJob error is shaped
 *
 *   ... Provider errors: gemini: <msg> | groq: <msg> | mistral: <msg> | ...
 *
 * and a multi-chunk job repeats that per chunk, so one provider can appear more
 * than once with different causes. Segments that are not a known provider (the
 * "chunk 2: ..." separator, for instance) are ignored rather than guessed at.
 *
 * Only the CATEGORY of each provider's message is kept. The raw text can carry
 * provider payloads and belongs in authenticated diagnostics, not here.
 */
export function perProviderFailureCategories(message: string): Array<{ provider: string; categories: string[] }> {
  const byProvider = new Map<string, Set<string>>();
  for (const rawSegment of String(message).split(/\s\|\s/)) {
    // The FIRST provider of each chunk follows "Provider errors:" rather than a
    // pipe, so anchoring at the segment start silently dropped it — Gemini, the
    // head of the canonical chain, was missing from the report while every
    // later provider appeared. Trim the preamble before matching.
    const marker = rawSegment.lastIndexOf("Provider errors:");
    const segment = marker >= 0
      ? rawSegment.slice(marker + "Provider errors:".length)
      : rawSegment;
    const match = segment.match(/^\s*([a-z.]+)\s*:\s*([\s\S]+)$/i);
    if (!match) continue;
    const name = match[1].toLowerCase();
    if (!(PROVIDER_NAMES as readonly string[]).includes(name)) continue;
    const found = categoriesIn(match[2]);
    if (found.length === 0) continue;
    const existing = byProvider.get(name) ?? new Set<string>();
    for (const category of found) existing.add(category);
    byProvider.set(name, existing);
  }
  // Canonical order, so the report reads like the chain it describes.
  return PROVIDER_NAMES
    .filter((name) => byProvider.has(name))
    .map((name) => ({ provider: name, categories: [...(byProvider.get(name) ?? [])] }));
}

/**
 * Keep provider payloads in authenticated diagnostics, not the workflow UI.
 *
 * THE DEFECT THIS FIXES.
 * ----------------------
 * This scanned the WHOLE error for category patterns and reported their union:
 *
 *   Observed categories: BILLING, AUTH_OR_CONFIGURATION_INVALID, RATE_LIMITED,
 *   TEMPORARILY_UNAVAILABLE, MALFORMED_RESPONSE.
 *
 * Every one of those was true of SOME provider and none of them said which.
 * The owner was then told to open Provider diagnostics — a separate live test
 * that spends real round-trips — to learn what the durable job had already
 * recorded. The pairing was in the message the whole time; the summary threw
 * it away.
 *
 * That matters beyond tidiness: the union cannot separate the one provider the
 * owner could fix in a minute (a model name their tier does not allow) from the
 * eight that are externally blocked and need nothing from them at all.
 */
export function summarizeAIAnalyzeFailure(message: string | null | undefined): string {
  const text = String(message ?? "");
  if (!/provider|429|402|413|rate.?limit|billing|context|timeout|attempt_budget/i.test(text)) {
    return text || "AI Analyze failed. Correct the source or provider issue, then retry.";
  }

  const perProvider = perProviderFailureCategories(text);
  if (perProvider.length > 0) {
    const named = perProvider
      .map(({ provider, categories }) => `${PROVIDER_LABEL[provider as (typeof PROVIDER_NAMES)[number]]}: ${describeCategories(categories)}`)
      .join(" · ");
    return `AI Analyze could not complete after the configured provider chain. ${named}. Open Provider diagnostics for the full per-provider result, then retry AI Analyze.`;
  }

  // Fall back to the union only when the message carries no provider pairing —
  // an older job, or a failure raised before the chain was walked. Saying
  // "categories seen somewhere in this error" is honest; presenting it as a
  // per-provider result would not be.
  //
  // Do not count regex occurrences as providers. One provider error can name
  // its status, retry and nested cause several times; an earlier implementation
  // turned those events into impossible summaries such as "11 provider issues"
  // for a ten-provider chain.
  const categories = categoriesIn(text);
  return `AI Analyze could not complete after the configured provider chain.${categories.length ? ` Seen somewhere in this run, not attributed to a provider: ${describeCategories(categories)}.` : ""} Open Provider diagnostics for unique-provider results, then retry AI Analyze.`;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function AIAnalyzePanel({
  tenderId,
  initialContinueJobId = null,
  aiEnabled,
  canMutate = false,
  hasActiveJob = false,
}: Props) {
  const router = useRouter();
  const deletedRef = useRef(false);
  const [jobId, setJobId] = useState<string | null>(initialContinueJobId);
  const [analyzing, setAnalyzing] = useState(Boolean(initialContinueJobId) || hasActiveJob);
  const [phase, setPhase] = useState(initialContinueJobId ? "AI Analyze is queued." : "");
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(initialContinueJobId ? "QUEUED" : null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [readiness, setReadiness] = useState<SourceReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(true);
  const [readinessError, setReadinessError] = useState("");
  const [engineState, setEngineState] = useState<AIAnalyzeEngineState | null>(null);
  const [engineStateLoading, setEngineStateLoading] = useState(true);
  const [engineStateError, setEngineStateError] = useState("");
  const [diag, setDiag] = useState<{ aiAnalyzeReady: boolean; summary: string; perProvider: ProviderDiag[] } | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);

  const loadReadiness = useCallback(async () => {
    if (deletedRef.current) return;
    try {
      const response = await fetch(`/api/tenders/${tenderId}/source-readiness`, { cache: "no-store" });
      if (response.status === 404 || response.status === 410) {
        deletedRef.current = true;
        return;
      }
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error || `Source readiness check failed (HTTP ${response.status}).`);
      }
      setReadiness({
        analysisReady: Boolean(body.analysisReady),
        byteIntegrityValid: Boolean(body.byteIntegrityValid),
        extractionComplete: Boolean(body.extractionComplete),
        extractionQualityValid: Boolean(body.extractionQualityValid),
        duplicateFileCount: Number(body.duplicateFileCount ?? 0),
        blockers: Array.isArray(body.blockers) ? body.blockers.map(String) : [],
        analysisCurrent: Boolean(body.analysisCurrent),
        analysisBlocker: body.analysisBlocker ? String(body.analysisBlocker) : null,
      });
      setReadinessError("");
    } catch (reason) {
      // Fail closed: stale server-rendered booleans must never authorize an AI
      // action when the canonical source/revision endpoint is unavailable.
      setReadiness(null);
      setReadinessError(reason instanceof Error ? reason.message : "Unable to verify canonical source readiness.");
    } finally {
      setReadinessLoading(false);
    }
  }, [tenderId]);

  const loadEngineState = useCallback(async () => {
    if (deletedRef.current) return;
    try {
      const response = await fetch(`/api/tenders/${tenderId}/engine-readiness`, { cache: "no-store" });
      if (response.status === 404 || response.status === 410) {
        deletedRef.current = true;
        return;
      }
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) {
        throw new Error(body?.error || `Engine readiness check failed (HTTP ${response.status}).`);
      }
      setEngineState({
        analysisCurrent: Boolean(body.analysisCurrent),
        engineRunning: Boolean(body.engineRunning),
        engineComplete: Boolean(body.engineComplete),
        engineFailed: Boolean(body.engineFailed),
        canRunEngine: Boolean(body.canRunEngine),
        activeJob: body.activeJob
          ? { id: String(body.activeJob.id), status: String(body.activeJob.status), createdAt: String(body.activeJob.createdAt) }
          : null,
      });
      setEngineStateError("");
    } catch (reason) {
      // Do not fall back to source-readiness wording: that would recreate the
      // contradiction whenever current Engine truth cannot be established.
      setEngineState(null);
      setEngineStateError(reason instanceof Error ? reason.message : "Unable to verify current Engine state.");
    } finally {
      setEngineStateLoading(false);
    }
  }, [tenderId]);

  useEffect(() => {
    void loadReadiness();
    void loadEngineState();
    const markDeleted = (event: Event) => {
      const detail = (event as CustomEvent<{ tenderId?: string }>).detail;
      if (!detail?.tenderId || detail.tenderId === tenderId) deletedRef.current = true;
    };
    window.addEventListener("tender-deletion-started", markDeleted);
    window.addEventListener("tender-deleted", markDeleted);
    return () => {
      window.removeEventListener("tender-deletion-started", markDeleted);
      window.removeEventListener("tender-deleted", markDeleted);
    };
  }, [loadEngineState, loadReadiness, tenderId]);

  // Self-limiting by construction: `engineRunning` is derived from an ACTIVE
  // job, so this interval clears itself when the job ends. It only needed the
  // hidden-tab guard the other two pollers on this page already use — a
  // background tab does no work, and the first tick after it is shown again
  // picks up the result.
  useEffect(() => {
    if (!engineState?.engineRunning || deletedRef.current) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadEngineState();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [engineState?.engineRunning, loadEngineState]);

  // A failed readiness check must not lock AI Analyze or the Engine state for
  // the life of the page. Both were loaded once on mount, so one request lost
  // in transit ("Failed to fetch") left the action disabled until a manual
  // reload — the same defect that greyed out Run Engine on 2026-09-23. While a
  // check is failing, ask again; the action still enables only when a check
  // actually succeeds, and a hidden tab does no work.
  useEffect(() => {
    if ((!readinessError && !engineStateError) || deletedRef.current) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      if (readinessError) void loadReadiness();
      if (engineStateError) void loadEngineState();
    }, READINESS_RETRY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [engineStateError, loadEngineState, loadReadiness, readinessError]);

  useEffect(() => {
    if (!jobId) return;
    let active = true;
    setAnalyzing(true);

    async function watchJob() {
      while (active && !deletedRef.current) {
        try {
          const response = await fetch(`/api/ai-jobs/${jobId}`, { cache: "no-store" });
          if (response.status === 404 || response.status === 410) return;
          if (response.ok) {
            const body = await response.json().catch(() => null);
            const job = body?.job as {
              status: JobStatus;
              errorMessage: string | null;
              steps?: Array<{ message: string | null }>;
            } | null;
            if (job) {
              setJobStatus(job.status);
              const lastStep = job.steps?.at(-1)?.message;
              if (lastStep) setPhase(lastStep);
              if (TERMINAL.includes(job.status)) {
                setAnalyzing(false);
                if (job.status === "SUCCEEDED") {
                  setPhase("AI Analyze completed for the current source revision.");
                  setError("");
                  await Promise.all([loadReadiness(), loadEngineState()]);
                  router.refresh();
                } else if (job.status === "PARTIAL_SUCCESS") {
                  setError("AI Analyze completed only partially. Run Engine remains blocked until complete grounded analysis succeeds.");
                } else {
                  setError(summarizeAIAnalyzeFailure(job.errorMessage));
                }
                return;
              }
            }
          }
        } catch {
          // The job is durable. Retry the status read without creating work.
        }
        await sleep(POLL_INTERVAL_MS);
      }
    }

    void watchJob();
    return () => { active = false; };
  }, [jobId, loadEngineState, loadReadiness, router]);

  const canonicalAnalysisReady = readiness?.analysisReady === true;
  // Prefer the Engine authority whenever it is available. While that request
  // is loading or unavailable, the source authority may hide the mutation but
  // must never guess the next Engine action.
  const analysisComplete = engineState
    ? engineState.analysisCurrent
    : readiness?.analysisCurrent === true;

  const runAiAnalyze = useCallback(async () => {
    if (submitting || analyzing || !canonicalAnalysisReady || readinessError || deletedRef.current) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/tenders/${tenderId}/manual-ai-analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error || `AI Analyze could not start (HTTP ${response.status}).`);
        await loadReadiness();
        return;
      }
      if (!body?.jobId) {
        setError("AI Analyze was accepted without a durable job ID. Reload and check the workflow status.");
        await loadReadiness();
        return;
      }
      setJobId(String(body.jobId));
      setJobStatus("QUEUED");
      setAnalyzing(true);
      setPhase("AI Analyze is queued — waiting for the durable worker.");
    } catch {
      setError("Network error. The job may still have been created — reload to check status.");
      await loadReadiness();
    } finally {
      setSubmitting(false);
    }
  }, [analyzing, canonicalAnalysisReady, loadReadiness, readinessError, submitting, tenderId]);

  async function runProviderDiagnostics() {
    setDiagnosing(true);
    setDiag(null);
    try {
      const response = await fetch("/api/ai-providers/diagnostics?live=1", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body) {
        setDiag({ aiAnalyzeReady: false, summary: "Provider diagnostics could not be completed.", perProvider: [] });
      } else {
        // aiAnalyzeReady is the field the route sends. `anyWorking` never
        // existed, so this banner was red even while announcing success.
        setDiag({
          aiAnalyzeReady: Boolean(body.aiAnalyzeReady),
          summary: String(body.summary ?? ""),
          perProvider: Array.isArray(body.perProvider) ? body.perProvider : [],
        });
      }
    } catch {
      setDiag({ aiAnalyzeReady: false, summary: "The provider diagnostics endpoint could not be reached.", perProvider: [] });
    } finally {
      setDiagnosing(false);
    }
  }

  // A completed analysis no longer disables the button. AI Analyze is one of
  // the two owner-reserved actions, and a finished run is not a reason the
  // owner may not ask for another one. The protection that matters — never two
  // analyses at once — is `!analyzing`, and it is untouched.
  const canRunAnalyze = canMutate
    && aiEnabled
    && canonicalAnalysisReady
    && !analyzing
    && !submitting
    && !readinessLoading
    && !readinessError;

  const blocker = readiness?.blockers[0] ?? null;
  const statusLabel = analyzing
    ? "AI Analyze is running."
    : analysisComplete
      ? engineStateLoading && !engineState
        ? "Checking current-revision Engine state."
        : engineStateError || !engineState
          ? "AI Analysis is complete, but current Engine state could not be verified. Check the Engine panel before taking another action."
          : describeAIAnalyzeWorkflowState(engineState)
      : engineState && !engineState.analysisCurrent && canonicalAnalysisReady
        ? describeAIAnalyzeWorkflowState(engineState)
      : !aiEnabled
        ? "No AI provider is configured."
        : readinessError
          ? "Canonical source readiness could not be verified. AI Analyze remains disabled."
          : canonicalAnalysisReady
            ? "Extraction complete. Run AI Analyze to continue."
            : blocker ?? "Canonical source extraction is still running or requires correction.";

  const disabledReason = !canMutate
    ? "You do not have permission to run AI Analyze."
    : !aiEnabled
      ? "Configure at least one supported AI provider."
      : readinessLoading
        ? "Checking canonical source readiness."
        : readinessError
          ? readinessError
          : !canonicalAnalysisReady
            ? blocker ?? "Canonical source extraction is not ready."
            : analyzing
              ? "An AI Analyze job is already running."
              : null;

  return (
    <section id="ai-analyze-section" className="mb-4 rounded-2xl border border-purple-100 bg-purple-50/30 p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI analysis</p>
      <h2 className="mt-1 text-lg font-bold text-slate-900">
        {analyzing ? "AI Analyze running" : analysisComplete ? "Analysis complete" : readiness?.analysisCurrent ? "Analysis refresh required" : canonicalAnalysisReady ? "Ready for AI Analyze" : "Source preparation required"}
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">{statusLabel}</p>
      {readiness && readiness.duplicateFileCount > 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          {readiness.duplicateFileCount} duplicate or alternate source representation(s) were excluded from the canonical readiness decision.
        </p>
      ) : null}

      {/* Always rendered for a user entitled to press it. Hiding it once the
          analysis had completed meant the owner opening a finished tender saw
          no AI Analyze control at all and could not re-run after correcting or
          adding a source. A finished run is a label, not a reason to remove the
          button. */}
      {canMutate ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => void runAiAnalyze()}
            disabled={!canRunAnalyze}
            aria-disabled={!canRunAnalyze}
            aria-busy={submitting || analyzing || readinessLoading}
            title={disabledReason ?? (analysisComplete ? "Re-run AI Analyze" : "Run AI Analyze")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${canRunAnalyze
              ? "bg-purple-600 text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
              : "cursor-not-allowed bg-slate-300 text-slate-500"}`}
          >
            <SparklesIcon />
            {submitting
              ? "Starting…"
              : analyzing
                ? "AI Analyze running…"
                : analysisComplete
                  ? "Re-run AI Analyze"
                  : "Run AI Analyze"}
          </button>
          {disabledReason && !canRunAnalyze ? <p className="mt-2 text-xs text-slate-500" role="note">{disabledReason}</p> : null}
          {analysisComplete && canRunAnalyze ? (
            <p className="mt-2 text-xs text-slate-500" role="note">
              Analysis is complete for this source revision. Re-running replaces it with a fresh
              analysis and supersedes the previous result, so downstream stages run again against it.
            </p>
          ) : null}
        </div>
      ) : null}

      {analyzing ? (
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-xs text-purple-700">
            <span>{phase || "Working…"}</span><span>{jobStatus ?? ""}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-purple-100"><div className="h-full w-1/2 animate-pulse bg-purple-600" /></div>
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">AI Analyze did not complete</p>
          <p className="mt-1 text-red-700">{error}</p>
          {canMutate ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => void runAiAnalyze()} disabled={submitting || analyzing || !canonicalAnalysisReady || Boolean(readinessError)} className="rounded-lg border border-purple-300 bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-60">Retry AI Analyze</button>
              <button type="button" onClick={() => void runProviderDiagnostics()} disabled={diagnosing} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-50 disabled:opacity-60">{diagnosing ? "Checking providers…" : "Check provider diagnostics"}</button>
            </div>
          ) : null}
        </div>
      ) : null}

      {diag ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
          {/*
            PROVIDER CAPABILITY IS SUBORDINATE TO WORKFLOW STATE.

            This line used to go emerald-green whenever a provider passed the
            probe, which put a success-coloured sentence directly beneath the
            red "AI Analyze did not complete" banner. The owner read the green
            line, clicked Run, and the run failed -- the probe is a small fixed
            payload and their tender needs 7,242 input tokens.

            When the last real run failed, a passing probe means "eligible to
            retry", not "proven". It is shown amber and says so.
          */}
          <p className={`text-xs font-semibold ${!diag.aiAnalyzeReady ? "text-red-700" : error ? "text-amber-700" : "text-emerald-700"}`}>{diag.summary}</p>
          {diag.aiAnalyzeReady && error ? (
            <p className="mt-1 text-xs text-amber-700">
              The last real AI Analyze run failed. A passing probe makes a retry worth attempting; it does not prove this tender will complete.
            </p>
          ) : null}
          {diag.perProvider.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {diag.perProvider.map((provider) => (
                <li key={provider.provider} className="flex items-start gap-2 text-xs">
                  <span className={`mt-0.5 ${provider.usableForAiAnalyze ? "text-emerald-600" : provider.diagnosticState === "KEY_MISSING" || provider.diagnosticState === "NOT_TESTED" ? "text-slate-400" : "text-red-600"}`}>{provider.usableForAiAnalyze ? <CheckIcon /> : provider.diagnosticState === "KEY_MISSING" || provider.diagnosticState === "NOT_TESTED" ? "—" : <CrossIcon />}</span>
                  <span className="font-medium text-slate-700">{provider.displayName || provider.provider}</span>
                  <span className="text-slate-500">{describeProvider(provider)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
