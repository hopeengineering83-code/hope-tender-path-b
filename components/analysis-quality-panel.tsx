"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import {
  assessTenderAnalysisQuality,
  isUntrustedAnalysisStatus,
  scoreToSeverity,
  statusToSeverity,
} from "../lib/engine/analysis/tender-analysis-quality";
import { severityBgClass, severityBorderClass, severityTextClass } from "../lib/utils/severity-classes";
import { analysisSourceSummary } from "../lib/engine/analysis-source";
import { inferSector } from "../lib/engine/universal-tender-taxonomy";
import { CanonicalStatusIcon } from "./canonical-status-badge";
import type { CanonicalTenderReadiness } from "../lib/canonical-tender-readiness";

type AnalysisQualityPanelProps = {
  tenderId: string;
  canonicalReadiness?: CanonicalTenderReadiness | null;
};

export function AnalysisQualityPanel({ tenderId, canonicalReadiness }: AnalysisQualityPanelProps) {
  const [tender, setTender] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/tenders/${tenderId}/analysis-quality`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load");
        setTender(json.tender);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Load failed");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [tenderId]);

  if (loading) return <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm animate-pulse">Loading analysis quality…</section>;
  if (error || !tender) return <section className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 shadow-sm">Analysis quality error: {error}</section>;

  const matchingQuality = tender.matchingQuality || { score: 0 };
  const extractedChars = tender.files?.reduce((acc: number, f: any) => acc + (f.extractedTextLength || 0), 0) || 0;
  const totalPageCount = tender.files?.reduce((acc: number, f: any) => acc + (f.totalPages || 0), 0) || 0;

  const rawSource = tender.notes?.includes("ANALYSIS_SOURCE: AI") ? "AI" :
                    tender.notes?.includes("ANALYSIS_SOURCE: REGEX_FALLBACK_AI_ERROR") ? "REGEX_FALLBACK_AI_ERROR" :
                    tender.notes?.includes("ANALYSIS_SOURCE: HUMAN_APPROVED_REGEX_FALLBACK") ? "HUMAN_APPROVED_REGEX_FALLBACK" : "UNKNOWN";

  const quality = assessTenderAnalysisQuality({
    requirements: tender.requirements,
    analysisSummary: tender.analysisSummary,
    evaluationMethodology: tender.evaluationMethodology,
    submissionNotes: [tender.notes, tender.intakeSummary].filter(Boolean).join("\n\n"),
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    clientName: tender.clientName || (tender as Record<string, unknown>).procuringEntityName as string | null | undefined,
    referenceNumber: tender.reference,
    country: tender.country,
    clientContactName: tender.clientContactName,
    matchingScore: matchingQuality.score,
    extractedTextLength: extractedChars,
    totalPageCount,
    deadline: tender.deadline,
    submissionMethod: tender.submissionMethod,
    submissionAddress: tender.submissionAddress,
    submissionEmails: tender.submissionEmails,
    analysisExtractionStatus: tender.analysisExtractionStatus,
    analysisSource: rawSource,
    selectedReviewedExperts: tender.expertMatches.filter((m: any) => m.isSelected && m.expert?.trustLevel === "REVIEWED").length,
    selectedReviewedProjects: tender.projectMatches.filter((m: any) => m.isSelected && m.project?.trustLevel === "REVIEWED").length,
  });

  const analysisSource = analysisSourceSummary(rawSource as any);
  const sourceIsFallbackOrUnknown = rawSource !== "AI";
  const untrustedStatus = isUntrustedAnalysisStatus(tender.analysisExtractionStatus);
  const fallbackOnly = quality.isRegexFallback || sourceIsFallbackOrUnknown || untrustedStatus;
  const ready = quality.severity !== "POOR" && quality.severity !== "UNSAFE" && analysisSource.risk === "LOW" && !fallbackOnly;
  const sectorProbeText = [tender.analysisSummary, tender.intakeSummary, tender.notes, tender.title, tender.description].filter(Boolean).join("\n\n");
  const detectedSector = sectorProbeText.trim().length > 20 ? inferSector(sectorProbeText) : null;
  const sourceSev = statusToSeverity(fallbackOnly ? (analysisSource.risk === "HIGH" || untrustedStatus ? "HIGH" : "MEDIUM") : "GOOD");
  const sourceRiskClass = `${severityBgClass(sourceSev).replace("-50", "-100")} ${severityTextClass(sourceSev)}`;
  const severityClass: Record<string, string> = {
    GOOD: fallbackOnly ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700",
    WARNING: "bg-amber-100 text-amber-700",
    POOR: "bg-red-100 text-red-700",
    UNSAFE: "bg-red-200 text-red-800",
  };
  const sectionSev = ready ? "good" as const : fallbackOnly ? "warning" as const : "poor" as const;
  const sectionClass = `${severityBorderClass(sectionSev)} ${severityBgClass(sectionSev)}`;
  const headerTone = severityTextClass(sectionSev);

  return (
    <section id="analysis-quality" className={`mb-4 rounded-2xl border p-5 shadow-sm ${sectionClass}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${headerTone}`}>
            {canonicalReadiness?.modules.analysis && <CanonicalStatusIcon status={canonicalReadiness.modules.analysis.state} />} Analysis quality
          </p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">{ready ? "Tender analysis appears usable" : "Tender analysis needs review"}</h2>
          <p className="mt-1 text-sm text-slate-600">Checks whether extracted requirements include mandatory criteria, scoring methodology, submission rules, file naming/order, source references, and whether analysis used AI or fallback rules.</p>
        </div>
        <Link href={`/api/tenders/${tenderId}/analysis-quality`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
          Open JSON
        </Link>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl bg-white p-3">
          <p className="text-xs text-slate-500">Score</p>
          <p className="text-xl font-bold text-slate-900">{quality.score}/100</p>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${severityClass[quality.severity] ?? "bg-slate-100 text-slate-600"}`}>{fallbackOnly && quality.severity === "GOOD" ? "REVIEW" : quality.severity}</span>
          {quality.isRegexFallback && <p className="mt-0.5 text-[10px] text-amber-700 leading-tight">Score capped — regex fallback</p>}
        </div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Requirements</p><p className="text-xl font-bold text-slate-900">{quality.requirementCount}</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Mandatory</p><p className="text-xl font-bold text-slate-900">{quality.mandatoryCount}</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Source refs</p><p className="text-xl font-bold text-slate-900">{quality.sourceReferencedCount}</p></div>
        <div className="rounded-xl bg-white p-3"><p className="text-xs text-slate-500">Extracted text</p><p className="text-xl font-bold text-slate-900">{extractedChars.toLocaleString()}</p></div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {(Object.entries(quality.subScores) as [string, number][]).map(([key, val]) => {
          const label: Record<string, string> = {
            extractionQuality: "Extraction",
            requirementExtraction: "Requirements",
            metadataQuality: "Metadata",
            submissionPlanQuality: "Submission",
            matchingReadiness: "Matching",
            sourceGrounding: "Grounding",
          };
          const color = severityTextClass(fallbackOnly ? "warning" : scoreToSeverity(val, { good: 70, warn: 40 }));
          return (
            <div key={key} className="rounded-lg bg-white/70 px-2 py-1.5 text-center">
              <p className="text-[10px] text-slate-500">{label[key] ?? key}</p>
              <p className={`text-sm font-bold ${color}`}>{val}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl border border-white/70 bg-white p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-slate-900">Analysis source:</p>
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${sourceRiskClass}`}>{analysisSource.label}</span>
          {tender.analysisExtractionStatus && (() => {
            const statusLabels: Record<string, { label: string; cls: string }> = {
              FULL_EXTRACTION_AI_ANALYZED:        { label: "Full extraction", cls: "bg-green-100 text-green-700" },
              PARTIAL_EXTRACTION_AI_ANALYZED:     { label: "Partial extraction", cls: "bg-amber-100 text-amber-700" },
              OCR_REQUIRED:                       { label: "OCR required", cls: "bg-amber-100 text-amber-700" },
              EXTRACTION_WEAK_REVIEW_REQUIRED:    { label: "Weak — review required", cls: "bg-red-100 text-red-700" },
              REGEX_FALLBACK_FROM_WEAK_EXTRACTION:{ label: "Regex fallback (weak)", cls: "bg-red-100 text-red-700" },
              EXTRACTION_CORRUPTED_AI_SKIPPED:    { label: "Extraction corrupted", cls: "bg-red-100 text-red-700" },
              AI_ANALYZED:                        { label: "AI analyzed", cls: "bg-green-100 text-green-700" },
              AI_ANALYSIS_PARTIAL:                { label: "AI (partial)", cls: "bg-amber-100 text-amber-700" },
            };
            const s = statusLabels[tender.analysisExtractionStatus] ?? { label: tender.analysisExtractionStatus, cls: "bg-slate-100 text-slate-600" };
            return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
          })()}
        </div>
        <p className="mt-1 text-slate-600">{analysisSource.detail}</p>
        {analysisSource.risk === "HIGH" && (
          <p className="mt-2 text-red-700">High risk: untrusted extraction can miss exact forms, evaluation scoring, file names, submission instructions, and expert/project requirements. Re-check extraction quality and AI provider health, then re-run Engine.</p>
        )}
        {fallbackOnly && analysisSource.risk !== "HIGH" && (
          <p className="mt-2 text-amber-700">Fallback or partial analysis is for draft review only. Do not treat this as final-export ready until extraction and AI analysis are reliable.</p>
        )}
      </div>

      {detectedSector && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-900">Detected sector:</p>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">{detectedSector}</span>
          </div>
          <p className={`mt-1 text-xs ${fallbackOnly ? "text-amber-700" : "text-slate-500"}`}>
            {fallbackOnly
              ? "Sector inferred from untrusted analysis. Confirm manually before generation."
              : "Inferred from tender summary. If incorrect, update the tender title/description — sector detection influences proposal methodology framing."}
          </p>
        </div>
      )}

      {quality.metadataIssues.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-800 mb-1">Metadata issues ({quality.metadataIssues.length})</p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-700">
            {quality.metadataIssues.map((issue: string) => <li key={issue}>{issue}</li>)}
          </ul>
        </div>
      )}

      {quality.warnings.length > 0 && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {quality.warnings.slice(0, 5).map((warning: string) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
    </section>
  );
}
