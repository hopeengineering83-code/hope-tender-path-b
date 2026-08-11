"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, WarningIcon, BoltIcon } from "./icons";
import {
  type CanonicalDownstreamPresentationState,
  describeEngineActivity,
  describeMatchingEngineState,
} from "../lib/engine/workflow-panel-presentation";

export { describeEngineActivity, describeMatchingEngineState } from "../lib/engine/workflow-panel-presentation";

export type SelectedEvidenceCandidate = {
  id: string;
  name: string;
  subtitle: string | null;
  score: number;
  rationale: string | null;
  isSelected: boolean;
  trustLevel: string;
};

type EngineReadiness = {
  analysisCurrent: boolean;
  analysisBlocker: string | null;
  sourceRevision: string | null;
  engineRunning: boolean;
  engineComplete: boolean;
  engineFailed: boolean;
  canRunEngine: boolean;
  blocker: string | null;
  activeJob: { id: string; status: string; createdAt: string } | null;
  latestJob: {
    id: string;
    status: string;
    errorMessage: string | null;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
  } | null;
};

type Props = {
  tenderId: string;
  experts: SelectedEvidenceCandidate[];
  projects: SelectedEvidenceCandidate[];
  sectionId?: string;
  canMutate?: boolean;
  /** Legacy server hints retained for call-site compatibility only. */
  analysisComplete?: boolean;
  engineRunning?: boolean;
  engineComplete?: boolean;
};

const ELIGIBLE_EVIDENCE_TRUST_LEVELS = new Set(["SOURCE_VERIFIED", "REVIEWED"]);
const POLL_INTERVAL_MS = 3_000;

/**
 * How long a QUEUED Engine job may wait before the wait itself is the story.
 *
 * The queue's only unattended driver is the GitHub Actions cron on a 5-minute
 * schedule, whose own documentation notes 5–15 minutes of drift. Past that, a
 * job that no worker has claimed is not "slow" — nothing is running it.
 */
export function isEligibleSelectedEvidence(row: SelectedEvidenceCandidate): boolean {
  return ELIGIBLE_EVIDENCE_TRUST_LEVELS.has(row.trustLevel);
}

function EvidenceList({ title, rows }: { title: string; rows: SelectedEvidenceCandidate[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">No evidence selected yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{row.name}</p>
                  {row.subtitle && <p className="text-xs text-slate-600">{row.subtitle}</p>}
                </div>
                <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">
                  Linked · {Math.round(row.score * 100)}%
                </span>
              </div>
              {row.rationale && <p className="mt-2 text-xs text-slate-600">{row.rationale}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MatchingSelectedEvidencePanel({
  tenderId,
  experts,
  projects,
  sectionId = "matching-selected-evidence",
  canMutate = false,
}: Props) {
  const router = useRouter();
  const deletedRef = useRef(false);
  const wasRunningRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [readiness, setReadiness] = useState<EngineReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(true);
  const [readinessError, setReadinessError] = useState("");
  const [downstream, setDownstream] = useState<CanonicalDownstreamPresentationState | null>(null);
  const [downstreamLoading, setDownstreamLoading] = useState(true);
  const [downstreamError, setDownstreamError] = useState("");

  // A stale selected flag must never make draft, tampered, or otherwise
  // unpromoted Company Vault data visible as selected evidence. Matching uses
  // the same fail-closed trust boundary as the Engine eligibility gate.
  const eligibleExperts = experts.filter(isEligibleSelectedEvidence);
  const eligibleProjects = projects.filter(isEligibleSelectedEvidence);
  const selectedExperts = eligibleExperts.filter((row) => row.isSelected);
  const selectedProjects = eligibleProjects.filter((row) => row.isSelected);
  const candidates = [...eligibleExperts, ...eligibleProjects].filter((row) => !row.isSelected);
  const hasSelection = selectedExperts.length + selectedProjects.length > 0;

  const loadReadiness = useCallback(async () => {
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

      const next: EngineReadiness = {
        analysisCurrent: Boolean(body.analysisCurrent),
        analysisBlocker: body.analysisBlocker ? String(body.analysisBlocker) : null,
        sourceRevision: body.sourceRevision ? String(body.sourceRevision) : null,
        engineRunning: Boolean(body.engineRunning),
        engineComplete: Boolean(body.engineComplete),
        engineFailed: Boolean(body.engineFailed),
        canRunEngine: Boolean(body.canRunEngine),
        blocker: body.blocker ? String(body.blocker) : null,
        activeJob: body.activeJob ?? null,
        latestJob: body.latestJob ?? null,
      };

      const justFinished = wasRunningRef.current && !next.engineRunning;
      wasRunningRef.current = next.engineRunning;
      setReadiness(next);
      setReadinessError("");
      if (justFinished) router.refresh();
    } catch (reason) {
      setReadiness(null);
      setReadinessError(reason instanceof Error ? reason.message : "Unable to verify Engine readiness.");
    } finally {
      setReadinessLoading(false);
    }
  }, [router, tenderId]);

  const loadDownstreamWorkflow = useCallback(async () => {
    if (deletedRef.current) return;
    try {
      const response = await fetch(`/api/tenders/${tenderId}/workflow-center`, { cache: "no-store" });
      if (response.status === 404 || response.status === 410) {
        deletedRef.current = true;
        return;
      }
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok || !body?.decision) {
        throw new Error(body?.error || `Canonical workflow check failed (HTTP ${response.status}).`);
      }
      setDownstream({
        nextRequiredAction: String(body.decision.nextRequiredAction ?? ""),
        nextRequiredActionLabel: String(body.decision.nextRequiredActionLabel ?? ""),
        nextRequiredActionReason: String(body.decision.nextRequiredActionReason ?? ""),
        currentBlockingStage: String(body.decision.currentBlockingStage ?? ""),
        downstreamSuppressedBy: body.decision.downstreamSuppressedBy
          ? String(body.decision.downstreamSuppressedBy)
          : null,
        finalExportAllowed: Boolean(body.decision.finalExportAllowed),
        activeJob: body.downstreamActivity
          && ["QUEUED", "RUNNING"].includes(String(body.downstreamActivity.status))
          ? {
              jobType: String(body.downstreamActivity.jobType),
              status: String(body.downstreamActivity.status) as "QUEUED" | "RUNNING",
            }
          : null,
      });
      setDownstreamError("");
    } catch (reason) {
      setDownstream(null);
      setDownstreamError(reason instanceof Error ? reason.message : "Unable to verify canonical downstream workflow state.");
    } finally {
      setDownstreamLoading(false);
    }
  }, [tenderId]);

  useEffect(() => {
    void loadReadiness();
    void loadDownstreamWorkflow();
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
  }, [loadDownstreamWorkflow, loadReadiness, tenderId]);

  useEffect(() => {
    if (!readiness?.engineRunning || deletedRef.current) return;
    const timer = window.setInterval(() => void loadReadiness(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadReadiness, readiness?.engineRunning]);

  useEffect(() => {
    if (!readiness?.engineComplete || deletedRef.current) return;
    const timer = window.setInterval(() => void loadDownstreamWorkflow(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadDownstreamWorkflow, readiness?.engineComplete]);

  const analysisCurrent = readiness?.analysisCurrent === true;
  const engineRunning = readiness?.engineRunning === true;
  const engineComplete = readiness?.engineComplete === true;

  // The button is fail-closed until the canonical endpoint confirms that the
  // promoted AI Analyze result and Engine source revision are both current.
  const canRunEngine = canMutate
    && readiness?.canRunEngine === true
    && !submitting
    && !readinessLoading
    && !readinessError;

  const disabledReason = !canMutate
    ? "You do not have permission to run Engine."
    : readinessLoading
      ? "Checking the current analysis and Engine source revision."
      : readinessError
        ? readinessError
        : !analysisCurrent
          ? readiness?.analysisBlocker ?? readiness?.blocker ?? "Run AI Analyze successfully for the current source revision."
          : engineRunning
            ? readiness?.activeJob?.status === "QUEUED"
              ? "An Engine job is already queued for this revision."
              : "An Engine job is already running for this revision."
            : readiness?.blocker;

  const runEngine = useCallback(async () => {
    if (!canRunEngine || deletedRef.current) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/tenders/${tenderId}/engine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error || `Engine could not start (HTTP ${response.status}).`);
        await loadReadiness();
        return;
      }

      wasRunningRef.current = true;
      setReadiness((current) => current
        ? {
            ...current,
            engineRunning: true,
            engineComplete: false,
            engineFailed: false,
            canRunEngine: false,
            blocker: null,
            activeJob: body?.jobId
              ? { id: String(body.jobId), status: String(body.status ?? "QUEUED"), createdAt: new Date().toISOString() }
              : current.activeJob,
          }
        : current);
      await loadReadiness();
      router.refresh();
    } catch {
      setError("Network error. The Engine job may still have been created — reload to check status.");
      await loadReadiness();
    } finally {
      setSubmitting(false);
    }
  }, [canRunEngine, loadReadiness, router, tenderId]);

  const statusLabel = readinessLoading
    ? "Checking the current analysis and Engine revision."
      : readinessError
      ? "Engine readiness could not be verified. Run Engine remains disabled."
      : readiness
        ? describeMatchingEngineState(
            readiness,
            hasSelection,
            readiness.engineComplete && (downstreamLoading || downstreamError) ? null : downstream,
          )
        : "Engine readiness could not be verified. Run Engine remains disabled.";

  return (
    <section id={sectionId} className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Canonical persisted selection</p>
        <h2 className="mt-1 text-lg font-bold text-slate-900">Matching and Selected Evidence</h2>
        <p className="mt-1 text-sm text-slate-600">{statusLabel}</p>
      </div>

      {/* Run Engine is one of exactly two actions the contract reserves to the
          owner, so it is always rendered for anyone entitled to press it. It
          used to disappear once the Engine had completed, which read as the app
          having removed the control rather than as the run being finished — and
          left no way to re-run after uploading more Company Vault evidence,
          which is the single most common reason to want one. When a run is
          already queued or running the button stays visible and disabled, with
          the reason underneath, rather than vanishing. */}
      {canMutate && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => void runEngine()}
            disabled={!canRunEngine}
            aria-disabled={!canRunEngine}
            aria-busy={submitting || engineRunning || readinessLoading}
            title={disabledReason ?? (engineComplete ? "Re-run Engine" : "Run Engine")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              canRunEngine
                ? "bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                : "cursor-not-allowed bg-slate-300 text-slate-500"
            }`}
          >
            <BoltIcon />
            {submitting
              ? "Starting…"
              : engineRunning
                ? "Engine running…"
                : engineComplete
                  ? "Re-run Engine"
                  : "Run Engine"}
          </button>
          {disabledReason && !canRunEngine && (
            <p className="mt-2 text-xs text-slate-500" role="note">{disabledReason}</p>
          )}
          {engineComplete && canRunEngine && (
            <p className="mt-2 text-xs text-slate-500" role="note">
              Engine already completed for this source revision. Re-running matches again against the
              Company Vault as it stands now, which is what you want after adding or verifying evidence.
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">Engine did not start</p>
          <p className="mt-1 text-red-700">{error}</p>
          {canRunEngine && (
            <button
              type="button"
              onClick={() => void runEngine()}
              disabled={submitting}
              className="mt-3 rounded-lg border border-blue-300 bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting ? "Starting…" : "Retry Engine"}
            </button>
          )}
        </div>
      )}

      {!hasSelection && !engineRunning && !engineComplete && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <WarningIcon className="mt-0.5 shrink-0" />
          <span>{analysisCurrent ? "No evidence selected yet. Run Engine to start matching." : "No evidence selected yet. Complete AI Analyze before running Engine."}</span>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <EvidenceList title={`Selected experts (${selectedExperts.length})`} rows={selectedExperts} />
        <EvidenceList title={`Selected projects (${selectedProjects.length})`} rows={selectedProjects} />
      </div>

      <details className="group mt-4 rounded-xl border border-slate-200 bg-slate-50">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:content-none">
          <span className="text-sm font-semibold text-slate-800">Candidates and matching diagnostics ({candidates.length})</span>
          <ChevronDownIcon className="shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-slate-200 p-4">
          {candidates.length === 0 ? (
            <p className="text-sm text-slate-600">No additional eligible candidates.</p>
          ) : (
            <ul className="space-y-2">
              {candidates.map((row) => (
                <li key={row.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium text-slate-900">{row.name}</span>
                    <span className="text-slate-600">{Math.round(row.score * 100)}% fit</span>
                  </div>
                  {row.rationale && <p className="mt-1 text-xs text-slate-600">{row.rationale}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </section>
  );
}
