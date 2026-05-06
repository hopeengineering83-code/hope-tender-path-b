"use client";

// AI Multi-Perspective Rematch button (PR #255).
//
// Drops onto the tender workspace as a button + result modal. When
// clicked, calls /api/tenders/[id]/ai-rematch which sends the top-15
// pre-filtered experts AND top-15 pre-filtered projects to Claude in
// two parallel calls. Claude scores each candidate across four
// perspectives (Discipline / Scale / Sector / Recency-or-Role) and
// returns a structured ranking.
//
// The user sees a results panel with the new scoring, can review the
// per-perspective breakdown + Claude's strength/concern notes, and
// optionally applies Claude's recommended selections.

import { useState } from "react";

type Perspective = "DISCIPLINE_FIT" | "SENIORITY_OR_SCALE" | "SECTOR_FIT" | "RECENCY_OR_ROLE";

const PERSPECTIVE_LABEL: Record<Perspective, string> = {
  DISCIPLINE_FIT: "Discipline",
  SENIORITY_OR_SCALE: "Scale",
  SECTOR_FIT: "Sector",
  RECENCY_OR_ROLE: "Role/Recency",
};

interface CandidateAssessment {
  candidateId: string;
  overallScore: number;
  perspectives: Record<Perspective, number>;
  strength: string;
  concern: string;
  recommendSelection: boolean;
}

interface AIRematchResult {
  success: boolean;
  expertsUpdated: number;
  projectsUpdated: number;
  applySelections: boolean;
  expertBatch?: { assessments: CandidateAssessment[]; durationMs: number } | null;
  projectBatch?: { assessments: CandidateAssessment[]; durationMs: number } | null;
}

interface AIRematchButtonProps {
  tenderId: string;
  // Optional: tender object for showing names in the result panel.
  experts?: Array<{ id: string; fullName: string }>;
  projects?: Array<{ id: string; name: string }>;
  // Called after a successful rematch so the parent page can refresh.
  onRematchComplete?: () => void;
}

function scoreColor(score: number): string {
  if (score >= 8) return "bg-emerald-500";
  if (score >= 6) return "bg-amber-500";
  if (score >= 4) return "bg-orange-500";
  return "bg-red-500";
}

export function AIRematchButton({ tenderId, experts = [], projects = [], onRematchComplete }: AIRematchButtonProps) {
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

  return (
    <>
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">AI Multi-Perspective Rematch</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Re-score experts &amp; projects through 4 lenses (Discipline, Scale, Sector, Role/Recency) — like a senior bid director would.
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
            className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? "Rematching…" : "Re-score (preview only)"}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void runRematch(true)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            title="Re-score AND auto-apply Claude's selection recommendations"
          >
            Re-score + apply selections
          </button>
        </div>

        {loading && (
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
            <div className="h-2 w-2 animate-pulse rounded-full bg-slate-400" />
            <span>Claude is evaluating candidates across 4 perspectives… (15–25s)</span>
          </div>
        )}

        {result && !showResult && (
          <button
            type="button"
            onClick={() => setShowResult(true)}
            className="mt-3 text-xs font-medium text-slate-600 underline hover:text-slate-900"
          >
            Show last result
          </button>
        )}
      </div>

      {/* Result modal */}
      {result && showResult && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="AI rematch results"
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8"
          onClick={() => setShowResult(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative my-8 w-full max-w-4xl rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Rematch results</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {result.expertsUpdated} expert(s) and {result.projectsUpdated} project(s) re-scored across 4 perspectives.
                  {result.applySelections && " Selections were applied automatically."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowResult(false)}
                aria-label="Close results"
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            {/* Experts table */}
            {result.expertBatch?.assessments && result.expertBatch.assessments.length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Experts ({result.expertBatch.assessments.length})
                </p>
                <ul className="mt-2 space-y-2">
                  {[...result.expertBatch.assessments]
                    .sort((a, b) => b.overallScore - a.overallScore)
                    .map((a) => (
                      <li key={a.candidateId} className="rounded-lg border border-slate-100 bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900">{nameFor("EXPERT", a.candidateId)}</p>
                            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                              {(Object.keys(a.perspectives) as Perspective[]).map((p) => (
                                <div key={p} className="space-y-1">
                                  <div className="flex items-center justify-between text-[10px] text-slate-500">
                                    <span>{PERSPECTIVE_LABEL[p]}</span>
                                    <span className="font-medium text-slate-900">{a.perspectives[p]}/10</span>
                                  </div>
                                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                                    <div className={`h-full ${scoreColor(a.perspectives[p])}`} style={{ width: `${a.perspectives[p] * 10}%` }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                            {a.strength && <p className="mt-2 text-xs text-emerald-700">✓ {a.strength}</p>}
                            {a.concern && <p className="mt-1 text-xs text-amber-700">⚠ {a.concern}</p>}
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-2xl font-bold text-slate-900">{Math.round(a.overallScore * 100)}</p>
                            <p className="text-[10px] uppercase tracking-wide text-slate-500">overall</p>
                            {a.recommendSelection && (
                              <span className="mt-1 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                ✓ Select
                              </span>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                </ul>
              </div>
            )}

            {/* Projects table */}
            {result.projectBatch?.assessments && result.projectBatch.assessments.length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Projects ({result.projectBatch.assessments.length})
                </p>
                <ul className="mt-2 space-y-2">
                  {[...result.projectBatch.assessments]
                    .sort((a, b) => b.overallScore - a.overallScore)
                    .map((a) => (
                      <li key={a.candidateId} className="rounded-lg border border-slate-100 bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900">{nameFor("PROJECT", a.candidateId)}</p>
                            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                              {(Object.keys(a.perspectives) as Perspective[]).map((p) => (
                                <div key={p} className="space-y-1">
                                  <div className="flex items-center justify-between text-[10px] text-slate-500">
                                    <span>{PERSPECTIVE_LABEL[p]}</span>
                                    <span className="font-medium text-slate-900">{a.perspectives[p]}/10</span>
                                  </div>
                                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                                    <div className={`h-full ${scoreColor(a.perspectives[p])}`} style={{ width: `${a.perspectives[p] * 10}%` }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                            {a.strength && <p className="mt-2 text-xs text-emerald-700">✓ {a.strength}</p>}
                            {a.concern && <p className="mt-1 text-xs text-amber-700">⚠ {a.concern}</p>}
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-2xl font-bold text-slate-900">{Math.round(a.overallScore * 100)}</p>
                            <p className="text-[10px] uppercase tracking-wide text-slate-500">overall</p>
                            {a.recommendSelection && (
                              <span className="mt-1 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                ✓ Select
                              </span>
                            )}
                          </div>
                        </div>
                      </li>
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
