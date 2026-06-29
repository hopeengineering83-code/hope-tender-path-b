"use client";

import React, { useEffect, useState } from "react";
import type { TenderReleaseSnapshot } from "../lib/engine/tender-release-snapshot";
import { CanonicalStatusIcon } from "./canonical-status-badge";
import type { CanonicalTenderReadiness } from "../lib/canonical-tender-readiness";

export function SubmissionPlanReconciliationPanel({
  tenderId,
  canonicalReadiness,
}: {
  tenderId: string;
  canonicalReadiness?: CanonicalTenderReadiness | null;
}) {
  const [snapshot, setSnapshot] = useState<TenderReleaseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/tenders/${tenderId}/workflow-center`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok && j.snapshot) setSnapshot(j.snapshot);
      })
      .finally(() => setLoading(false));
  }, [tenderId]);

  if (loading) return null;
  if (!snapshot) return null;

  const { buildPlan } = snapshot;

  return (
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" id="submission-plan-reconciliation">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {canonicalReadiness?.modules.submissionPlan && <CanonicalStatusIcon status={canonicalReadiness.modules.submissionPlan.state} />} Submission Plan Integrity
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Ensures all planned tender-required documents have been generated or accounted for.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="rounded-xl bg-slate-50 p-3 flex-1">
          <p className="text-[10px] font-semibold uppercase text-slate-400">Status</p>
          <p className={`mt-1 text-sm font-bold ${buildPlan.valid ? "text-emerald-700" : "text-red-700"}`}>
            {buildPlan.valid ? "Valid Build Plan" : "Incomplete Plan"}
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 flex-1">
          <p className="text-[10px] font-semibold uppercase text-slate-400">Documents</p>
          <p className="mt-1 text-sm font-bold text-slate-900">{buildPlan.documentCount} planned</p>
        </div>
      </div>

      {buildPlan.blocker && (
        <p className="mt-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          ⚠ {buildPlan.blocker}
        </p>
      )}
    </section>
  );
}
