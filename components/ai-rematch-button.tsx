"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, WarningIcon, CrossIcon } from "./icons";

type Perspective =
  | "DISCIPLINE_FIT"
  | "SCOPE_COVERAGE"
  | "SENIORITY_OR_SCALE"
  | "SECTOR_FIT"
  | "ROLE_RECENCY"
  | "EVIDENCE_QUALITY"
  | "COMPLIANCE_CRITICALITY"
  | "PORTFOLIO_CONTRIBUTION"
  | "MANDATORY_ELIGIBILITY"
  | "DELIVERY_RISK"
  | "DIFFERENTIATION"
  | "COMMERCIAL_VALUE";

type RawPerspective = Perspective | "RECENCY_OR_ROLE";

const PERSPECTIVE_LABEL: Record<Perspective, string> = {
  DISCIPLINE_FIT: "Discipline",
  SCOPE_COVERAGE: "Scope",
  SENIORITY_OR_SCALE: "Scale",
  SECTOR_FIT: "Sector",
  ROLE_RECENCY: "Role/Recency",
  EVIDENCE_QUALITY: "Evidence",
  COMPLIANCE_CRITICALITY: "Compliance",
  PORTFOLIO_CONTRIBUTION: "Portfolio",
  MANDATORY_ELIGIBILITY: "Eligibility",
  DELIVERY_RISK: "Low-risk delivery",
  DIFFERENTIATION: "Differentiation",
  COMMERCIAL_VALUE: "Commercial value",
};

const PERSPECTIVE_ORDER: Perspective[] = [
  "DISCIPLINE_FIT",
  "SCOPE_COVERAGE",
  "SENIORITY_OR_SCALE",
  "SECTOR_FIT",
  "ROLE_RECENCY",
  "EVIDENCE_QUALITY",
  "COMPLIANCE_CRITICALITY",
  "PORTFOLIO_CONTRIBUTION",
  "MANDATORY_ELIGIBILITY",
  "DELIVERY_RISK",
  "DIFFERENTIATION",
  "COMMERCIAL_VALUE",
];

interface CandidateAssessment {
  candidateId: string;
  overallScore: number;
  perspectives: Partial<Record<RawPerspective, number>>;
  strength: string;
  concern: string;
  recommendSelection: boolean;
}

interface AIRematchResult {
  success?: boolean;
  warning?: string;
  code?: string;
  expertsUpdated?: number;
  projectsUpdated?: number;
  expertsSelected?: number;
  projectsSelected?: number;
  applySelections?: boolean;
  selectedExpertCount?: number;
  selectedProjectCount?: number;
  iterations?: number;
  complianceStatePreserved?: boolean;
  expertBatch?: { assessments: CandidateAssessment[]; durationMs: number } | null;
  projectBatch?: { assessments: CandidateAssessment[]; durationMs: number } | null;
}

interface AIRematchButtonProps {
  tenderId: string;
  experts?: Array<{ id: string; fullName: string }>;
  projects?: Array<{ id: string; name: string }>;
  onRematchComplete?: () => void;
}

function scoreColor(score: number): string {
  if (score >= 8) return "bg-emerald-500";
  if (score >= 6) return "bg-amber-500";
  if (score >= 4) return "bg-orange-500";
  return "bg-red-500";
}

function scoreForPerspective(assessment: CandidateAssessment, key: Perspective): number | undefined {
  if (key === "ROLE_RECENCY") return assessment.perspectives.ROLE_RECENCY ?? assessment.perspectives.RECENCY_OR_ROLE;
  return assessment.perspectives[key];
}

function perspectiveEntries(assessment: CandidateAssessment): Array<[Perspective, number]> {
  return PERSPECTIVE_ORDER
    .map((key) => [key, scoreForPerspective(assessment, key)] as const)
    .filter((entry): entry is readonly [Perspective, number] => typeof entry[1] === "number")
    .map(([key, score]) => [key, score]);
}

function criticalFloor(assessment: CandidateAssessment): number | null {
  const keys: Perspective[] = ["DISCIPLINE_FIT", "SCOPE_COVERAGE", "EVIDENCE_QUALITY", "COMPLIANCE_CRITICALITY", "MANDATORY_ELIGIBILITY"];
  const values = keys.map((key) => scoreForPerspective(assessment, key)).filter((v): v is number => typeof v === "number");
  return values.length ? Math.min(...values) : null;
}

export function AIRematchButton({ tenderId, experts = [], projects = [], onRematchComplete }: AIRematchButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AIRematchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);

  async function runRematch(applySelections: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/ai-rematch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applySelections }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error ?? `Rematch failed (${res.status})`);
      }
      const data = await res.json();
      setResult(data);
      setShowResult(true);
      router.refresh();
      onRematchComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rematch failed");
    } finally {
      setLoading(false);
    }
  }

  function nameFor(category: "EXPERT" | "PROJECT", candidateId: string): string {
    if (category === "EXPERT") return experts.find((e) => e.id === candidateId)?.fullName ?? candidateId.slice(0, 8);
    return projects.find((p) => p.id === candidateId)?.name ?? candidateId.slice(0, 8);
  }

  function CandidateCard({ category, assessment }: { category: "EXPERT" | "PROJECT"; assessment: CandidateAssessment }) {
    const entries = perspectiveEntries(assessment);
    const floor = criticalFloor(assessment);
    return (
      <li className="rounded-lg border border-slate-100 bg-white p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900">{nameFor(category, assessment.candidateId)}</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {entries.map(([perspective, score]) => (
                <div key={perspective} className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-slate-500">
                    <span>{PERSPECTIVE_LABEL[perspective]}</span>
                    <span className="font-medium text-slate-900">{score}/10</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full ${scoreColor(score)}`} style={{ width: `${score * 10}%` }} />
                  </div>
                </div>
              ))}
            </div>
            {floor !== null && <p className="mt-2 text-xs text-slate-600">Critical-floor: {floor}/10 across discipline, scope, evidence, compliance, and eligibility.</p>}
            {assessment.strength && <p className="mt-2 text-xs text-emerald-700 inline-flex items-center gap-0.5"><CheckIcon className="inline h-3 w-3" /> {assessment.strength}</p>}
            {assessment.concern && <p className="mt-1 text-xs text-amber-800 inline-flex items-center gap-0.5"><WarningIcon className="inline h-3 w-3" /> {assessment.concern}</p>}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-2xl font-bold text-slate-900">{Math.round(assessment.overallScore * 100)}</p>
            <p className="text-[10px] uppercase tracking-wide text-slate-500">overall</p>
            {assessment.recommendSelection && (
              <span className="mt-1 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                <CheckIcon className="inline h-3 w-3" /> Selected
              </span>
            )}
          </div>
        </div>
      </li>
    );
  }

  return (
    <>
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">AI Multi-Perspective Rematch</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Re-score experts &amp; projects through 12 evaluator lenses, then run 20 best-available portfolio passes with critical-floor risk control and apply the strongest selection to the main engine.
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => void runRematch(false)}
            className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
          >
            {loading ? "Rematching…" : "Re-score (preview only)"}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void runRematch(true)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
            title="Re-score, select the best available portfolio, and apply the selected experts/projects to the main engine without deleting compliance review state"
          >
            Re-score + apply selections
          </button>
        </div>

        {loading && (
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
            <div className="h-2 w-2 animate-pulse rounded-full bg-slate-400" />
            <span>AI is evaluating candidates across 12 perspectives and 20 selection passes…</span>
          </div>
        )}

        {result?.warning && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <WarningIcon className="inline h-4 w-4 text-amber-500" /> {result.warning}
            {result.expertsSelected != null && (
              <span className="ml-1">({result.expertsSelected} expert(s), {result.projectsSelected} project(s) selected by engine score.)</span>
            )}
          </div>
        )}

        {result && !result.warning && !showResult && (
          <button
            type="button"
            onClick={() => setShowResult(true)}
            className="mt-3 text-xs font-medium text-slate-600 underline hover:text-slate-900"
          >
            Show last result
          </button>
        )}
      </div>

      {result && !result.warning && showResult && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="AI rematch results"
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8"
          onClick={() => setShowResult(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative my-8 w-full max-w-5xl rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Rematch results</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {result.expertsUpdated} expert(s) and {result.projectsUpdated} project(s) re-scored across 12 perspectives.
                  {typeof result.iterations === "number" && ` Best-available selection used ${result.iterations} portfolio passes.`}
                  {result.applySelections && " Selections were applied to the main engine."}
                </p>
                {result.applySelections && (
                  <p className="mt-1 text-xs text-emerald-700">
                    Applied selection: {result.selectedExpertCount ?? 0} expert(s), {result.selectedProjectCount ?? 0} project reference(s).
                    {result.complianceStatePreserved && " Existing compliance review rows were preserved."}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowResult(false)}
                aria-label="Close results"
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <CrossIcon />
              </button>
            </div>

            {result.expertBatch?.assessments && result.expertBatch.assessments.length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Experts ({result.expertBatch.assessments.length})
                </p>
                <ul className="mt-2 space-y-2">
                  {[...result.expertBatch.assessments]
                    .sort((a, b) => b.overallScore - a.overallScore)
                    .map((assessment) => (
                      <CandidateCard key={assessment.candidateId} category="EXPERT" assessment={assessment} />
                    ))}
                </ul>
              </div>
            )}

            {result.projectBatch?.assessments && result.projectBatch.assessments.length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Projects ({result.projectBatch.assessments.length})
                </p>
                <ul className="mt-2 space-y-2">
                  {[...result.projectBatch.assessments]
                    .sort((a, b) => b.overallScore - a.overallScore)
                    .map((assessment) => (
                      <CandidateCard key={assessment.candidateId} category="PROJECT" assessment={assessment} />
                    ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
