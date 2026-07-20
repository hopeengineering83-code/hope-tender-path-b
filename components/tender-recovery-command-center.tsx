"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getRecoveryCommandActionSpec, recoveryCommandLabel, renderRecoveryActionPath, isMutationAction } from "../lib/recovery-command-actions";
import { subscribeTenderWorkflowSync, emitTenderWorkflowSync } from "../lib/ui/tender-workflow-sync";
import { PlayIcon, DownloadIcon, RefreshIcon, ChevronDownIcon, CheckIcon, CrossIcon, BanIcon, WarningIcon, InfoIcon } from "./icons";
import { SnapshotConsistencyBadge } from "./snapshot-consistency-badge";

// ─── Types (mirror lib/engine/tender-lifecycle-orchestrator.ts) ───────────────

type LifecycleState =
  | "UPLOADED" | "EXTRACTED" | "AI_ANALYSIS_REQUIRED" | "AI_ANALYSIS_FAILED"
  | "ANALYSIS_FALLBACK_UNAPPROVED" | "ANALYSIS_FALLBACK_APPROVED_AUDIT_ONLY"
  | "ANALYSIS_READY_FOR_REVIEW" | "ANALYSIS_APPROVED"
  | "METADATA_INCOMPLETE" | "SOURCE_REFERENCES_INCOMPLETE" | "SUBMISSION_PLAN_REQUIRED"
  | "SUBMISSION_PLAN_READY" | "EVIDENCE_MATCHING_REQUIRED" | "EVIDENCE_MATCHING_EMPTY"
  | "EVIDENCE_MATCHING_UNCONFIRMED" | "EVIDENCE_MATCHED"
  | "DOCUMENT_GENERATION_REQUIRED" | "DOCUMENTS_GENERATED" | "OFFICIAL_ORIGINALS_REQUIRED"
  | "QUALITY_REVIEW_REQUIRED" | "AUTO_FINALIZE_REQUIRED" | "PARTIAL_AI_ANALYSIS_BLOCKED"
  | "EXPORT_READINESS_BLOCKED" | "EXPORT_READY" | "ZIP_READY" | "CLOSED";

type BlockedAction = { action: string; reason: string };
// buildPublicReadinessEnvelope (lib/engine/public-readiness-envelope.ts)
// normalizes every blocker's recommended action to `nextAction` before this
// route's response is built — the orchestrator's own internal `action` field
// never reaches the client. Reading `.action` here always returned
// `undefined`, rendering "Action: " with nothing after it.
type Blocker = { code: string; message: string; nextAction: string };
type Warning = { code: string; message: string };

type LifecycleResult = {
  lifecycleState: LifecycleState;
  finalSubmissionStatus: "BLOCKED" | "PARTIAL" | "READY";
  primaryNextAction: string;
  allowedActions: string[];
  blockedActions: BlockedAction[];
  blockers: Blocker[];
  warnings: Warning[];
  advisoryWarnings: Warning[];
  diagnosticId?: string;
  counts: {
    requiredPlanRows: number;
    generatedNarrativeDocs: number;
    attachedOfficialOriginals: number;
    plannedMissingDocs: number;
    controlRows: number;
    outsidePlanRows: number;
    finalExportCandidates: number;
    qualityFailedCandidates: number;
    historicalSupersededRows: number;
    envelopes: { TECHNICAL: number; FINANCIAL: number; ADMIN: number };
  };
  providerStatus: {
    totalConfigured: number;
    totalHealthy: number;
    hasAnyProvider: boolean;
    hasCooledDownProvider: boolean;
    primaryProvider: string | null;
  };
  analysisStatus: { source: string; hasText: boolean; score: number | null; canonicalState?: string; stale?: boolean; partial?: boolean };
  metadataStatus: {
    completenessRatio: number;
    criticalMissing: string[];
    nonCriticalMissing: string[];
  };
  sourceReferenceStatus: { ungroundedMandatoryCount: number; totalMandatoryCount: number };
  planStatus: {
    hasExplicitPlan: boolean;
    totalRequired: number;
    totalGenerated: number;
    totalMissing: number;
    totalOutsidePlan: number;
    totalOfficialOriginalsRequired: number;
  };
  evidenceStatus: { totalMandatory: number; fullyCoveredMandatory: number; coverageRatio: number; engineHasRun?: boolean };
  documentStatus: { total: number; generated: number; planned: number; superseded: number };
  qualityStatus: { qualityFailed: number };
  officialOriginalStatus: { required: number; attached: number };
  exportStatus: {
    ready: boolean;
    blockerCount: number;
    documentBlockerCount: number;
    advisoryCount: number;
  };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATE_LABELS: Record<LifecycleState, string> = {
  UPLOADED: "Uploaded",
  EXTRACTED: "Text Extracted",
  AI_ANALYSIS_REQUIRED: "AI Analysis Required",
  AI_ANALYSIS_FAILED: "AI Analysis Failed",
  ANALYSIS_FALLBACK_UNAPPROVED: "Fallback Analysis — Unapproved",
  ANALYSIS_FALLBACK_APPROVED_AUDIT_ONLY: "Fallback Approved — Audit Only",
  ANALYSIS_READY_FOR_REVIEW: "Analysis Ready",
  ANALYSIS_APPROVED: "Analysis Approved",
  METADATA_INCOMPLETE: "Tender Workflow",
  SOURCE_REFERENCES_INCOMPLETE: "Source References Incomplete",
  SUBMISSION_PLAN_REQUIRED: "Submission Plan Required",
  SUBMISSION_PLAN_READY: "Submission Plan Ready",
  EVIDENCE_MATCHING_REQUIRED: "Evidence Matching Required",
  EVIDENCE_MATCHING_EMPTY: "Engine Ran — No Matches",
  EVIDENCE_MATCHING_UNCONFIRMED: "Evidence Unconfirmed",
  EVIDENCE_MATCHED: "Evidence Matched",
  DOCUMENT_GENERATION_REQUIRED: "Documents Need Generation",
  DOCUMENTS_GENERATED: "Documents Generated",
  OFFICIAL_ORIGINALS_REQUIRED: "Official Originals Required",
  QUALITY_REVIEW_REQUIRED: "Quality Review Required",
  AUTO_FINALIZE_REQUIRED: "Ready to Finalize",
  PARTIAL_AI_ANALYSIS_BLOCKED: "AI Analyze Partial — Resume Required",
  EXPORT_READINESS_BLOCKED: "Export Blocked",
  EXPORT_READY: "Export Ready",
  ZIP_READY: "ZIP Ready",
  CLOSED: "Closed (WON/LOST/WITHDRAWN)",
};

const ACTION_LABELS = new Proxy({} as Record<string, string>, {
  get: (_target, prop: string | symbol) => typeof prop === "string" ? recoveryCommandLabel(prop) : undefined,
});

// Per spec rule 7: "Analysis Approved" must not look like release approval
// when final submission is BLOCKED. This helper downgrades the badge color
// to amber (secondary) when the final status is BLOCKED, even if the state
// would otherwise be blue/green. Only EXPORT_READY / ZIP_READY / CLOSED
// keep their strong colors when final is BLOCKED — and EXPORT_READY can
// never be BLOCKED by definition (finalExportReady=true ⇒ READY).
function stateColor(state: LifecycleState, finalStatus: "BLOCKED" | "PARTIAL" | "READY"): string {
  if (state === "EXPORT_READY" || state === "ZIP_READY") return "bg-green-100 text-green-800 border-green-300";
  if (state === "CLOSED") return "bg-slate-100 text-slate-600 border-slate-300";
  if (state === "AUTO_FINALIZE_REQUIRED" || state === "DOCUMENTS_GENERATED") {
    // Blue (good) only when final is READY or PARTIAL. When BLOCKED, downgrade
    // to amber so the user does not mistake "Ready to Finalize" for release-ready.
    return finalStatus === "BLOCKED"
      ? "bg-amber-100 text-amber-800 border-amber-300"
      : "bg-blue-100 text-blue-800 border-blue-300";
  }
  // ANALYSIS_APPROVED: when final is BLOCKED, this is NOT release approval.
  // Render as amber (secondary) so the user reads it as "context only" and
  // pays attention to the BLOCKED badge instead.
  if (state === "ANALYSIS_APPROVED" && finalStatus === "BLOCKED") {
    return "bg-amber-100 text-amber-800 border-amber-300";
  }
  if (state.includes("REQUIRED") || state.includes("FAILED") || state.includes("UNAPPROVED") || state.includes("EMPTY") || state.includes("UNCONFIRMED") || state.includes("BLOCKED") || state.includes("PARTIAL_AI")) return "bg-red-100 text-red-800 border-red-300";
  return "bg-amber-100 text-amber-800 border-amber-300";
}

function submissionBadge(status: "BLOCKED" | "PARTIAL" | "READY") {
  if (status === "READY") return "bg-green-600 text-white";
  if (status === "PARTIAL") return "bg-amber-500 text-white";
  return "bg-red-600 text-white";
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function TenderRecoveryCommandCenter({ tenderId, canMutate = false }: { tenderId: string; canMutate?: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<LifecycleResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [analyzeProgress, setAnalyzeProgress] = useState<number | null>(null);
  const [approvalNote, setApprovalNote] = useState("");
  // NOTE: The old `ocrProvider` state was dead — setOcrProvider was never
  // called (no <select> or programmatic setter), so the state was always
  // "auto" and the `isReExtract && ocrProvider !== "auto"` branch below was
  // unreachable. Removed to avoid implying an OCR-provider selector exists.

  function scrollToPanel(anchorId: string, fallbackMessage: string) {
    const el = document.getElementById(anchorId);
    if (!el) {
      setActionMsg(`${fallbackMessage} Panel #${anchorId} is not visible on this page; use the tender detail tabs manually.`);
      return;
    }
    el.scrollIntoView({ behavior: "smooth" });
    setActionMsg(fallbackMessage);
  }

  function messageForApiAction(action: string, json: Record<string, unknown>) {
    if (action === "RUN_AI_ANALYZE" || action === "RETRY_AI_ANALYZE" || action === "REVIEW_ANALYSIS" || action === "RESUME_AI_ANALYZE") {
      return json.fallback ? "Regex fallback used — generation remains blocked. Retry when providers recover or approve for audit only." : "Analysis completed. Verify results in the Analysis Quality panel.";
    }
    if (action === "BUILD_SUBMISSION_PLAN") return `Plan built — ${json.created ?? 0} file(s) created, ${json.skipped ?? 0} already existed.`;
    if (action === "RUN_ENGINE") return "Engine ran. Review lifecycle, generation readiness, and export readiness before proceeding.";
    if (action === "RESUME_AI_ANALYZE") return "AI Analyze resume enqueued. Polling until the job completes — remaining chunks will be picked up automatically.";
    if (action === "REPAIR_SOURCE_REFERENCES") return `Source repair complete — ${json.repairedCount ?? 0} requirement(s) updated.`;
    if (action === "GENERATE_REQUIRED_DOCUMENTS" || action === "GENERATE_DOCS" || action === "GENERATE_MISSING_PLANNED_DOCS") return `Missing planned document generation finished — ${json.generated ?? json.created ?? json.count ?? 0} row(s) updated. Review and validate before export.`;
    if (action === "VALIDATE_DOCS") return "Validation completed. Review validation results and remaining blockers.";
    if (action === "REPAIR_DOCUMENT_QUALITY" || action === "REPAIR_DOCS") return `Export-gap repair completed — ${json.repaired ?? json.updated ?? 0} document(s) updated. Re-check readiness before export.`;
    if (action === "AUTO_FINALIZE") return `Auto-finalize completed — ${json.finalized ?? json.updated ?? 0} document(s) updated. Re-check export readiness before download.`;
    if (action === "RESOLVE_EXPORT_BLOCKERS" || action === "EXPORT_READINESS") return "Export readiness re-checked. Review the Export Readiness panel for canonical blockers.";
    if (action === "RECONCILE_OUTSIDE_PLAN_DOCS" || action === "EXCLUDE_OUTSIDE_PLAN_DOCS") return `Outside-plan reconciliation completed — ${json.superseded ?? 0} document(s) excluded/superseded.`;
    if (action === "REPAIR_METADATA") {
      // Versioned-safe contract: API returns { outcomes: [...] } not { repaired: [...] }
      const outcomes: Array<{ field?: string; status?: string }> = Array.isArray(json.outcomes) ? json.outcomes as Array<{ field?: string; status?: string }> : [];
      const repairedFields = outcomes.filter((o) => o.status === "REPAIRED").map((o) => o.field ?? "unknown");
      // Treat NOT_FOUND, REJECTED, UNRESOLVED, and ERROR as unresolved
      const unresolvedFields = outcomes.filter((o) => o.status === "NOT_FOUND" || o.status === "REJECTED" || o.status === "UNRESOLVED" || o.status === "ERROR").map((o) => o.field ?? "unknown");
      if (repairedFields.length > 0 && unresolvedFields.length === 0) {
        return `Tender Details repaired — ${repairedFields.join(", ")} updated from tender source text.`;
      } else if (repairedFields.length > 0 && unresolvedFields.length > 0) {
        return `Tender Details partially repaired — ${repairedFields.join(", ")} updated. ${unresolvedFields.length} field(s) remain unresolved: ${unresolvedFields.join(", ")}.`;
      } else {
        // Never report "Tender Details repaired" when unresolved or error outcomes remain
        return `Tender Details repair ran — no fields could be extracted from the tender source text. ${unresolvedFields.length} field(s) remain unresolved.`;
      }
    }
    if (action === "RE_EXTRACT_METADATA") return "Tender Details re-extraction complete. Review the tender detail panel to confirm updated fields.";
    if (action === "LINK_VAULT_EVIDENCE") return (json.message as string | undefined) ?? `Vault evidence linking completed — ${(json.linked as number | undefined) ?? 0} document(s) ready.`;
    return `${recoveryCommandLabel(action)} completed.`;
  }

  // AI Analyze uses the durable background path (?mode=background) — NOT direct
  // SSE. The old SSE path was bounded by Vercel's 60s function cap and would
  // silently fail on large tenders. The durable path enqueues a job (202),
  // triggers the worker, and polls /api/ai-jobs/[jobId] until terminal.
  async function runDurableAnalyze(path: string): Promise<string> {
    setAnalyzeProgress(5);
    setActionMsg("Enqueuing durable analysis job…");

    // 1. Enqueue
    const enqueueRes = await fetch(path, { method: "POST" });
    if (enqueueRes.status === 401 || enqueueRes.status === 403) {
      setAnalyzeProgress(null);
      throw new Error("You are not authorized to run AI analysis. Please sign in again.");
    }
    if (enqueueRes.status === 422) {
      const d = await enqueueRes.json().catch(() => ({}));
      setAnalyzeProgress(null);
      throw new Error(d.error ?? "Extraction is not ready. Run OCR or re-upload.");
    }
    if (enqueueRes.status !== 202) {
      const d = await enqueueRes.json().catch(() => ({}));
      setAnalyzeProgress(null);
      throw new Error(d.error ?? `Failed to start analysis (HTTP ${enqueueRes.status}).`);
    }
    const enqueued = await enqueueRes.json();
    const jobId: string | undefined = enqueued.jobId;
    if (!jobId) {
      setAnalyzeProgress(null);
      throw new Error("No job ID returned from the analysis endpoint.");
    }
    setAnalyzeProgress(10);
    setActionMsg("Starting worker…");

    // 2. Trigger the worker
    const workerRes = await fetch(`/api/ai-jobs/run-next?jobType=AI_ANALYZE`, { method: "POST" });
    if (workerRes.status === 401 || workerRes.status === 403) {
      setActionMsg("Worker could not be started (session expired). The job is queued and will be picked up automatically.");
    } else if (workerRes.status >= 500) {
      setActionMsg("Worker start failed. The job is queued and will be retried automatically.");
    }

    // 3. Poll job status
    setAnalyzeProgress(15);
    setActionMsg("Analysis running…");
    let pollCount = 0;
    const maxPolls = 240;
    while (pollCount < maxPolls) {
      pollCount++;
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch(`/api/ai-jobs/${jobId}`);
        if (!res.ok) continue;
        const data = await res.json();
        const job = data?.job;
        if (!job) continue;

        const steps: Array<{ message?: string | null }> = job.steps ?? [];
        const latestStep = steps[steps.length - 1];
        if (latestStep?.message) setActionMsg(String(latestStep.message).slice(0, 80));

        const status: string = job.status;
        const output: Record<string, unknown> = job.output ?? {};

        if (status === "QUEUED" || status === "RUNNING") {
          const completed = typeof output.completedChunks === "number" ? output.completedChunks : 0;
          const total = typeof output.totalChunks === "number" ? output.totalChunks : 0;
          if (total > 0 && completed > 0) {
            setAnalyzeProgress(Math.min(Math.round(15 + (completed / total) * 75), 90));
          } else {
            setAnalyzeProgress(Math.min(15 + pollCount * 2, 85));
          }
          continue;
        }

        // Terminal
        setAnalyzeProgress(null);
        if (status === "SUCCEEDED") {
          const reqCount = typeof output.requirementCount === "number" ? output.requirementCount : 0;
          return `Analysis complete — ${reqCount} requirement(s) extracted and promoted.`;
        }
        if (status === "PARTIAL_SUCCESS") {
          return "Analysis partial — some chunks failed. Generation remains blocked. Retry when providers recover.";
        }
        const errMsg = (typeof job.errorMessage === "string" && job.errorMessage) ||
          (typeof output.errorMessage === "string" && output.errorMessage) ||
          "Analysis failed.";
        throw new Error(errMsg);
      } catch (e) {
        if (pollCount >= maxPolls) {
          setAnalyzeProgress(null);
          throw new Error("Analysis is taking longer than expected. It may still be running — refresh the page.");
        }
      }
    }
    setAnalyzeProgress(null);
    return "Analysis is still running in the background. Refresh the page to check status.";
  }

  async function executeAction(action: string) {
    setActioning(true);
    setActionMsg(null);
    try {
      const spec = getRecoveryCommandActionSpec(action);
      if (!spec) {
        setActionMsg("Action not available yet — open the relevant panel manually.");
        return;
      }

      if (action === "APPROVE_FALLBACK_WITH_NOTE") {
        const note = approvalNote.trim();
        if (!note) { setActionMsg("An approval note is required."); return; }
        const res = await fetch(`/api/tenders/${tenderId}/approve-analysis`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Approval failed");
        setActionMsg("Fallback note saved for audit. Generation and export remain blocked until full AI analysis succeeds.");
        setApprovalNote("");
        await load();
        router.refresh();
        emitTenderWorkflowSync({ tenderId, source: "recovery-command-center" });
        return;
      }

      if (spec.kind === "download" && spec.path) {
        window.location.href = renderRecoveryActionPath(spec.path, tenderId);
        return;
      }
      if (spec.kind === "navigate" && spec.path) {
        window.location.href = renderRecoveryActionPath(spec.path, tenderId);
        return;
      }
      if (spec.kind === "scroll" && spec.anchorId) {
        scrollToPanel(spec.anchorId, spec.message ?? `Open ${spec.label}.`);
        return;
      }
      if (spec.kind === "refresh") {
        await load();
        router.refresh();
        emitTenderWorkflowSync({ tenderId, source: "recovery-command-center" });
        setActionMsg("Readiness re-checked. Review the command center and export-readiness panels for current blockers.");
        return;
      }
      if (spec.kind === "api" && spec.path) {
        // AI Analyze actions use the durable background path (?mode=background).
        if (spec.path.includes("/ai-analyze")) {
          const msg = await runDurableAnalyze(renderRecoveryActionPath(spec.path, tenderId));
          setActionMsg(msg);
          await load();
          router.refresh();
        emitTenderWorkflowSync({ tenderId, source: "recovery-command-center" });
          return;
        }
        const fetchOptions: RequestInit = {
          method: spec.method ?? "POST",
        };
        const res = await fetch(renderRecoveryActionPath(spec.path, tenderId), fetchOptions);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? json.message ?? `${spec.label} failed`);
        // Per spec rule 8: for RUN_ENGINE, refresh lifecycle first, then
        // build the success message from the refreshed primaryNextAction
        // so the user sees the TRUE next step (Link/confirm evidence,
        // Generate docs, etc.) instead of a generic "Engine ran" message
        // that hides remaining blockers.
        if (action === "RUN_ENGINE") {
          // ─── Blocker 3: handle partial engine responses ───────────────
          // The engine route returns HTTP 200 with `partial: true` and
          // `success: false` when AI evidence matching failed or was skipped
          // for deadline reasons. Checking only `res.ok` here would still
          // show "Engine completed…" and hide the blocker — bypassing the
          // honesty fixes already in engine-action-panel and tender-detail.
          // Branch on `json.partial` / `json.success` BEFORE calling
          // engineFollowUpMessage so the user sees the blocker text + the
          // engine's own nextAction (REVIEW_MATCHING_INPUTS or
          // RETRY_ENGINE_SMALLER_BATCH), matching the engine-action-panel
          // and tender-detail generation flow.
          if (json.partial === true || json.success === false) {
            const blockerText = Array.isArray(json.blockers) && json.blockers.length > 0
              ? String(json.blockers[0])
              : (typeof json.error === "string" && json.error
                ? json.error
                : "Engine completed partially — AI evidence matching did not complete. Review required.");
            const nextAction = typeof json.nextAction === "string" && json.nextAction
              ? json.nextAction
              : "REVIEW_MATCHING_INPUTS";
            const nextLabel = ACTION_LABELS[nextAction] ?? nextAction;
            const blockerCode = json.evidenceMatchingBlocker?.code ?? "EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED";
            await load();
            router.refresh();
        emitTenderWorkflowSync({ tenderId, source: "recovery-command-center" });
            setActionMsg(`Engine did NOT complete fully. ${blockerText} Next: ${nextLabel}. (Code: ${blockerCode})`);
            return;
          }
          const refreshed = await load();
          router.refresh();
        emitTenderWorkflowSync({ tenderId, source: "recovery-command-center" });
          setActionMsg(engineFollowUpMessage(refreshed));
          return;
        }
        setActionMsg(messageForApiAction(action, json));
        await load();
        router.refresh();
        emitTenderWorkflowSync({ tenderId, source: "recovery-command-center" });
        if (action === "RESOLVE_EXPORT_BLOCKERS" || action === "EXPORT_READINESS") {
          document.getElementById("export-readiness")?.scrollIntoView({ behavior: "smooth" });
        }
        return;
      }

      setActionMsg("Action not available yet — open the relevant panel manually.");
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActioning(false);
      setAnalyzeProgress(null);
    }
  }

  // Per spec rule 8: Engine success message must include the true next
  // action after refreshing lifecycle. The orchestrator may now report
  // EVIDENCE_MATCHING_UNCONFIRMED (→ LINK_VAULT_EVIDENCE),
  // EVIDENCE_MATCHING_EMPTY (→ REVIEW_MATCHING_INPUTS),
  // DOCUMENT_GENERATION_REQUIRED (→ GENERATE_REQUIRED_DOCUMENTS), or
  // stay on RUN_ENGINE only if matching truly never ran. This helper
  // turns the refreshed lifecycle into a honest follow-up string.
  function engineFollowUpMessage(lc: LifecycleResult | null): string {
    if (!lc) return "Engine ran. Review the lifecycle panel below for the next step.";
    const next = ACTION_LABELS[lc.primaryNextAction] ?? lc.primaryNextAction;
    if (lc.primaryNextAction === "LINK_VAULT_EVIDENCE") {
      return `Engine completed. Evidence is still not confirmed — ${lc.evidenceStatus.fullyCoveredMandatory ?? 0}/${lc.evidenceStatus.totalMandatory ?? 0} mandatory requirements covered by FULL/SUBSTANTIAL evidence. Next: ${next}.`;
    }
    if (lc.primaryNextAction === "REVIEW_MATCHING_INPUTS") {
      return "Engine completed but produced no matching rows. Review vault experts/projects and re-run Engine. Next: Review matching inputs.";
    }
    if (lc.primaryNextAction === "GENERATE_REQUIRED_DOCUMENTS") {
      return `Engine completed. ${lc.counts.plannedMissingDocs} required document(s) still need generation. Next: ${next}.`;
    }
    if (lc.primaryNextAction === "RUN_ENGINE") {
      return "Engine completed. Matching has not yet run — re-run Engine to create requirement-evidence links.";
    }
    if (lc.primaryNextAction === "AUTO_FINALIZE") {
      return `Engine completed. Documents are ready to finalize. Next: ${next}.`;
    }
    if (lc.primaryNextAction === "DOWNLOAD_FINAL_ZIP") {
      return "Engine completed. All readiness gates passed — Download ZIP is available.";
    }
    return `Engine completed. Next: ${next}.`;
  }

  const load = useCallback(async (): Promise<LifecycleResult | null> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/lifecycle`);
      const json = await res.json();
      // BUG FIX: Previously `!json.ok` was included in the throw predicate.
      // The lifecycle route sets `ok: true` for transport success and uses
      // `status` (READY/PARTIAL/BLOCKED) for readiness. A BLOCKED tender
      // is NOT a transport error — it is a valid payload that the panel
      // must render as a blocked state. Only throw on HTTP non-2xx.
      if (!res.ok) throw new Error("Failed to load lifecycle state");
      const result = json as LifecycleResult;
      setData(result);
      return result;
    } catch {
      setError("Failed to load lifecycle state. Refresh to retry.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [tenderId]);

  useEffect(() => { void load(); }, [load]);

  // Subscribe to cross-panel workflow sync events so this panel refreshes
  // when any other panel takes an action (e.g., workflow center runs AI Analyze).
  // Also emit after our own actions so other panels refresh.
  useEffect(() => {
    return subscribeTenderWorkflowSync(tenderId, () => { void load(); });
  }, [tenderId, load]);

  // Poll every 15s when tab is visible for background job completion
  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) void load();
    }, 15_000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          Loading tender lifecycle…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">{error ?? "Unable to compute lifecycle state."}</p>
        <button onClick={load} className="mt-2 text-xs text-red-600 underline">Retry</button>
      </div>
    );
  }

  const stateLabel = STATE_LABELS[data.lifecycleState] ?? data.lifecycleState;
  const actionLabel = ACTION_LABELS[data.primaryNextAction] ?? data.primaryNextAction;
  // Per spec rule 5: Recovery Command Center must never display an action
  // that contradicts its own blockers. When final is BLOCKED, suppress any
  // "All good" / release-ready framing in the header — show the BLOCKED
  // badge prominently and treat the lifecycle state as secondary context.
  const isBlocked = data.finalSubmissionStatus === "BLOCKED";

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 border-b border-gray-100 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-800">Recovery Command Center</span>
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${stateColor(data.lifecycleState, data.finalSubmissionStatus)}`} title={isBlocked ? "Lifecycle context (secondary) — final submission is BLOCKED" : undefined}>
            {stateLabel}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${submissionBadge(data.finalSubmissionStatus)}`}>
            {data.finalSubmissionStatus}
          </span>
          {isBlocked && data.diagnosticId && (
            <span className="max-w-full break-all rounded-full bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-500" title="Quote this ID in support requests">
              {data.diagnosticId}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
            aria-label="Refresh lifecycle state"
          >
            <RefreshIcon /> Refresh
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
            aria-label={expanded ? "Collapse details" : "Expand details"}
          >
            <ChevronDownIcon className={`transition-transform ${expanded ? "rotate-180" : ""}`} /> {expanded ? "Collapse" : "Details"}
          </button>
        </div>
      </div>

      {/* Recovery Command Center computes its own verdict via a separate
          orchestrator (tender-lifecycle-orchestrator.ts) rather than the
          shared release snapshot the other readiness panels compare
          against — this additive badge makes any resulting disagreement
          visible instead of leaving it silent. */}
      <div className="px-5 pt-3">
        <SnapshotConsistencyBadge
          tenderId={tenderId}
          verdict="finalZip"
          localEligible={data.finalSubmissionStatus === "READY"}
          localLabel="Recovery Command Center"
        />
      </div>

      {/* Primary Next Action */}
      <div className="border-b border-gray-100 bg-blue-50 px-5 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-blue-600">Primary Next Action</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-blue-900">{actionLabel}</p>
          {data.primaryNextAction !== "DOWNLOAD_FINAL_ZIP" && (canMutate && !isMutationAction(data.primaryNextAction) ? (
            <button
              onClick={() => void executeAction(data.primaryNextAction)}
              disabled={actioning}
              title={`Execute: ${actionLabel}`}
              className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <PlayIcon /> {actioning ? "Working…" : "Execute"}
            </button>
          ) : canMutate && isMutationAction(data.primaryNextAction) ? (
            <button
              onClick={() => void executeAction(data.primaryNextAction)}
              disabled={actioning}
              title={`Execute: ${actionLabel}`}
              className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <PlayIcon /> {actioning ? "Working…" : "Execute"}
            </button>
          ) : null)}
          {data.primaryNextAction === "DOWNLOAD_FINAL_ZIP" && (
            <a href={`/api/tenders/${tenderId}/download`} className="inline-flex items-center gap-1 rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700" title="Download the final submission ZIP">
              <DownloadIcon /> Download ZIP
            </a>
          )}
        </div>
        {analyzeProgress !== null && (
          <div className="mt-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
              <div className="h-full rounded-full bg-blue-600 transition-all duration-500" style={{ width: `${analyzeProgress}%` }} />
            </div>
          </div>
        )}
        {canMutate && data.primaryNextAction === "APPROVE_FALLBACK_WITH_NOTE" && (
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={approvalNote}
              onChange={(e) => setApprovalNote(e.target.value)}
              placeholder="Approval note (required)…"
              className="flex-1 rounded border border-blue-200 bg-white px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400"
              maxLength={200}
            />
          </div>
        )}
        {actionMsg && (
          <p className="mt-2 text-xs text-blue-700 font-medium">{actionMsg}</p>
        )}
      </div>

      {/* Blockers */}
      {data.blockers.length > 0 && (
        <div className="border-b border-gray-100 px-5 py-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-red-600">
            Blockers ({data.blockers.length})
          </p>
          <ul className="space-y-1.5">
            {data.blockers.map((b) => (
              <li key={b.code} className="rounded border border-red-200 bg-red-50 px-3 py-1.5">
                <p className="text-xs font-medium text-red-800">{b.message}</p>
                <p className="mt-0.5 text-xs text-red-600">Action: {b.nextAction}</p>
                {/* Quick-action shortcuts for specific blocker codes */}
                {/* METADATA_INCOMPLETE quick-actions removed — metadata is advisory only */}
                {canMutate && b.code === "ANALYSIS_REGEX_FALLBACK_UNAPPROVED" && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <button onClick={() => void executeAction("RETRY_AI_ANALYZE")} disabled={actioning} className="inline-flex items-center gap-1 rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60" title="Retry AI Analyze with all available providers"><RefreshIcon /> Retry AI Analyze</button>
                  </div>
                )}
                {canMutate && b.code === "ANALYSIS_PARTIAL_NEEDS_RESUME" && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <button onClick={() => void executeAction("RESUME_AI_ANALYZE")} disabled={actioning} className="inline-flex items-center gap-1 rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60" title="Resume the partial AI Analyze job from where it left off"><PlayIcon /> Resume AI Analyze</button>
                  </div>
                )}
                {canMutate && b.code === "EVIDENCE_NOT_ASSESSED" && (
                  <div className="mt-1.5">
                    <button onClick={() => void executeAction("RUN_ENGINE")} disabled={actioning} className="inline-flex items-center gap-1 rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60" title="Run Engine to create requirement-evidence links"><PlayIcon /> Run Engine</button>
                  </div>
                )}
                {canMutate && b.code === "ENGINE_RAN_NO_MATCHES" && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <button onClick={() => void executeAction("REVIEW_MATCHING_INPUTS")} disabled={actioning} className="inline-flex items-center gap-1 rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60" title="Review vault experts/projects and compliance records"><WarningIcon /> Review Matching Inputs</button>
                  </div>
                )}
                {canMutate && b.code === "MANDATORY_EVIDENCE_WEAK" && (
                  <div className="mt-1.5">
                    <button onClick={() => void executeAction("LINK_VAULT_EVIDENCE")} disabled={actioning} className="inline-flex items-center gap-1 rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60" title="Link vault evidence to strengthen mandatory coverage"><CheckIcon /> Link Vault Evidence</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Blocked Actions */}
      {data.blockedActions.length > 0 && (
        <div className="border-b border-gray-100 px-5 py-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-amber-800">
            Blocked Actions ({data.blockedActions.length})
          </p>
          <ul className="space-y-1">
            {data.blockedActions.map((b) => (
              <li key={b.action} className="flex items-start gap-1.5 text-xs text-gray-700">
                <BanIcon className="mt-0.5 shrink-0 text-amber-500" />
                <span>
                  <span className="font-medium">{ACTION_LABELS[b.action] ?? b.action}</span>
                  {" — "}
                  {b.reason}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Document count summary — always visible.
          Per spec rule 5 & 7: when final status is BLOCKED, never display
          "all good" / release-ready language. The "Export Ready" counter
          only turns green when final status is READY — otherwise it stays
          neutral so the user is not misled into thinking the count of
          final export candidates equals "ready to download". */}
      <div className="grid grid-cols-4 gap-px border-b border-gray-100 bg-gray-100 text-center text-xs">
        {[
          { label: "Required", value: data.counts.requiredPlanRows },
          { label: "Generated", value: data.counts.generatedNarrativeDocs },
          { label: "Missing", value: data.counts.plannedMissingDocs, danger: data.counts.plannedMissingDocs > 0 },
          { label: "Export Ready", value: data.counts.finalExportCandidates, good: data.counts.finalExportCandidates > 0 && data.finalSubmissionStatus === "READY" },
        ].map((cell) => (
          <div key={cell.label} className="bg-white py-2">
            <div className={`text-base font-bold ${cell.danger ? "text-red-600" : cell.good ? "text-green-700" : "text-gray-800"}`}>
              {cell.value}
            </div>
            <div className="text-gray-500">{cell.label}</div>
          </div>
        ))}
      </div>
      {/* BLOCKED notice: shown when final status is BLOCKED, replacing any
          implicit "all good" interpretation of the counters above. Per spec
          rule 7, this is the primary headline — the lifecycle badge above
          becomes secondary context. */}
      {isBlocked && (
        <div className="border-b border-red-200 bg-red-50 px-5 py-2 text-xs font-medium text-red-800">
          Final submission is BLOCKED — review the blockers above before proceeding. The lifecycle badge is secondary context, not release approval.
        </div>
      )}
      {/* Plan-not-built notice: shown when all counters are 0 and no submission plan exists */}
      {data.counts.requiredPlanRows === 0
        && data.counts.generatedNarrativeDocs === 0
        && data.counts.finalExportCandidates === 0
        && !data.planStatus.hasExplicitPlan && (
        <div className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-800">
          Plan not built — build the submission plan first.
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="divide-y divide-gray-100">
          {/* Warnings */}
          {data.warnings.length > 0 && (
            <div className="px-5 py-3">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-amber-800">
                Warnings ({data.warnings.length})
              </p>
              <ul className="space-y-1">
                {data.warnings.map((w) => (
                  <li key={w.code} className="flex items-start gap-1.5 text-xs text-amber-800"><WarningIcon className="mt-0.5 shrink-0" /> {w.message}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Advisory warnings */}
          {data.advisoryWarnings.length > 0 && (
            <div className="px-5 py-3">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                Advisory ({data.advisoryWarnings.length}) — do not block export
              </p>
              <ul className="space-y-1">
                {data.advisoryWarnings.map((w) => (
                  <li key={w.code} className="text-xs text-gray-600"><InfoIcon className="inline h-3 w-3" /> {w.message}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Status grid */}
          <div className="px-5 py-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Status Summary</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              <StatusRow label="Providers" value={`${data.providerStatus.totalHealthy}/${data.providerStatus.totalConfigured} healthy`} ok={data.providerStatus.totalHealthy > 0} />
              <StatusRow
                label="Analysis"
                value={
                  data.analysisStatus.stale
                    ? "STALE — re-run required"
                    : data.analysisStatus.canonicalState === "PARTIAL_NEEDS_RESUME" || data.analysisStatus.partial
                      ? "PARTIAL — resume required"
                      : data.analysisStatus.source.replace(/_/g, " ")
                }
                ok={data.analysisStatus.source === "AI" && !data.analysisStatus.stale && !data.analysisStatus.partial && data.analysisStatus.canonicalState !== "PARTIAL_NEEDS_RESUME"}
              />
               {/* Tender Details status row removed — tender facts are advisory only */}
              <StatusRow
                label="Source Refs"
                value={data.sourceReferenceStatus.totalMandatoryCount > 0
                  ? `${data.sourceReferenceStatus.totalMandatoryCount - data.sourceReferenceStatus.ungroundedMandatoryCount}/${data.sourceReferenceStatus.totalMandatoryCount} grounded`
                  : "No mandatory reqs"}
                ok={data.sourceReferenceStatus.ungroundedMandatoryCount === 0}
              />
              <StatusRow
                label="Evidence"
                value={data.evidenceStatus.totalMandatory > 0
                  ? `${data.evidenceStatus.fullyCoveredMandatory ?? 0}/${data.evidenceStatus.totalMandatory} covered${data.evidenceStatus.engineHasRun ? "" : " (engine not run)"}`
                  : "No mandatory reqs"}
                ok={(data.evidenceStatus.coverageRatio ?? 0) > 0.7}
              />
              <StatusRow
                label="Official Originals"
                value={`${data.officialOriginalStatus.attached}/${data.officialOriginalStatus.required} attached`}
                ok={data.officialOriginalStatus.required === 0 || data.officialOriginalStatus.attached >= data.officialOriginalStatus.required}
              />
              <StatusRow label="Outside Plan" value={`${data.counts.outsidePlanRows} docs`} ok={data.counts.outsidePlanRows === 0} />
              <StatusRow label="Quality Failed" value={`${data.counts.qualityFailedCandidates} docs`} ok={data.counts.qualityFailedCandidates === 0} />
            </div>
          </div>

          {/* Envelope breakdown */}
          {data.planStatus.totalRequired > 0 && (
            <div className="px-5 py-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Envelope Breakdown</p>
              <div className="flex gap-4 text-xs">
                {(["TECHNICAL", "FINANCIAL", "ADMIN"] as const).map((env) => (
                  <div key={env} className="text-center">
                    <div className="text-base font-bold text-gray-800">{data.counts.envelopes[env]}</div>
                    <div className="text-gray-500">{env}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Allowed actions */}
          {(canMutate ? data.allowedActions : data.allowedActions.filter((a) => !isMutationAction(a))).length > 0 && (
            <div className="px-5 py-3">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                Allowed Actions ({canMutate ? data.allowedActions.length : data.allowedActions.filter((a) => !isMutationAction(a)).length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(canMutate ? data.allowedActions : data.allowedActions.filter((a) => !isMutationAction(a))).map((a) => (
                  <span key={a} className="inline-flex items-center gap-1 rounded border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-800">
                    <CheckIcon /> {ACTION_LABELS[a] ?? a}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusRow({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-600">{label}</span>
      <span className={`inline-flex items-center gap-1 font-medium ${ok ? "text-green-700" : "text-red-600"}`}>
        {ok ? <CheckIcon /> : <CrossIcon />} {value}
      </span>
    </div>
  );
}
