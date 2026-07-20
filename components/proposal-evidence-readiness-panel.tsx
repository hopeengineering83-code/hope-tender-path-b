"use client";

import { useState } from "react";

type Severity = "HIGH" | "MEDIUM" | "LOW";

type Finding = {
  severity: Severity;
  category: string;
  title: string;
  detail: string;
  nextAction: string;
};

type ProposalEvidenceReadiness = {
  okForGeneration: boolean;
  score: number;
  requirementSummary: {
    total: number;
    withSourceTrace: number;
    mandatory: number;
    expert: number;
    projectExperience: number;
    technical: number;
    commercial: number;
  };
  evidenceSummary: {
    tenderFiles: number;
    tenderFilesWithExtractedText: number;
    companyDocuments: number;
    companyDocumentsExtracted: number;
    reviewedExpertsSelected: number;
    draftExpertsSelected: number;
    reviewedProjectsSelected: number;
    draftProjectsSelected: number;
    selectedExpertsWithSourceEvidence: number;
    selectedProjectsWithSourceEvidence: number;
    pricingWorkbookReady: boolean;
  };
  blockers: Finding[];
  warnings: Finding[];
  strengths: string[];
};

const BADGE: Record<Severity, string> = {
  HIGH: "bg-red-100 text-red-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-slate-100 text-slate-600",
};

function scoreClass(score: number, ok: boolean): string {
  if (!ok) return "text-red-700";
  if (score >= 85) return "text-emerald-700";
  if (score >= 70) return "text-amber-700";
  return "text-red-700";
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-lg bg-slate-50 px-2 py-2 text-center"><p className="font-bold text-slate-900">{value}</p><p className="text-[10px] text-slate-500">{label}</p></div>;
}

export function ProposalEvidenceReadinessPanel({ tenderId }: { tenderId: string }) {
  const [readiness, setReadiness] = useState<ProposalEvidenceReadiness | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/proposal-evidence-readiness`, { method: "GET" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Evidence readiness failed (${res.status})`);
      setReadiness(data.readiness);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evidence readiness failed");
    } finally {
      setLoading(false);
    }
  }

  const ok = readiness?.okForGeneration ?? false;

  return (
    <div id="proposal-evidence-readiness" className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Proposal Evidence Readiness</h3>
          <p className="mt-0.5 text-xs text-slate-500">Pre-generation audit for exact tender criteria, extracted tender files, reviewed company evidence, selected experts/projects, and pricing readiness.</p>
        </div>
        <div className="flex items-center gap-2">
          {readiness && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
              {ok ? "Evidence ready" : `${readiness.blockers.length} blocker(s)`}
            </span>
          )}
          <button type="button" disabled={loading} onClick={() => void check()} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60">
            {loading ? "Checking…" : readiness ? "Re-check evidence" : "Check evidence"}
          </button>
        </div>
      </div>

      {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      {!readiness && !loading && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
          Run this before generating. A strong proposal should only be drafted after tender criteria are extracted and company evidence is reviewed.
        </div>
      )}

      {readiness && (
        <div className="mt-4 space-y-4">
          <div className={`rounded-xl p-4 ${ok ? "border border-emerald-200 bg-emerald-50" : "border border-red-200 bg-red-50"}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className={`text-sm font-semibold ${ok ? "text-emerald-900" : "text-red-900"}`}>{ok ? "Ready for high-quality generation" : "Not ready for reliable generation"}</p>
                <p className={`mt-1 text-xs ${ok ? "text-emerald-700" : "text-red-700"}`}>{ok ? "Tender criteria and company evidence are strong enough for proposal drafting." : "Fix the blockers before expecting ChatGPT/Claude-level proposal quality."}</p>
              </div>
              <div className={`text-3xl font-bold ${scoreClass(readiness.score, ok)}`}>{readiness.score}<span className="text-sm">/100</span></div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-6">
            <Stat label="Requirements" value={readiness.requirementSummary.total} />
            <Stat label="Source traced" value={readiness.requirementSummary.withSourceTrace} />
            <Stat label="Tender files" value={`${readiness.evidenceSummary.tenderFilesWithExtractedText}/${readiness.evidenceSummary.tenderFiles}`} />
            <Stat label="Company docs" value={`${readiness.evidenceSummary.companyDocumentsExtracted}/${readiness.evidenceSummary.companyDocuments}`} />
            <Stat label="Reviewed experts" value={readiness.evidenceSummary.reviewedExpertsSelected} />
            <Stat label="Reviewed projects" value={readiness.evidenceSummary.reviewedProjectsSelected} />
          </div>

          {readiness.blockers.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Generation blockers</p>
              <ul className="mt-2 space-y-2">
                {readiness.blockers.map((finding, i) => (
                  <li key={`${finding.category}-${i}`} className="rounded-lg border border-red-100 bg-white p-3 text-xs">
                    <div className="flex items-start gap-2">
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${BADGE[finding.severity]}`}>{finding.severity}</span>
                      <div>
                        <p className="font-semibold text-slate-900">{finding.title}</p>
                        <p className="mt-0.5 text-slate-500">{finding.category}</p>
                        <p className="mt-1 text-slate-700">{finding.detail}</p>
                        <p className="mt-1 text-emerald-700">Next: {finding.nextAction}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {readiness.warnings.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Quality warnings</p>
              <ul className="mt-2 space-y-2">
                {readiness.warnings.map((finding, i) => (
                  <li key={`${finding.category}-${i}`} className="rounded-lg border border-amber-100 bg-white p-3 text-xs">
                    <div className="flex items-start gap-2">
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${BADGE[finding.severity]}`}>{finding.severity}</span>
                      <div>
                        <p className="font-semibold text-slate-900">{finding.title}</p>
                        <p className="mt-0.5 text-slate-500">{finding.category}</p>
                        <p className="mt-1 text-slate-700">{finding.detail}</p>
                        <p className="mt-1 text-emerald-700">Next: {finding.nextAction}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {readiness.strengths.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Evidence strengths</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
                {readiness.strengths.map((strength, i) => <li key={i}>{strength}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
