// The single Build Plan panel.
//
// Answers "where are the missing 13 of 19 docs?" with one row per planned
// file, its status badge, and the recommended next action — and owns the
// three plan mutations (build, generate missing, reconcile stale).
//
// It used to share the page with submission-plan-reconciliation-panel.tsx,
// which re-derived required/generated/missing itself from
// findMissingGeneratedDocuments instead of the canonical
// /api/tenders/[id]/submission-plan resolver. That helper counts any
// non-SUPERSEDED row as satisfying its plan file, while the resolver first
// asks isFinalExportCandidateDocument. So a document marked NOT_EXPORTABLE —
// by the row action in THIS panel — showed as "1/1 · plan is reconciled"
// there and "Current outputs 0 · REPLACE WITH ORIGINAL" here, on the same
// screen. One panel now reads one resolver, so the two cannot disagree.

"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircleIcon, WarningIcon, ClockIcon, BanIcon, FolderIcon } from "./icons";
import { BuildSubmissionPlanButton } from "./build-submission-plan-button";
import { ReconcileStaleFilesButton } from "./reconcile-stale-files-button";
import { subscribeTenderWorkflowSync } from "../lib/ui/tender-workflow-sync";

type Status =
  | "GENERATED"
  | "GENERATED_NEEDS_REVIEW"
  | "GENERATED_QUALITY_FAILED"
  | "PLANNED"
  | "MISSING_TENDER_SOURCE_FORM"
  | "MISSING"
  | "OUTSIDE_PLAN"
  | "SUPERSEDED";

type Row = {
  key: string;
  exactFileName: string | null;
  documentId: string | null;
  name: string;
  documentType: string | null;
  format: string | null;
  envelope: "TECHNICAL" | "FINANCIAL" | "ADMIN";
  required: boolean;
  exactOrder: number | null;
  status: Status;
  generationStatus: string | null;
  validationStatus: string | null;
  reviewStatus: string | null;
  hasFileContent: boolean;
  hasStoragePath: boolean;
  officialOriginal: boolean;
  recommendedAction: string;
};

type PlanState = "CONFIRMED_BUILD_PLAN" | "EXPLICIT_TENDER_PLAN" | "DERIVED_DRAFT_UNCONFIRMED" | "PLAN_NOT_BUILT" | "REQUIREMENTS_FOUND_PLAN_NOT_BUILT" | "NO_REQUIREMENTS";

type Summary = {
  totalRequired: number;
  totalGenerated: number;
  totalMissing: number;
  totalOfficialOriginalsRequired: number;
  totalOutsidePlan: number;
  totalSuperseded: number;
  totalQualityFailed: number;
  envelopeBreakdown: { TECHNICAL: number; FINANCIAL: number; ADMIN: number };
  requirementCount: number;
  hasExplicitScope: boolean;
  planState: PlanState;
  requiresUserConfirmation: boolean;
  // !confirmedPlan.ok — the same condition the deleted reconciliation panel
  // used to decide whether to offer Build Plan.
  automaticPlanPending?: boolean;
  automaticPlanBlocker?: string | null;
};

type Response = {
  success: true;
  tender: { id: string; title: string };
  summary: Summary;
  rows: Row[];
  warnings: string[];
};

const STATUS_BADGE: Record<Status, { label: string; tone: "ok" | "warn" | "bad" | "neutral"; icon: React.ReactNode }> = {
  GENERATED: { label: "GENERATED", tone: "ok", icon: <CheckCircleIcon /> },
  GENERATED_NEEDS_REVIEW: { label: "REVIEW NEEDED", tone: "warn", icon: <WarningIcon /> },
  GENERATED_QUALITY_FAILED: { label: "QUALITY FAILED", tone: "bad", icon: <BanIcon /> },
  PLANNED: { label: "PLANNED", tone: "warn", icon: <ClockIcon /> },
  MISSING_TENDER_SOURCE_FORM: { label: "MISSING TENDER FORM", tone: "warn", icon: <WarningIcon /> },
  MISSING: { label: "MISSING", tone: "bad", icon: <BanIcon /> },
  OUTSIDE_PLAN: { label: "OUTSIDE PLAN", tone: "warn", icon: <WarningIcon /> },
  SUPERSEDED: { label: "HISTORICAL", tone: "neutral", icon: <FolderIcon /> },
};

function toneClass(tone: "ok" | "warn" | "bad" | "neutral"): string {
  if (tone === "ok") return "bg-emerald-100 text-emerald-700";
  if (tone === "warn") return "bg-amber-100 text-amber-800";
  if (tone === "bad") return "bg-red-100 text-red-700";
  return "bg-slate-100 text-slate-500";
}

function planStateLabel(state: PlanState): string {
  if (state === "CONFIRMED_BUILD_PLAN") return "Confirmed Build Plan";
  if (state === "EXPLICIT_TENDER_PLAN") return "Unconfirmed tender scope";
  if (state === "DERIVED_DRAFT_UNCONFIRMED") return "Unconfirmed derived scope";
  if (state === "PLAN_NOT_BUILT") return "No confirmed Build Plan";
  if (state === "REQUIREMENTS_FOUND_PLAN_NOT_BUILT") return "No confirmed Build Plan";
  return "No requirements yet";
}

function planStateTone(state: PlanState): "ok" | "warn" | "bad" | "neutral" {
  if (state === "CONFIRMED_BUILD_PLAN") return "ok";
  if (state === "EXPLICIT_TENDER_PLAN") return "warn";
  if (state === "PLAN_NOT_BUILT") return "bad";
  if (state === "REQUIREMENTS_FOUND_PLAN_NOT_BUILT") return "bad";
  if (state === "DERIVED_DRAFT_UNCONFIRMED") return "warn";
  return "neutral";
}

function RowActionButton({ label, busy, disabled, onClick }: { label: string; busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      title={disabled ? "Action unavailable — resolve blockers first" : label}
    >
      {busy ? "Working…" : label}
    </button>
  );
}

type PlanRowAction = "RECLASSIFY_TO_PLAN" | "MARK_NOT_EXPORTABLE" | "SUPERSEDE_DUPLICATE" | "EXCLUDE_OUTSIDE_PLAN";
const ACTION_NEEDS_NOTE: Record<PlanRowAction, boolean> = {
  RECLASSIFY_TO_PLAN: false,
  MARK_NOT_EXPORTABLE: true,
  SUPERSEDE_DUPLICATE: true,
  EXCLUDE_OUTSIDE_PLAN: true,
};

// Heuristic guidance for documents that are outside the current submission plan.
// Used by tests and by the panel's action menu labels.
export function suggestOutsidePlanResolution(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (/cover\s*letter|transmittal|covering|introduction letter/.test(lower)) {
    return "ADMIN — this appears to be a cover/transmittal letter. Route to administrative team.";
  }
  if (/\bcv\b|curriculum\s*vitae|resume|personnel|expert|staff/.test(lower)) {
    return "TECHNICAL — this appears to be an expert/personnel CV. Attach under team composition.";
  }
  if (/financial|price|commercial|budget|cost/.test(lower)) {
    return "FINANCIAL — route to financial section or create a Financial Proposal document.";
  }
  if (/internal|draft|wip|temp|backup|copy|~/.test(lower)) {
    return "EXCLUDE — this looks like an internal draft or working file; exclude from submission.";
  }
  return "Review this document and decide: reclassify to match a plan requirement, mark not exportable, or exclude.";
}

export function SubmissionPlanCompletenessPanel({ tenderId, canMutate = false }: { tenderId: string; canMutate?: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHistorical, setShowHistorical] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/submission-plan`, { method: "GET" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Submission plan lookup failed (${res.status})`);
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load submission plan");
    } finally {
      setLoading(false);
    }
  }, [tenderId]);

  async function runRowAction(documentId: string, action: PlanRowAction) {
    let note: string | undefined;
    if (ACTION_NEEDS_NOTE[action]) {
      const entered = window.prompt(`Add a short audit note for "${action.replace(/_/g, " ").toLowerCase()}":`);
      if (entered === null) return; // cancelled
      if (entered.trim().length === 0) { setActionMsg("An audit note is required for this action."); return; }
      note = entered.trim();
    }
    setBusyKey(`${documentId}:${action}`);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/documents/${documentId}/plan-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Action failed (${res.status})`);
      setActionMsg(`Done — ${json.detail ?? action}.`);
      await load();
      router.refresh();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyKey(null);
    }
  }

  // The three plan mutations below live inside this client panel, so
  // router.refresh() alone would leave these counts stale — the server tree
  // would update while this panel kept showing the pre-mutation numbers and
  // re-offered the action that just ran. Re-read on the same workflow-sync
  // event the mutations emit.
  useEffect(() => {
    void load();
    return subscribeTenderWorkflowSync(tenderId, () => { void load(); });
  }, [load, tenderId]);

  if (loading && !data) {
    return <section aria-busy="true" aria-label="Submission plan completeness" className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Loading submission plan completeness…</section>;
  }
  if (error || !data) {
    return <section className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">Could not load submission plan: {error ?? "no data"}</section>;
  }

  const visibleRows = showHistorical ? data.rows : data.rows.filter((r) => r.status !== "SUPERSEDED");
  const confirmed = data.summary.planState === "CONFIRMED_BUILD_PLAN" && !data.summary.requiresUserConfirmation;

  return (
    <section
      className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      id="submission-plan-completeness"
      aria-busy={loading || busyKey !== null}
      aria-label="Submission plan completeness"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {confirmed ? "Confirmed Build Plan completeness" : "Unconfirmed submission scope preview"}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {confirmed
              ? "One row per confirmed required file, with its current output status and next action."
              : "Preview only: these rows come from tender instructions or a conservative derivation. They do not authorize generation or export until the Build Plan is reviewed and confirmed."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* GenerateMissingPlanFilesButton removed — planned documents are generated automatically by the pipeline. */}
          {data.summary.totalSuperseded > 0 && (
            <label className="ml-2 inline-flex items-center gap-1 text-[11px] text-slate-500">
              <input type="checkbox" checked={showHistorical} onChange={(e) => setShowHistorical(e.target.checked)} />
              Show {data.summary.totalSuperseded} historical row(s)
            </label>
          )}
        </div>
      </div>

      {actionMsg && (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">{actionMsg}</p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4 md:grid-cols-7">
        <div className="rounded-xl bg-slate-50 px-2 py-2">
          <p className="text-slate-500">{confirmed ? "Confirmed required" : "Scope files"}</p>
          <p className="text-base font-bold text-slate-900">{data.summary.totalRequired}</p>
        </div>
        <div className="rounded-xl bg-emerald-50 px-2 py-2">
          <p className="text-slate-500">Current outputs</p>
          <p className="text-base font-bold text-emerald-700">{data.summary.totalGenerated}</p>
        </div>
        <div className="rounded-xl bg-red-50 px-2 py-2">
          <p className="text-slate-500">Missing</p>
          <p className={`text-base font-bold ${data.summary.totalMissing > 0 ? "text-red-700" : "text-emerald-700"}`}>{data.summary.totalMissing}</p>
        </div>
        <div className="rounded-xl bg-amber-50 px-2 py-2">
          <p className="text-slate-500">Originals</p>
          <p className="text-base font-bold text-amber-800">{data.summary.totalOfficialOriginalsRequired}</p>
        </div>
        <div className="rounded-xl bg-amber-50 px-2 py-2">
          <p className="text-slate-500">Outside plan</p>
          <p className={`text-base font-bold ${data.summary.totalOutsidePlan > 0 ? "text-amber-800" : "text-emerald-700"}`}>{data.summary.totalOutsidePlan}</p>
        </div>
        <div className="rounded-xl bg-red-50 px-2 py-2">
          <p className="text-slate-500">Quality failed</p>
          <p className={`text-base font-bold ${data.summary.totalQualityFailed > 0 ? "text-red-700" : "text-emerald-700"}`}>{data.summary.totalQualityFailed}</p>
        </div>
        <div className="rounded-xl bg-slate-50 px-2 py-2">
          <p className="text-slate-500">Envelopes</p>
          <p className="text-xs font-semibold text-slate-700">T:{data.summary.envelopeBreakdown.TECHNICAL} · F:{data.summary.envelopeBreakdown.FINANCIAL} · A:{data.summary.envelopeBreakdown.ADMIN}</p>
        </div>
      </div>

      {data.warnings.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <ul className="list-disc space-y-1 pl-5">
            {data.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      <div className={`mt-3 rounded-lg border p-3 text-xs ${(data.summary.planState === "PLAN_NOT_BUILT" || data.summary.planState === "REQUIREMENTS_FOUND_PLAN_NOT_BUILT") ? "border-red-200 bg-red-50 text-red-800" : data.summary.requiresUserConfirmation ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Authority:</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${toneClass(planStateTone(data.summary.planState))}`}>{planStateLabel(data.summary.planState)}</span>
          <span>Requirements: {data.summary.requirementCount}</span>
        </div>
        {data.summary.planState === "PLAN_NOT_BUILT" && (
          <p className="mt-2">Tender requirements exist, but no exact or derived submission file plan is available yet. <strong>Run Engine</strong> creates and source-verifies the Build Plan, so the system can validate generated outputs against tender scope instead of showing a misleading Required 0 / Generated 0 / Missing 0 state.</p>
        )}
        {data.summary.planState === "REQUIREMENTS_FOUND_PLAN_NOT_BUILT" && (
          <p className="mt-2">Tender requirements have been extracted, but the submission file plan has not been built yet. <strong>Run Engine</strong> derives the submission file list from the extracted requirements; generation follows automatically once it succeeds.</p>
        )}
        {data.summary.requiresUserConfirmation && (
          <p className="mt-2">
            {data.summary.planState === "EXPLICIT_TENDER_PLAN"
              ? "Tender-issued file scope is available, but it has not been bound into a current confirmed Build Plan. Build and confirm the plan before generation or export."
              : "This is a conservative derived draft from requirement titles/types, not a tender-issued file list. Confirm exact file names/order from the tender before final export; official forms/templates must still be attached as originals and must not be fabricated."}
          </p>
        )}
        {data.summary.planState === "DERIVED_DRAFT_UNCONFIRMED" && (
          <p className="mt-2 font-semibold">Submission plan is derived from weak extraction — verify all required documents against the original tender before finalising.</p>
        )}
        {/* Gap A: the sentence below used to read "Extraction and analysis run
            automatically". Extraction is automatic; AI Analyze is a manual
            gate, so the second half promised a step nothing would take. */}
        {data.summary.planState === "NO_REQUIREMENTS" && (
          <p className="mt-2">No tender requirements are extracted yet. Source extraction runs automatically. When it completes, run AI Analyze — requirements appear here once that finishes.</p>
        )}
        {data.summary.automaticPlanPending && (
          <div className="mt-3">
            <p className="mb-2">
              {data.summary.automaticPlanBlocker ?? "No current confirmed Build Plan."} Document counts and export eligibility stay unavailable until a Build Plan is rebuilt and source-verified.
            </p>
            {canMutate && <BuildSubmissionPlanButton tenderId={tenderId} />}
          </div>
        )}
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-xs">
          <thead>
            <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">File / row</th>
              <th className="px-2 py-2">Envelope</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Recommended action</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => {
              const badge = STATUS_BADGE[row.status];
              const canAct = canMutate && Boolean(row.documentId) && row.status !== "SUPERSEDED";
              const isOutsidePlan = row.status === "OUTSIDE_PLAN";
              return (
                <tr key={row.key} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-2 text-slate-400">{row.exactOrder ?? index + 1}</td>
                  <td className="px-2 py-2">
                    <div className="font-medium text-slate-900">{row.exactFileName ?? row.name}</div>
                    {row.exactFileName && row.exactFileName !== row.name && <div className="text-[10px] text-slate-400">{row.name}</div>}
                    {(row.documentType || row.format) && (
                      <div className="text-[10px] text-slate-400">{[row.documentType, row.format].filter(Boolean).join(" · ")}</div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-[10px] font-medium text-slate-600">{row.envelope}</td>
                  <td className="px-2 py-2">
                    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${toneClass(badge.tone)}`}>{badge.icon} {badge.label}</span>
                    {row.officialOriginal && <p className="mt-1 text-[10px] text-amber-600">Official original</p>}
                  </td>
                  <td className="px-2 py-2 text-slate-600">{row.recommendedAction}</td>
                  <td className="px-2 py-2">
                    {canAct && row.documentId ? (
                      <div className="flex flex-col gap-1">
                        <RowActionButton label="Reclassify to plan" busy={busyKey === `${row.documentId}:RECLASSIFY_TO_PLAN`} disabled={busyKey !== null} onClick={() => void runRowAction(row.documentId!, "RECLASSIFY_TO_PLAN")} />
                        {isOutsidePlan && (
                          <>
                            <RowActionButton label="Mark control / not exportable" busy={busyKey === `${row.documentId}:MARK_NOT_EXPORTABLE`} disabled={busyKey !== null} onClick={() => void runRowAction(row.documentId!, "MARK_NOT_EXPORTABLE")} />
                            <RowActionButton label="Supersede duplicate" busy={busyKey === `${row.documentId}:SUPERSEDE_DUPLICATE`} disabled={busyKey !== null} onClick={() => void runRowAction(row.documentId!, "SUPERSEDE_DUPLICATE")} />
                            <RowActionButton label="Exclude outside-plan" busy={busyKey === `${row.documentId}:EXCLUDE_OUTSIDE_PLAN`} disabled={busyKey !== null} onClick={() => void runRowAction(row.documentId!, "EXCLUDE_OUTSIDE_PLAN")} />
                          </>
                        )}
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {visibleRows.length === 0 && (
              <tr><td colSpan={6} className="px-2 py-4 text-center text-slate-500">No rows to display.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {canMutate && data.summary.totalOutsidePlan > 0 && (
        <ReconcileStaleFilesButton tenderId={tenderId} staleCount={data.summary.totalOutsidePlan} />
      )}

      {!canMutate && data.rows.some((row) => Boolean(row.documentId) && row.status !== "SUPERSEDED") && (
        <p className="mt-3 text-xs text-slate-500">Read-only: changing submission-scope rows requires ADMIN or PROPOSAL_MANAGER.</p>
      )}
    </section>
  );
}
