"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, CrossIcon, SparklesIcon } from "./icons";

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

type ProviderDiag = {
  provider: string;
  configured: boolean;
  ok: boolean;
  reason: string | null;
  latencyMs: number | null;
};

const POLL_INTERVAL_MS = 3_000;
const TERMINAL: JobStatus[] = ["SUCCEEDED", "PARTIAL_SUCCESS", "FAILED", "CANCELED"];

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
  const [diag, setDiag] = useState<{ anyWorking: boolean; summary: string; perProvider: ProviderDiag[] } | null>(null);
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

  useEffect(() => {
    void loadReadiness();
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
  }, [loadReadiness, tenderId]);

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
                  setPhase("AI Analyze complete. Run Engine to continue.");
                  setError("");
                  await loadReadiness();
                  router.refresh();
                } else if (job.status === "PARTIAL_SUCCESS") {
                  setError("AI Analyze completed only partially. Run Engine remains blocked until complete grounded analysis succeeds.");
                } else {
                  setError(job.errorMessage || "AI Analyze failed. Correct the source or provider issue, then retry.");
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
  }, [jobId, loadReadiness, router]);

  const canonicalAnalysisReady = readiness?.analysisReady === true;
  const analysisComplete = readiness?.analysisCurrent === true;

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
        setDiag({ anyWorking: false, summary: "Provider diagnostics could not be completed.", perProvider: [] });
      } else {
        setDiag({
          anyWorking: Boolean(body.anyWorking),
          summary: String(body.summary ?? ""),
          perProvider: Array.isArray(body.perProvider) ? body.perProvider : [],
        });
      }
    } catch {
      setDiag({ anyWorking: false, summary: "The provider diagnostics endpoint could not be reached.", perProvider: [] });
    } finally {
      setDiagnosing(false);
    }
  }

  const canRunAnalyze = canMutate
    && aiEnabled
    && canonicalAnalysisReady
    && !analyzing
    && !analysisComplete
    && !submitting
    && !readinessLoading
    && !readinessError;

  const blocker = readiness?.blockers[0] ?? null;
  const statusLabel = analyzing
    ? "AI Analyze is running."
    : analysisComplete
      ? "AI Analyze complete. Run Engine to continue."
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
              : analysisComplete
                ? "AI Analyze already completed successfully for this source revision."
                : null;

  return (
    <section id="ai-analyze-section" className="mb-4 rounded-2xl border border-purple-100 bg-purple-50/30 p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI analysis</p>
      <h2 className="mt-1 text-lg font-bold text-slate-900">
        {analyzing ? "AI Analyze running" : analysisComplete ? "Analysis complete" : canonicalAnalysisReady ? "Ready for AI Analyze" : "Source preparation required"}
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">{statusLabel}</p>
      {readiness && readiness.duplicateFileCount > 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          {readiness.duplicateFileCount} duplicate or alternate source representation(s) were excluded from the canonical readiness decision.
        </p>
      ) : null}

      {canMutate && !analysisComplete ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => void runAiAnalyze()}
            disabled={!canRunAnalyze}
            aria-disabled={!canRunAnalyze}
            aria-busy={submitting || analyzing || readinessLoading}
            title={disabledReason ?? "Run AI Analyze"}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${canRunAnalyze
              ? "bg-purple-600 text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
              : "cursor-not-allowed bg-slate-300 text-slate-500"}`}
          >
            <SparklesIcon />
            {submitting ? "Starting…" : analyzing ? "AI Analyze running…" : "Run AI Analyze"}
          </button>
          {disabledReason && !canRunAnalyze ? <p className="mt-2 text-xs text-slate-500" role="note">{disabledReason}</p> : null}
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
          <p className={`text-xs font-semibold ${diag.anyWorking ? "text-emerald-700" : "text-red-700"}`}>{diag.summary}</p>
          {diag.perProvider.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {diag.perProvider.map((provider) => (
                <li key={provider.provider} className="flex items-start gap-2 text-xs">
                  <span className={`mt-0.5 ${provider.ok ? "text-emerald-600" : provider.configured ? "text-red-600" : "text-slate-400"}`}>{provider.ok ? <CheckIcon /> : provider.configured ? <CrossIcon /> : "—"}</span>
                  <span className="font-medium text-slate-700">{provider.provider}</span>
                  <span className="text-slate-500">{provider.ok ? `OK${typeof provider.latencyMs === "number" ? ` (${provider.latencyMs}ms)` : ""}` : provider.reason ?? (provider.configured ? "failed" : "not configured")}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
