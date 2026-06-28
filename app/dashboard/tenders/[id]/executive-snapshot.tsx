"use client";

import React from "react";
import Link from "next/link";
import { type ReleaseSnapshot } from "../../../../lib/engine/release-snapshot";

/**
 * Executive Tender Snapshot
 *
 * Consumes the unified ReleaseSnapshot to ensure absolute consistency.
 * Rule 8: Honest UI wording and separate labels for each readiness dimension.
 */
export function ExecutiveSnapshot({ snapshot }: { snapshot: ReleaseSnapshot }) {
  const { extraction, analysis, metadata, requirements, buildPlan, vaultMatches, eligibility } = snapshot;

  const decision: "GO" | "REVIEW" | "NO_GO" = !eligibility.readyForFinalZip
    ? (eligibility.blockers.length > 3 ? "NO_GO" : "REVIEW")
    : "GO";

  const badgeClass = (d: string) => {
    if (d === "GO") return "bg-emerald-100 text-emerald-700 border-emerald-200";
    if (d === "NO_GO") return "bg-red-100 text-red-700 border-red-200";
    return "bg-amber-100 text-amber-700 border-amber-200";
  };

  return (
    <section className="mb-6 rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Release Readiness Snapshot</p>
          <h2 className="mt-1 text-xl font-bold text-slate-900 break-words line-clamp-3">Authoritative Decision Support</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Rule 1: Unified server-side snapshot. Diagnostic scores never override blocked release status.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-4 py-2 text-sm font-bold ${badgeClass(decision)}`}>{decision}</span>
          <Link
            href={`/dashboard/tenders/${snapshot.tenderId}/command-center`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Full Command Center →
          </Link>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {/* Extraction Quality */}
        <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
          <p className="text-xs text-slate-500 font-medium uppercase">Extraction Quality</p>
          <p className={`mt-1 text-lg font-bold ${extraction.overallSeverity === "GOOD" ? "text-emerald-700" : extraction.overallSeverity === "UNSAFE" ? "text-red-700" : "text-amber-700"}`}>
            {extraction.overallSeverity}
          </p>
          <p className="text-[10px] text-slate-400">{extraction.files.length} active files</p>
        </div>

        {/* AI Analysis */}
        <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
          <p className="text-xs text-slate-500 font-medium uppercase">AI Job Status</p>
          <p className={`mt-1 text-lg font-bold ${analysis.state === "AI_SUCCEEDED" ? "text-emerald-700" : "text-amber-700"}`}>
            {analysis.state.replace(/_/g, " ")}
          </p>
          <p className="text-[10px] text-slate-400">{analysis.completedChunks}/{analysis.totalChunks} chunks</p>
        </div>

        {/* Metadata Grounding */}
        <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
          <p className="text-xs text-slate-500 font-medium uppercase">Metadata Grounding</p>
          <p className={`mt-1 text-lg font-bold ${metadata.groundedFields === metadata.totalFields ? "text-emerald-700" : "text-amber-700"}`}>
            {metadata.groundedFields} / {metadata.totalFields}
          </p>
          <p className="text-[10px] text-slate-400">Critical fields must be source-proven</p>
        </div>

        {/* Requirement Traceability vs Evidence Coverage */}
        <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
          <p className="text-xs text-slate-500 font-medium uppercase">Traceability / Evidence</p>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-lg font-bold text-slate-900">{requirements.traced}</span>
            <span className="text-xs text-slate-500">traced</span>
            <span className="mx-1 text-slate-300">/</span>
            <span className="text-lg font-bold text-slate-900">{requirements.evidenceCovered}</span>
            <span className="text-xs text-slate-500">covered</span>
          </div>
          <p className="text-[10px] text-slate-400">{requirements.mandatory} mandatory total</p>
        </div>

        {/* Generation / ZIP Readiness */}
        <div className="rounded-xl bg-slate-50 p-4 border border-slate-100">
          <p className="text-xs text-slate-500 font-medium uppercase">Release Eligibility</p>
          <div className="mt-1 flex flex-col gap-0.5">
             <span className={`text-xs font-bold ${eligibility.readyForGeneration ? "text-emerald-700" : "text-red-700"}`}>
               {eligibility.readyForGeneration ? "✓ Gen Ready" : "✗ Gen Blocked"}
             </span>
             <span className={`text-xs font-bold ${eligibility.readyForFinalZip ? "text-emerald-700" : "text-red-700"}`}>
               {eligibility.readyForFinalZip ? "✓ ZIP Ready" : "✗ ZIP Blocked"}
             </span>
          </div>
        </div>
      </div>

      {eligibility.blockers.length > 0 && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-bold text-red-800">Critical Release Blockers</p>
          <ul className="mt-2 list-disc pl-5 text-xs text-red-700 space-y-1">
            {eligibility.blockers.map(b => (
              <li key={b.code}>{b.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-100 p-4 bg-slate-50/50">
          <p className="text-sm font-semibold text-slate-900">Build Plan State</p>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-slate-600">Provenance:</span>
            <strong className="text-slate-900">{buildPlan.state}</strong>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-slate-600">Documents:</span>
            <strong className="text-slate-900">{buildPlan.generatedDocumentCount} / {buildPlan.plannedDocumentCount}</strong>
          </div>
        </div>
        <div className="rounded-xl border border-slate-100 p-4 bg-slate-50/50">
          <p className="text-sm font-semibold text-slate-900">Vault Matches</p>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-slate-600">Experts (Reviewed/Selected):</span>
            <strong className="text-slate-900">{vaultMatches.reviewedSelectedExperts} / {vaultMatches.totalSelectedExperts}</strong>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-slate-600">Projects (Reviewed/Selected):</span>
            <strong className="text-slate-900">{vaultMatches.reviewedSelectedProjects} / {vaultMatches.totalSelectedProjects}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}
