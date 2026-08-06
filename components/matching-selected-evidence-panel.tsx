"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, WarningIcon, BoltIcon } from "./icons";

export type SelectedEvidenceCandidate = {
  id: string;
  name: string;
  subtitle: string | null;
  score: number;
  rationale: string | null;
  isSelected: boolean;
  trustLevel: string;
};

const ELIGIBLE_EVIDENCE_TRUST_LEVELS = new Set(["SOURCE_VERIFIED", "REVIEWED"]);

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
  analysisComplete = false,
  engineRunning = false,
  engineComplete = false,
}: {
  tenderId: string;
  experts: SelectedEvidenceCandidate[];
  projects: SelectedEvidenceCandidate[];
  sectionId?: string;
  canMutate?: boolean;
  analysisComplete?: boolean;
  engineRunning?: boolean;
  engineComplete?: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // A stale selected flag must never make draft, tampered, or otherwise
  // unpromoted Company Vault data visible as selected evidence. Matching uses
  // the same fail-closed trust boundary as the Engine eligibility gate.
  const eligibleExperts = experts.filter(isEligibleSelectedEvidence);
  const eligibleProjects = projects.filter(isEligibleSelectedEvidence);
  const selectedExperts = eligibleExperts.filter((row) => row.isSelected);
  const selectedProjects = eligibleProjects.filter((row) => row.isSelected);
  const candidates = [...eligibleExperts, ...eligibleProjects].filter((row) => !row.isSelected);
  const hasSelection = selectedExperts.length + selectedProjects.length > 0;

  // Run Engine button is visible when:
  // - AI Analyze completed successfully
  // - the user has the required role
  // - no duplicate Engine job is queued or running
  const canRunEngine = canMutate && analysisComplete && !engineRunning && !engineComplete && !submitting;

  const disabledReason = !canMutate
    ? "You do not have permission to run Engine."
    : !analysisComplete
      ? "Run AI Analyze first."
      : engineRunning
        ? "An Engine job is already running."
        : engineComplete
          ? "Engine already completed successfully for this revision."
          : null;

  const runEngine = useCallback(async () => {
    if (submitting || engineRunning) return;
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
        return;
      }
      // Job queued successfully — the durable worker will process it.
      // The UI will poll for status via the job-watching effect.
      router.refresh();
    } catch {
      setError("Network error. The Engine job may still have been created — reload to check status.");
    } finally {
      setSubmitting(false);
    }
  }, [submitting, engineRunning, tenderId, router]);

  const statusLabel = engineComplete
    ? "Engine complete. Downstream processing continues automatically."
    : engineRunning
      ? "Engine is running."
      : !analysisComplete
        ? "Run AI Analyze first to enable Engine."
        : hasSelection
          ? "AI Analyze complete. Run Engine to continue."
          : "AI Analyze complete. Run Engine to start matching.";

  return (
    <section id={sectionId} className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Canonical persisted selection</p>
        <h2 className="mt-1 text-lg font-bold text-slate-900">Matching and Selected Evidence</h2>
        <p className="mt-1 text-sm text-slate-600">{statusLabel}</p>
      </div>

      {/* Run Engine button — visible when eligible */}
      {canMutate && !engineComplete && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => void runEngine()}
            disabled={!canRunEngine}
            aria-disabled={!canRunEngine}
            aria-busy={submitting || engineRunning}
            title={disabledReason ?? "Run Engine"}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              canRunEngine
                ? "bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                : "cursor-not-allowed bg-slate-300 text-slate-500"
            }`}
          >
            <BoltIcon />
            {submitting ? "Starting…" : engineRunning ? "Engine running…" : "Run Engine"}
          </button>
          {disabledReason && !canRunEngine && (
            <p className="mt-2 text-xs text-slate-500" role="note">{disabledReason}</p>
          )}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">Engine did not start</p>
          <p className="mt-1 text-red-700">{error}</p>
          {canMutate && analysisComplete && !engineRunning && (
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
          <span>No evidence selected yet. Run Engine to start matching.</span>
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
