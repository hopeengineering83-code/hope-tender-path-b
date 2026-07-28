"use client";

import React, { useCallback, useEffect, useState } from "react";
import { clientLogger } from "@/lib/ui/client-logger";
import { subscribeTenderWorkflowSync } from "@/lib/ui/tender-workflow-sync";
import { DisclosureAnchorLink } from "./disclosure-anchor-link";
import { ArrowRightIcon, CheckCircleIcon, WarningIcon } from "./icons";

// This panel previously fetched /api/tenders/[id]/workflow-center and read
// `json.plan` — a key that route has never returned in its consolidated form
// ({ ok, snapshot, workflow, decision, stages, classification, pageLedgers }),
// so the panel silently rendered nothing, and NextActionPanel's
// "#submission-plan" scroll target never existed anywhere on the page.
// It now consumes the dedicated /api/tenders/[id]/submission-plan route's
// summary, which is the authoritative plan-state source.
//
// Every branch below keeps id="submission-plan" attached — it is a
// NextActionPanel scroll anchor and must exist in loading/error states too
// (same anchor-stability rule as #requirement-coverage).

type PlanSummary = {
  totalRequired: number;
  totalGenerated: number;
  planState: string;
  requiresUserConfirmation: boolean;
};

function planReason(summary: PlanSummary): string {
  if (summary.planState === "CONFIRMED_BUILD_PLAN" && !summary.requiresUserConfirmation) {
    return "A confirmed Build Plan is active. Generated documents are reconciled against it.";
  }
  if (summary.planState === "EXPLICIT_TENDER_PLAN") {
    return "Tender-issued file scope is available, but it is not a confirmed Build Plan. Build and confirm the plan before generation or export.";
  }
  if (summary.planState === "DERIVED_DRAFT_UNCONFIRMED") {
    return "This plan is a derived draft. Build and confirm the Build Plan — derived drafts never authorize generation or export.";
  }
  return "The submission plan requires user confirmation before it can authorize generation or export.";
}

export function SubmissionPlanTruthPanel({ tenderId }: { tenderId: string }) {
  const [summary, setSummary] = useState<PlanSummary | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const response = await fetch(`/api/tenders/${tenderId}/submission-plan`, {
        cache: "no-store",
        credentials: "include",
      });
      const json = await response.json().catch(() => ({})) as { summary?: PlanSummary; error?: string };
      if (!response.ok) throw new Error(json.error ?? `submission-plan ${response.status}`);
      if (!json.summary) throw new Error("Submission plan response did not include a summary");
      setSummary(json.summary);
    } catch (error) {
      setFailed(true);
      clientLogger.error(
        "submission plan truth fetch failed",
        error instanceof Error ? { message: error.message } : { error: String(error) },
      );
    }
  }, [tenderId]);

  useEffect(() => {
    void load();
    return subscribeTenderWorkflowSync(tenderId, () => {
      void load();
    });
  }, [load, tenderId]);

  if (failed) {
    return (
      <div id="submission-plan" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">Submission plan status could not be loaded.</p>
        <button type="button" onClick={() => void load()} className="mt-2 text-xs font-medium text-red-700 underline">Retry</button>
      </div>
    );
  }

  if (!summary) {
    return (
      <div id="submission-plan" className="mt-4 rounded-xl border border-slate-200 bg-white p-4" aria-busy="true">
        <p className="text-sm text-slate-500">Loading submission plan status…</p>
      </div>
    );
  }

  const verified = summary.planState === "CONFIRMED_BUILD_PLAN" && !summary.requiresUserConfirmation;
  return (
    <div id="submission-plan" className={`mt-4 rounded-xl border p-4 ${verified ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
      <h3 className={`flex items-center gap-1.5 text-sm font-bold ${verified ? "text-green-900" : "text-amber-900"}`}>
        {verified ? <CheckCircleIcon /> : <WarningIcon />}
        {verified ? "Confirmed Build Plan" : "Submission scope preview — not confirmed"}
      </h3>
      <p className="mt-1 text-xs text-slate-600">{planReason(summary)}</p>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-[10px] font-bold uppercase">
        <span className="text-slate-500">{verified ? "Confirmed required" : "Scope files"}: {summary.totalRequired}</span>
        <span className="text-slate-500">Current outputs: {summary.totalGenerated}</span>
        {!verified && (
          <DisclosureAnchorLink
            href="#submission-plan-reconciliation"
            className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[10px] font-semibold text-amber-800 hover:bg-amber-100"
            title="Open the Build Plan review and confirmation action"
          >
            Review and confirm Build Plan <ArrowRightIcon />
          </DisclosureAnchorLink>
        )}
      </div>
    </div>
  );
}
