"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import { assessMatchingQuality } from "../lib/matching-quality";
import { CanonicalStatusIcon } from "./canonical-status-badge";
import type { CanonicalTenderReadiness } from "../lib/canonical-tender-readiness";

type MatchingQualityPanelProps = {
  tenderId: string;
  canonicalReadiness?: CanonicalTenderReadiness | null;
};

export function MatchingQualityPanel({ tenderId, canonicalReadiness }: MatchingQualityPanelProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/tenders/${tenderId}/matching-quality`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load matching quality");
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Load failed");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [tenderId]);

  if (loading) return <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm animate-pulse">Loading matching quality…</section>;
  if (error || !data || !data.tender) return <section className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 shadow-sm">Matching quality error: {error}</section>;

  const tender = data.tender;
  const quality = assessMatchingQuality({
    requirements: tender.requirements,
    expertMatches: tender.expertMatches,
    projectMatches: tender.projectMatches,
    vaultReviewedExperts: data.vaultReviewedExperts || 0,
    vaultReviewedProjects: data.vaultReviewedProjects || 0,
  });

  type PanelStyle = { color: "green" | "amber" | "red"; title: string };
  const panelStyle: PanelStyle = (() => {
    switch (quality.state) {
      case "MATCHES_REVIEWED":
        return { color: "green", title: "Matches appear usable" };
      case "MATCHING_NOT_REQUIRED":
        return { color: "green", title: "Matching not required by this tender" };
      case "VAULT_AWAITS_ENGINE":
        return {
          color: "amber",
          title: `Run Engine to create ${quality.vaultReviewedExperts} expert + ${quality.vaultReviewedProjects} project match(es) from the vault`,
        };
      case "MATCHES_WEAK":
        return { color: "red", title: "Matching quality is weak — review/import stronger evidence" };
      case "NO_VAULT":
        return { color: "red", title: "No vault evidence to match against — import experts / projects first" };
      default:
        return { color: "red", title: "Matching quality is weak" };
    }
  })();

  const sectionCls = panelStyle.color === "green"
    ? "border-green-200 bg-green-50"
    : panelStyle.color === "amber"
      ? "border-amber-200 bg-amber-50"
      : "border-red-200 bg-red-50";
  const labelCls = panelStyle.color === "green"
    ? "text-green-700"
    : panelStyle.color === "amber"
      ? "text-amber-700"
      : "text-red-700";

  return (
    <section id="matching-quality" className={`mb-4 rounded-2xl border p-5 shadow-sm ${sectionCls}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${labelCls}`}>
            {canonicalReadiness?.modules.matching && <CanonicalStatusIcon status={canonicalReadiness.modules.matching.state} />} Matching quality
          </p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">{panelStyle.title}</h2>
          <p className="mt-1 text-sm text-slate-600">Checks selected and reviewed expert/project matches before proposal generation.</p>
        </div>
        <Link href={`/api/tenders/${tenderId}/matching-quality`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
          Open JSON
        </Link>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Score</p><p className="text-xl font-bold text-slate-900">{quality.score}/100</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Expert matches</p><p className="text-xl font-bold text-slate-900">{quality.expertMatches}</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Project matches</p><p className="text-xl font-bold text-slate-900">{quality.projectMatches}</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Selected experts</p><p className="text-xl font-bold text-slate-900">{quality.selectedExperts}</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Selected projects</p><p className="text-xl font-bold text-slate-900">{quality.selectedProjects}</p></div>
      </div>

      {quality.warnings.length > 0 && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {quality.warnings.slice(0, 5).map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}

      {quality.recommendations.length > 0 && panelStyle.color !== "green" && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Recommended actions</p>
          <ul className="list-disc space-y-1 pl-4 text-sm text-slate-700">
            {quality.recommendations.slice(0, 4).map((rec) => <li key={rec}>{rec}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
