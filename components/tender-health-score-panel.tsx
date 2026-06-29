"use client";

import React from "react";
import Link from "next/link";
import { assessExtractionQuality } from "../lib/extraction-quality";
import { isExtractionCorrupted } from "../lib/engine/extraction-quality-gate";
import { assessTenderMetadataCompleteness } from "../lib/engine/tender-metadata-completeness";
import { safeParseJsonArray } from "../lib/utils/json";
import { CanonicalStatusBadge, CanonicalStatusIcon } from "./canonical-status-badge";
import type { CanonicalTenderReadiness } from "../lib/canonical-tender-readiness";
import type { CanonicalModuleKey } from "../lib/engine/canonical-readiness-state";
import { SnapshotConsistencyBadge } from "./snapshot-consistency-badge";

type Dimension = {
  label: string;
  score: number;
  max: number;
  detail: string;
  status: "PASS" | "WARN" | "FAIL";
  actionLabel?: string;
  actionHref?: string;
};

const DIMENSION_MODULE: Record<string, CanonicalModuleKey> = {
  Extraction: "extraction",
  "AI Analysis": "analysis",
  Metadata: "metadata",
  Requirements: "requirements",
  "Submission Plan": "submissionPlan",
  Documents: "documents",
  Compliance: "compliance",
};

export function TenderHealthScorePanel({
  tenderId,
  canonicalReadiness,
}: {
  tenderId: string;
  canonicalReadiness?: CanonicalTenderReadiness | null;
}) {
  const [tender, setTender] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetch(`/api/tenders/${tenderId}/health-score`)
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setTender(j.tender);
      })
      .finally(() => setLoading(false));
  }, [tenderId]);

  if (loading) return <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm animate-pulse">Loading health score…</section>;
  if (!tender) return null;

  const scoreBar = (val: number, max: number) => {
    const pct = Math.round((val / max) * 100);
    const color = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500";
    return (
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`absolute left-0 top-0 h-full ${color} transition-all duration-300`} style={{ width: `${pct}%` }} />
      </div>
    );
  };

  const dimensions: Dimension[] = [];

  // 1. Extraction
  const extState = canonicalReadiness?.modules.extraction.state;
  dimensions.push({
    label: "Extraction",
    score: extState === "READY" ? 20 : extState === "WARNING" ? 10 : 0,
    max: 20,
    detail: extState === "READY" ? "Ready" : extState || "Blocked",
    status: extState === "READY" ? "PASS" : extState === "BLOCKED" ? "FAIL" : "WARN",
    actionLabel: extState !== "READY" ? "Review extraction" : undefined,
    actionHref: "#tender-files",
  });

  // 2. AI Analysis
  const anaState = canonicalReadiness?.modules.analysis.state;
  dimensions.push({
    label: "AI Analysis",
    score: anaState === "READY" ? 15 : anaState === "WARNING" ? 7 : 0,
    max: 15,
    detail: anaState === "READY" ? "Ready" : anaState || "Blocked",
    status: anaState === "READY" ? "PASS" : anaState === "BLOCKED" ? "FAIL" : "WARN",
    actionLabel: anaState !== "READY" ? "Run AI Analyze" : undefined,
    actionHref: "#ai-analyze-section",
  });

  // 3. Metadata
  const metaState = canonicalReadiness?.modules.metadata.state;
  dimensions.push({
    label: "Metadata",
    score: metaState === "READY" ? 15 : metaState === "WARNING" ? 8 : 0,
    max: 15,
    detail: metaState === "READY" ? "Ready" : metaState || "Blocked",
    status: metaState === "READY" ? "PASS" : metaState === "BLOCKED" ? "FAIL" : "WARN",
    actionLabel: metaState !== "READY" ? "Edit metadata" : undefined,
    actionHref: "#tender-edit-form",
  });

  // 4. Requirements
  const reqState = canonicalReadiness?.modules.requirements.state;
  dimensions.push({
    label: "Requirements",
    score: reqState === "READY" ? 15 : reqState === "PARTIAL" ? 7 : 0,
    max: 15,
    detail: reqState === "READY" ? "Ready" : reqState || "Blocked",
    status: reqState === "READY" ? "PASS" : reqState === "BLOCKED" ? "FAIL" : "WARN",
    actionLabel: reqState !== "READY" ? "Review requirements" : undefined,
    actionHref: "#ai-analyze-section",
  });

  // 5. Submission Plan
  const planState = canonicalReadiness?.modules.submissionPlan.state;
  dimensions.push({
    label: "Submission Plan",
    score: planState === "READY" ? 10 : 0,
    max: 10,
    detail: planState === "READY" ? "Ready" : planState || "Blocked",
    status: planState === "READY" ? "PASS" : planState === "BLOCKED" ? "FAIL" : "WARN",
    actionLabel: planState !== "READY" ? "Build plan" : undefined,
    actionHref: "#ai-analyze-section",
  });

  // 6. Documents
  const docState = canonicalReadiness?.modules.documents.state;
  dimensions.push({
    label: "Documents",
    score: docState === "READY" ? 15 : docState === "PARTIAL" ? 7 : 0,
    max: 15,
    detail: docState === "READY" ? "Ready" : docState || "Blocked",
    status: docState === "READY" ? "PASS" : docState === "BLOCKED" ? "FAIL" : "WARN",
    actionLabel: docState !== "READY" ? "Generate/View docs" : undefined,
    actionHref: "#generated-documents",
  });

  // 7. Compliance
  const compState = canonicalReadiness?.modules.compliance.state;
  dimensions.push({
    label: "Compliance",
    score: compState === "READY" ? 10 : 5,
    max: 10,
    detail: compState === "READY" ? "Ready" : compState || "Gaps exist",
    status: compState === "READY" ? "PASS" : "WARN",
  });

  const totalScore = dimensions.reduce((s, d) => s + d.score, 0);
  const maxScore = dimensions.reduce((s, d) => s + d.max, 0);
  const healthPct = Math.round((totalScore / maxScore) * 100);

  const healthColor = healthPct >= 80 ? "text-emerald-700" : healthPct >= 50 ? "text-amber-700" : "text-red-700";
  const healthBg = healthPct >= 80 ? "border-emerald-200 bg-emerald-50" : healthPct >= 50 ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50";
  const healthLabel = healthPct >= 80 ? "Strong" : healthPct >= 60 ? "Acceptable" : healthPct >= 40 ? "Needs Work" : "Critical Issues";
  const healthState = canonicalReadiness?.modules.generation.state ?? canonicalReadiness?.modules.export.state ?? "NOT_RUN";

  return (
    <section className={`mb-4 rounded-2xl border p-5 shadow-sm ${healthBg}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tender Health Score</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`text-4xl font-extrabold ${healthColor}`}>{healthPct}</span>
            <span className="text-lg text-slate-400">/100</span>
            <span className={`rounded-full px-3 py-0.5 text-sm font-semibold ${healthColor} bg-white border`}>{healthLabel}</span>
            <CanonicalStatusBadge status={healthState} size="sm" />
          </div>
          <p className="mt-1 text-sm text-slate-600">Composite score across {dimensions.length} quality dimensions. Canonical icon/state comes from the shared readiness payload; numeric score cannot override blockers.</p>
          <SnapshotConsistencyBadge tenderId={tenderId} verdict="generation" />
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Raw points</p>
          <p className="text-xl font-bold text-slate-900">{totalScore}<span className="text-sm text-slate-400">/{maxScore}</span></p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {dimensions.map((d) => (
          <div key={d.label} className={`rounded-xl border bg-white/80 p-3 ${d.status === "FAIL" ? "border-red-200" : d.status === "WARN" ? "border-amber-200" : "border-slate-200"}`}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-slate-700">{canonicalReadiness?.modules[DIMENSION_MODULE[d.label]] ? <CanonicalStatusIcon status={canonicalReadiness.modules[DIMENSION_MODULE[d.label]].state} /> : null} {d.label}</p>
            </div>
            {scoreBar(d.score, d.max)}
            <p className="mt-1 text-[10px] text-slate-500 truncate" title={d.detail}>{d.detail}</p>
            {d.actionLabel && d.actionHref && (
              <a href={d.actionHref} className={`mt-1.5 inline-block text-[10px] font-medium underline ${d.status === "FAIL" ? "text-red-600 hover:text-red-800" : "text-amber-600 hover:text-amber-800"}`}>
                {d.actionLabel} →
              </a>
            )}
          </div>
        ))}
      </div>

      {dimensions.some((d) => d.status === "FAIL") && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">
          <strong>Failing dimensions block export.</strong> Use the links above to address each FAIL item before attempting final export.
        </div>
      )}
    </section>
  );
}
