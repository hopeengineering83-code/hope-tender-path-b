"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRightIcon, BoltIcon, ClockIcon } from "./icons";
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
  if (typeof blocker === "string") {
    const code = blocker.trim().toUpperCase();
    if (code === "ENGINE_RAN_ZERO_EXPERT_MATCHES") {
      return "No eligible expert match rows were produced from source-verified Company Vault records.";
    }
    if (code === "ENGINE_RAN_ZERO_PROJECT_MATCHES") {
      return "No eligible project match rows were produced from source-verified Company Vault records.";
    }
    if (code === "NO_SELECTED_SOURCE_VERIFIED_EXPERTS_AFTER_ENGINE" || code === "NO_SELECTED_REVIEWED_EXPERTS_AFTER_ENGINE") {
      return "Expert candidates exist, but none selected by the Engine has verified source provenance.";
    }
    if (code === "NO_SELECTED_SOURCE_VERIFIED_PROJECTS_AFTER_ENGINE" || code === "NO_SELECTED_REVIEWED_PROJECTS_AFTER_ENGINE") {
      return "Project candidates exist, but none selected by the Engine has verified source provenance.";
    }
    if (code === "ENGINE_RAN_ZERO_EVIDENCE_ROWS") {
      return "The Engine produced no Company Vault evidence links for the extracted requirements.";
    }
    return formatOperationalReason(blocker);
  }

  const name = blocker.fileName?.trim();
  const severity = blocker.quality?.severity?.trim();
  if (!name && !severity) {
    return "A source file is blocked, but the Engine returned no detailed diagnostic. Open Extraction Quality for the full report.";
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
  status?: string;
  persistedStatus?: string;
  sourceRevision?: string;
  idempotencyKey?: string;
  statusEndpoint?: string;
  message?: string;
  failedStage?: string;
  reusedActiveJob?: boolean;
};

export type EngineAsyncStatus = { jobId: string; message: string };

type CompanyVaultRepairResponse = {
  success?: boolean;
  docsReextracted?: number;
  docsFailed?: number;
  expertsCreated?: number;
  projectsCreated?: number;
  error?: string;
  code?: string;
  requestId?: string;
};

type PolledJob = {
  status: string;
  errorMessage?: string | null;
  output?: Record<string, unknown> | null;
  steps?: Array<{ stepName?: string; message?: string }>;
};

type TerminalEngineJobStatus = "SUCCEEDED" | "FAILED" | "PARTIAL_SUCCESS" | "CANCELED";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000;
const TERMINAL_JOB_STATUSES = new Set<TerminalEngineJobStatus>(["SUCCEEDED", "FAILED", "PARTIAL_SUCCESS", "CANCELED"]);

function actionLabel(action?: string) {
  if (action === "UPLOAD_TENDER_DOCUMENT") return "Upload the tender source document.";
  if (action === "OPEN_EXTRACTION_QUALITY") return "Open Extraction Quality and repair weak or unreadable files.";
  if (action === "CONTACT_ADMIN_DATABASE_MIGRATION") return "Ask an administrator to update the isolated preview database, then retry.";
  if (action === "RETRY_BACKGROUND_JOB") return "Retry the durable Engine job.";
  if (action === "RETRY_AFTER_DATABASE_CHECK") return "Check database and worker readiness, then retry.";
  if (action === "OPEN_TENDER_LIST") return "Return to the tender list and reopen this tender.";
  if (action === "LOGIN_AGAIN") return "Sign in again, then retry.";
  if (action === "OPEN_EXTRACTION_ANALYSIS_MATCHING_QUALITY") return "Review Extraction, Analysis, and Matching Quality.";
  if (action === "REFRESH_TO_CHECK_STATUS") return "Check status again or refresh the workspace.";
  if (action === "REVIEW_MATCHING_INPUTS") return "Repair the source evidence; processing resumes automatically when it becomes eligible.";
  return null;
}

function humanBlockerSummary(blockers: string[] | undefined): string {
  if (!Array.isArray(blockers) || blockers.length === 0) {
    return "The Engine finished its processing pass, but no usable evidence outcome was confirmed.";
  }

  const codes = new Set(blockers.map((blocker) => blocker.trim().toUpperCase()));
  const expertBlocked = codes.has("ENGINE_RAN_ZERO_EXPERT_MATCHES")
    || codes.has("NO_SELECTED_SOURCE_VERIFIED_EXPERTS_AFTER_ENGINE")
    || codes.has("NO_SELECTED_REVIEWED_EXPERTS_AFTER_ENGINE");
  const projectBlocked = codes.has("ENGINE_RAN_ZERO_PROJECT_MATCHES")
    || codes.has("NO_SELECTED_SOURCE_VERIFIED_PROJECTS_AFTER_ENGINE")
    || codes.has("NO_SELECTED_REVIEWED_PROJECTS_AFTER_ENGINE");
  const evidenceBlocked = codes.has("ENGINE_RAN_ZERO_EVIDENCE_ROWS");

  if (expertBlocked && projectBlocked) {
    return "The Engine ran, but it could not confirm eligible source-verified expert or project evidence for this tender.";
  }
  if (expertBlocked) return "The Engine ran, but it could not confirm eligible source-verified expert evidence for this tender.";
  if (projectBlocked) return "The Engine ran, but it could not confirm eligible source-verified project evidence for this tender.";
  if (evidenceBlocked) return "The Engine extracted requirements, but no Company Vault evidence links were confirmed.";
  return "The Engine finished its processing pass, but evidence matching remains blocked by source authority.";
}

async function parseEngineResponse(res: Response): Promise<EngineResponse> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await res.json() as EngineResponse;
  }

  const text = await res.text().catch(() => "");
  const clean = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 320);
  return {
    error: `The Engine returned an invalid server response (${res.status} ${res.statusText || "HTTP error"}).`,
    code: "NON_JSON_RESPONSE",
    detail: clean || "No response body was returned.",
    nextAction: res.status === 401 ? "LOGIN_AGAIN" : "RETRY_AFTER_DATABASE_CHECK",
  };
}

function asyncEngineFailureResult(
  publicError: string | null | undefined,
  jobId: string,
  jobOutput?: Record<string, unknown> | null,
  fallbackCode = "ASYNC_ENGINE_FAILED",
): EngineResponse {
  const message = publicError ?? "No worker detail was returned.";
  const schemaUpdateRequired = message.includes("DATABASE_SCHEMA_UPDATE_REQUIRED");
  return {
    success: false,
    error: `Background Engine run failed: ${message}`,
    code: schemaUpdateRequired
      ? "DATABASE_SCHEMA_UPDATE_REQUIRED"
      : typeof jobOutput?.code === "string" ? jobOutput.code : fallbackCode,
    nextAction: schemaUpdateRequired
      ? "CONTACT_ADMIN_DATABASE_MIGRATION"
      : typeof jobOutput?.nextAction === "string" ? jobOutput.nextAction : "RETRY_BACKGROUND_JOB",
    failedStage: typeof jobOutput?.failedStage === "string" ? jobOutput.failedStage : undefined,
    jobId,
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
  lifecycleBlockersExist?: boolean;
  callbacks: EngineRunCallbacks;
};

export type EngineAsyncRunOptions = EngineRunOptions & {
  pollIntervalMs?: number;
  maxPollDurationMs?: number;
};

/**
 * Compatibility entry point used by existing callers. Production execution is
 * always the same durable enqueue-and-poll workflow; there is no synchronous
 * fallback or client-selectable execution policy.
 */
export async function executeEngineRun(options: EngineRunOptions): Promise<void> {
  await executeEngineRunAsync(options);
}

export async function executeEngineRunAsync(options: EngineAsyncRunOptions): Promise<void> {
  const {
    tenderId,
    canMutate,
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
    const enqueueRes = await fetch(`/api/tenders/${tenderId}/engine`, { method: "POST" });
    const enqueueData = await parseEngineResponse(enqueueRes);
    if (!enqueueRes.ok || !enqueueData.jobId) {
      callbacks.setResult(enqueueData);
      return;
    }

    const jobId = enqueueData.jobId;
    callbacks.setAsyncStatus({
      jobId,
      message: enqueueData.reusedActiveJob
        ? "Existing durable Engine job resumed."
        : "Engine queued. Starting background worker…",
    });

    // This endpoint only wakes an authenticated worker. The persisted job is
    // already durable, so browser closure cannot cancel it.
    fetch("/api/ai-jobs/run-next", { method: "POST" }).catch(() => {});

    const startedAt = Date.now();
    let finalStatus: TerminalEngineJobStatus | null = null;
    let finalJob: PolledJob | null = null;

    while (Date.now() - startedAt < maxPollDurationMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      const pollRes = await fetch(`/api/ai-jobs/${jobId}`, { method: "GET" });
      if (!pollRes.ok) continue;
      const { job } = await pollRes.json() as { job: PolledJob };
      const lastStep = job.steps?.[job.steps.length - 1];
      callbacks.setAsyncStatus({
        jobId,
        message: lastStep?.message ?? `Worker status: ${formatOperationalCode(job.status)}`,
      });
      if (TERMINAL_JOB_STATUSES.has(job.status as TerminalEngineJobStatus)) {
        finalStatus = job.status as TerminalEngineJobStatus;
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
          error: "Background Engine run completed, but matching is blocked.",
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
        sourceRevision: enqueueData.sourceRevision,
        idempotencyKey: enqueueData.idempotencyKey,
        error: lifecycleBlockersExist
          ? "Engine completed. Workflow blockers remain; follow the Next Required Action card above."
          : "Engine completed in the background. Downstream processing continues automatically.",
      });
      callbacks.onSuccess();
    } else if (finalStatus === "FAILED") {
      const jobOutput = finalJob?.output as Record<string, unknown> | null | undefined;
      callbacks.setResult(asyncEngineFailureResult(finalJob?.errorMessage, jobId, jobOutput));
    } else if (finalStatus === "PARTIAL_SUCCESS") {
      const jobOutput = finalJob?.output as Record<string, unknown> | null | undefined;
      callbacks.setResult(asyncEngineFailureResult(
        finalJob?.errorMessage ?? "The worker completed only a partial, non-authoritative result.",
        jobId,
        jobOutput,
        "ENGINE_PARTIAL_SUCCESS_BLOCKED",
      ));
    } else if (finalStatus === "CANCELED") {
      callbacks.setResult(asyncEngineFailureResult(
        finalJob?.errorMessage ?? "The job was superseded by a newer source revision.",
        jobId,
        finalJob?.output,
        "ENGINE_JOB_SUPERSEDED",
      ));
    } else {
      callbacks.setResult({
        error: "The Engine is still running in the background. Browser polling stopped, but the durable worker continues.",
        code: "ASYNC_POLL_TIMEOUT",
        nextAction: "REFRESH_TO_CHECK_STATUS",
        jobId,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    callbacks.setResult({
      error: `Background Engine request failed: ${message || "No runtime detail was returned."}`,
      code: "NETWORK_OR_RUNTIME_ERROR",
      nextAction: "RETRY_BACKGROUND_JOB",
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
  const [repairingVault, setRepairingVault] = useState(false);

  const callbacks: EngineRunCallbacks = {
    setRunning,
    setResult,
    setAsyncStatus,
    onSuccess: () => startTransition(() => router.refresh()),
  };

  async function runEngine() {
    if (!canMutate || running || repairingVault || isPending) return;
    await executeEngineRunAsync({ tenderId, canMutate, lifecycleBlockersExist, callbacks });
  }

  async function repairVaultAndRetry() {
    if (!canMutate || running || repairingVault || isPending) return;
    setRepairingVault(true);
    setResult({
      success: false,
      error: "Repairing Company Vault sources…",
      code: "COMPANY_VAULT_REPAIR_RUNNING",
      detail: "The system is re-extracting stored source bytes and rebuilding provenance-bound records.",
    });

    try {
      const response = await fetch("/api/company/reimport", { method: "POST" });
      const data = await response.json().catch(() => ({})) as CompanyVaultRepairResponse;
      if (!response.ok) {
        setResult({
          success: false,
          error: data.error ?? "Company Vault repair failed before the Engine could retry.",
          code: data.code ?? "COMPANY_VAULT_REPAIR_FAILED",
          diagnosticId: data.requestId,
          nextAction: "REVIEW_MATCHING_INPUTS",
        });
        return;
      }

      setResult({
        success: true,
        error: `Company Vault repaired: ${data.docsReextracted ?? 0} document(s) re-extracted, ${data.expertsCreated ?? 0} expert record(s), and ${data.projectsCreated ?? 0} project record(s). Restarting the durable Engine workflow…`,
        code: "COMPANY_VAULT_REPAIRED",
      });
      startTransition(() => router.refresh());
      await executeEngineRunAsync({ tenderId, canMutate, lifecycleBlockersExist, callbacks });
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? `Company Vault repair failed: ${error.message}` : "Company Vault repair failed because of a runtime error.",
        code: "COMPANY_VAULT_REPAIR_FAILED",
        nextAction: "REVIEW_MATCHING_INPUTS",
      });
    } finally {
      setRepairingVault(false);
    }
  }

  const ok = result?.success === true;
  const action = actionLabel(result?.nextAction);
  const technicalDetails = [
    result?.code ? `Code: ${result.code}` : null,
    result?.diagnosticId ? `Diagnostic: ${result.diagnosticId}` : null,
    result?.failedStage ? `Stage: ${result.failedStage}` : null,
    result?.jobId ? `Job: ${result.jobId}` : null,
    result?.sourceRevision ? `Source revision: ${result.sourceRevision}` : null,
  ].filter((value): value is string => Boolean(value));
  const visibleBlockers = Array.isArray(result?.blockers)
    ? [...new Set(result.blockers.map((blocker) => describeEngineBlocker(blocker)))]
    : [];

  return (
    <section id="run-engine-action" className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Automated Engine</p>
        <h2 className="mt-1 text-lg font-bold text-slate-900">
          {running || repairingVault ? "Processing automatically" : ok ? "Engine complete" : result ? "Engine needs attention" : "Pending automatic processing"}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Eligible Company Vault evidence is verified, queued, matched, selected, and converted into a source-bound Build Plan by server policy. Closing this browser does not stop processing.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Current source-verified inventory: {vaultReviewedExperts} expert(s), {vaultReviewedProjects} project(s).
        </p>
      </div>

      {asyncStatus && (
        <div role="status" aria-live="polite" className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-800">
          <p className="font-semibold">Engine processing continues in the background</p>
          <p className="mt-1">{formatOperationalReason(asyncStatus.message)}</p>
          <p className="mt-2 break-all font-mono text-xs text-indigo-700">Job {asyncStatus.jobId}</p>
        </div>
      )}

      {result && (
        <div className={`mt-4 rounded-xl border p-4 text-sm ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : result.code === "ASYNC_POLL_TIMEOUT" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-800"}`}>
          <p className="font-semibold">{result.error ?? (ok ? "Engine completed." : "Engine needs attention.")}</p>
          {result.code && <p className="mt-1 text-xs font-mono">{formatOperationalCode(result.code)}</p>}
          {action && <p className="mt-2"><strong>Next action:</strong> {action}</p>}
          {result.hint && <p className="mt-1"><strong>Guidance:</strong> {formatOperationalReason(result.hint)}</p>}
          {result.detail && <p className="mt-1"><strong>Summary:</strong> {formatOperationalReason(result.detail)}</p>}

          {technicalDetails.length > 0 && (
            <details className="mt-3 rounded-lg border border-current/10 bg-white/70 p-3 text-xs">
              <summary className="cursor-pointer font-semibold">Technical diagnostics</summary>
              <ul className="mt-2 space-y-1 break-all font-mono">
                {technicalDetails.map((detail) => <li key={detail}>{detail}</li>)}
              </ul>
            </details>
          )}

          {visibleBlockers.length > 0 && (
            <div className="mt-3 rounded-lg bg-white p-3">
              <p className="font-semibold">Blocking evidence gaps</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {visibleBlockers.slice(0, 5).map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
