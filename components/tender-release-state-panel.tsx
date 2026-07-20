// Tender Release State panel.
//
// Fetches /api/tenders/[id]/release-state and renders the ONE canonical
// readiness score, blocker total, bid verdict, and next action. Replaces
// CanonicalReadinessScoreWidget, TenderHealthScorePanel, and
// BidControlVerdictPanel — those three independently computed overlapping
// numbers for the same tender; this panel reads the single reconciled
// server payload instead.
//
// Before valid source extraction and grounded AI analysis exist, this panel
// shows "Not calculated" for the readiness score and "Decision unavailable"
// for the bid verdict — it never invents a placeholder number or a default
// verdict.

"use client";

import { useCallback, useEffect, useState } from "react";
import { WarningIcon, CrossIcon, CheckCircleIcon, RefreshIcon } from "./icons";
import { subscribeTenderWorkflowSync } from "../lib/ui/tender-workflow-sync";
import { BidDecisionForm } from "./bid-decision-form";

type TenderReleaseBlockerSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

type TenderReleaseBlocker = {
  category: string;
  severity: TenderReleaseBlockerSeverity;
  title: string;
  nextAction: string | null;
};

type TenderReleaseState = {
  tenderId: string;
  sourceRevision: string;
  calculatedAt: string;
  extractionGrounded: boolean;
  analysisGrounded: boolean;
  readinessCalculable: boolean;
  readinessScore: number | null;
  verdict: "BID" | "BID_WITH_CONDITIONS" | "NO_BID" | null;
  verdictSummary: string | null;
  blockers: TenderReleaseBlocker[];
  blockerTotal: number;
  criticalBlockerTotal: number;
  primaryNextAction: { action: string; label: string; reason: string } | null;
  generationEligible: boolean;
  exportEligible: boolean;
  finalZipEligible: boolean;
  fixtureData: boolean;
  deploymentEnvironment: string;
};

function scoreTone(score: number): { text: string; bg: string; bar: string } {
  if (score >= 80) return { text: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", bar: "bg-emerald-500" };
  if (score >= 50) return { text: "text-amber-700", bg: "bg-amber-50 border-amber-200", bar: "bg-amber-400" };
  return { text: "text-red-700", bg: "bg-red-50 border-red-200", bar: "bg-red-500" };
}

function verdictLabel(verdict: TenderReleaseState["verdict"]): { label: string; tone: string } {
  if (verdict === "BID") return { label: "BID", tone: "bg-emerald-100 text-emerald-700" };
  if (verdict === "BID_WITH_CONDITIONS") return { label: "BID WITH CONDITIONS", tone: "bg-amber-100 text-amber-700" };
  if (verdict === "NO_BID") return { label: "NO BID", tone: "bg-red-100 text-red-700" };
  return { label: "Decision unavailable", tone: "bg-slate-100 text-slate-500" };
}

function severityBadgeClass(severity: TenderReleaseBlockerSeverity): string {
  if (severity === "CRITICAL") return "bg-red-100 text-red-700";
  if (severity === "HIGH") return "bg-red-50 text-red-600";
  if (severity === "MEDIUM") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

export function TenderReleaseStatePanel({ tenderId, canMutate = false }: { tenderId: string; canMutate?: boolean }) {
  const [data, setData] = useState<TenderReleaseState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllBlockers, setShowAllBlockers] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/release-state`, { method: "GET" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Release state lookup failed (${res.status})`);
      setData(json.releaseState as TenderReleaseState);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tender release state");
    } finally {
      setLoading(false);
    }
  }, [tenderId]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) void fetchData();
    }, 15_000);
    const unsub = subscribeTenderWorkflowSync(tenderId, () => { void fetchData(); });
    return () => { clearInterval(interval); unsub(); };
  }, [tenderId, fetchData]);

  if (loading) {
    return (
      <section id="tender-release-state" className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-busy="true">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 animate-pulse rounded-full bg-slate-200" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-40 animate-pulse rounded bg-slate-200" />
            <div className="h-5 w-24 animate-pulse rounded bg-slate-200" />
          </div>
        </div>
      </section>
    );
  }
  if (error || !data) {
    return (
      <section id="tender-release-state" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        <p className="font-semibold">Tender release state unavailable</p>
        <p className="mt-1 text-xs">Refresh to retry. If the problem persists, contact admin.</p>
        <button
          type="button"
          onClick={() => { void fetchData(); }}
          className="mt-2 inline-flex items-center gap-1 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800"
        >
          <RefreshIcon /> Retry
        </button>
      </section>
    );
  }

  const tone = data.readinessCalculable && data.readinessScore != null ? scoreTone(data.readinessScore) : { text: "text-slate-500", bg: "bg-slate-50 border-slate-200", bar: "bg-slate-300" };
  const verdict = verdictLabel(data.verdict);
  const visibleBlockers = showAllBlockers ? data.blockers : data.blockers.slice(0, 5);

  return (
    <section id="tender-release-state" className={`mb-4 rounded-2xl border p-5 shadow-sm ${tone.bg}`}>
      {data.fixtureData && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-purple-300 bg-purple-100 px-3 py-1.5 text-xs font-semibold text-purple-800">
          <WarningIcon /> Fixture / test-environment data — deployment: {data.deploymentEnvironment}. Not production.
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Readiness score</p>
          <div className="mt-1 flex items-baseline gap-2">
            {data.readinessCalculable && data.readinessScore != null ? (
              <>
                <span className={`text-4xl font-bold ${tone.text}`}>{data.readinessScore}</span>
                <span className="text-base text-slate-500">/ 100</span>
              </>
            ) : (
              <span className="text-2xl font-bold text-slate-500">Not calculated</span>
            )}
          </div>
          {!data.readinessCalculable && (
            <p className="mt-1 max-w-md text-xs text-slate-600">
              {!data.extractionGrounded && "Source extraction is not yet valid. "}
              {!data.analysisGrounded && "AI analysis is not yet grounded. "}
              A readiness score requires both before it can be calculated.
            </p>
          )}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bid verdict</p>
          <div className="mt-1">
            <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold ${verdict.tone}`}>{verdict.label}</span>
          </div>
          {data.verdictSummary && <p className="mt-1 max-w-md text-xs text-slate-600">{data.verdictSummary}</p>}
        </div>
      </div>

      {data.readinessCalculable && data.readinessScore != null && (
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white">
          <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.min(100, Math.max(0, data.readinessScore))}%` }} />
        </div>
      )}

      {data.primaryNextAction && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next required action</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{data.primaryNextAction.label}</p>
          <p className="mt-0.5 text-xs text-slate-600">{data.primaryNextAction.reason}</p>
        </div>
      )}

      <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Blockers</p>
          {data.blockerTotal === 0 ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircleIcon /> Clear</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
              <CrossIcon /> {data.blockerTotal} total ({data.criticalBlockerTotal} critical/high)
            </span>
          )}
        </div>
        {data.blockers.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {visibleBlockers.map((blocker) => (
              <li key={blocker.category} className="flex flex-wrap items-start gap-2 text-xs">
                <span className={`shrink-0 rounded px-1.5 py-0.5 font-semibold ${severityBadgeClass(blocker.severity)}`}>{blocker.severity}</span>
                <span className="text-slate-700">{blocker.title}</span>
              </li>
            ))}
          </ul>
        )}
        {data.blockers.length > 5 && (
          <button
            type="button"
            onClick={() => setShowAllBlockers((v) => !v)}
            className="mt-2 text-xs font-semibold text-blue-700 hover:underline"
          >
            {showAllBlockers ? "Show fewer" : `Show all ${data.blockers.length} blockers`}
          </button>
        )}
      </div>

      {canMutate && <BidDecisionForm tenderId={tenderId} />}
    </section>
  );
}
