"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, CrossIcon } from "./icons";

type JobStatus = "QUEUED" | "RUNNING" | "PARTIAL_SUCCESS" | "SUCCEEDED" | "FAILED" | "CANCELED";

type Props = {
  tenderId: string;
  initialContinueJobId?: string | null;
  aiEnabled: boolean;
  canMutate?: boolean;
  analysisAlreadySucceeded?: boolean;
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
  analysisAlreadySucceeded = false,
}: Props) {
  const router = useRouter();
  const [analyzing, setAnalyzing] = useState(Boolean(initialContinueJobId));
  const [phase, setPhase] = useState(initialContinueJobId ? "AI Analyze is queued." : "");
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(initialContinueJobId ? "QUEUED" : null);
  const [error, setError] = useState("");

  type ProviderDiag = {
    provider: string;
    configured: boolean;
    ok: boolean;
    reason: string | null;
    latencyMs: number | null;
  };
  const [diag, setDiag] = useState<{
    anyWorking: boolean;
    summary: string;
    perProvider: ProviderDiag[];
  } | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);

  useEffect(() => {
    if (!initialContinueJobId) return;

    let active = true;
    setAnalyzing(true);
    setJobStatus("QUEUED");
    setPhase("AI Analyze is queued — waiting for the durable worker.");

    async function watchJob() {
      while (active) {
        let job: {
          status: JobStatus;
          errorMessage: string | null;
          steps?: Array<{ message: string | null }>;
        } | null = null;
        try {
          const response = await fetch(`/api/ai-jobs/${initialContinueJobId}`, {
            method: "GET",
            cache: "no-store",
          });
          if (response.ok) {
            const body = await response.json().catch(() => null);
            job = body?.job ?? null;
          }
        } catch {
          // The job is durable. Retry the status read without creating work.
        }

        if (job) {
          setJobStatus(job.status);
          const lastStep = job.steps?.at(-1)?.message;
          if (lastStep) setPhase(lastStep);

          if (TERMINAL.includes(job.status)) {
            setAnalyzing(false);
            if (job.status === "SUCCEEDED") {
              setPhase("AI Analyze completed. Engine matching and downstream generation continue automatically.");
              router.refresh();
            } else if (job.status === "PARTIAL_SUCCESS") {
              setError("AI Analyze completed only partially. Automatic Engine processing remains blocked until a complete grounded analysis succeeds.");
            } else if (job.status === "CANCELED") {
              setError(job.errorMessage || "AI Analyze was canceled. The durable recovery worker will retry when the blocking condition is resolved.");
            } else {
              setError(job.errorMessage || "AI Analyze failed. Correct the provider or extraction issue; durable recovery will resume automatically.");
            }
            return;
          }
        }

        await sleep(POLL_INTERVAL_MS);
      }
    }

    void watchJob();
    return () => { active = false; };
  }, [initialContinueJobId, router]);

  async function runProviderDiagnostics() {
    setDiagnosing(true);
    setDiag(null);
    try {
      const response = await fetch("/api/ai-providers/diagnostics?live=1", {
        method: "GET",
        cache: "no-store",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body) {
        setDiag({
          anyWorking: false,
          summary: response.status === 403
            ? "ADMIN or PROPOSAL_MANAGER access is required for provider diagnostics."
            : "Provider diagnostics could not be completed.",
          perProvider: [],
        });
      } else {
        setDiag({
          anyWorking: Boolean(body.anyWorking),
          summary: String(body.summary ?? ""),
          perProvider: Array.isArray(body.perProvider) ? body.perProvider : [],
        });
      }
    } catch {
      setDiag({
        anyWorking: false,
        summary: "The provider diagnostics endpoint could not be reached.",
        perProvider: [],
      });
    } finally {
      setDiagnosing(false);
    }
  }

  const analysisComplete = jobStatus === "SUCCEEDED" || (!analyzing && jobStatus === null && analysisAlreadySucceeded);
  const pendingLabel = !aiEnabled
    ? "AI provider configuration required"
    : "Automatic AI analysis pending";

  return (
    <section id="ai-analyze-section" className="mb-4 rounded-2xl border border-purple-100 bg-purple-50/30 p-5 shadow-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI analysis</p>
        <h2 className="mt-1 text-lg font-bold text-slate-900">
          {analyzing ? "AI Analyze running" : analysisComplete ? "Analysis complete" : pendingLabel}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          {analyzing
            ? (phase || "Extracting grounded requirements, client details, and evaluation criteria.")
            : analysisComplete
              ? "The grounded analysis is complete. Engine matching and the downstream proposal pipeline continue automatically."
              : !aiEnabled
                ? "Configure at least one supported AI provider. The durable pipeline will continue automatically when a provider is healthy."
                : "Source extraction, AI analysis, Engine matching, and downstream generation are handled automatically by durable workers."}
        </p>
      </div>

      {analyzing && (
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-xs text-purple-700">
            <span>{phase || "Working…"}</span>
            <span>{jobStatus ?? ""}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-purple-100">
            <div className="h-full w-1/2 animate-pulse bg-purple-600" />
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">AI Analyze did not complete</p>
          <p className="mt-1 text-red-700">{error}</p>
          {canMutate && (
            <button
              type="button"
              onClick={() => void runProviderDiagnostics()}
              disabled={diagnosing}
              className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-50 disabled:opacity-60"
            >
              {diagnosing ? "Checking providers…" : "Check provider diagnostics"}
            </button>
          )}
        </div>
      )}

      {diag && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
          <p className={`text-xs font-semibold ${diag.anyWorking ? "text-emerald-700" : "text-red-700"}`}>
            {diag.summary}
          </p>
          {diag.perProvider.length > 0 && (
            <ul className="mt-2 space-y-1">
              {diag.perProvider.map((provider) => (
                <li key={provider.provider} className="flex items-start gap-2 text-xs">
                  <span className={`mt-0.5 ${provider.ok ? "text-emerald-600" : provider.configured ? "text-red-600" : "text-slate-400"}`}>
                    {provider.ok ? <CheckIcon /> : provider.configured ? <CrossIcon /> : "—"}
                  </span>
                  <span className="font-medium text-slate-700">{provider.provider}</span>
                  <span className="text-slate-500">
                    {provider.ok
                      ? `OK${typeof provider.latencyMs === "number" ? ` (${provider.latencyMs}ms)` : ""}`
                      : provider.reason ?? (provider.configured ? "failed" : "not configured")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
