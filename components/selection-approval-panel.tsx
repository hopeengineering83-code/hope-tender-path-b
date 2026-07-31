"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";

export type MatchCandidate = {
  matchId: string;
  name: string;
  title?: string | null;
  score: number;
  rationale: string | null;
  isSelected: boolean;
  trustLevel: string;
};

export type SelectionApprovalPanelProps = {
  tenderId: string;
  experts: MatchCandidate[];
  projects: MatchCandidate[];
  canMutate: boolean;
};

/**
 * Displays the Engine's persisted evidence selection and permits an authorized
 * user to make an explicit exception. It is intentionally not an approval
 * gate: deterministic selections continue to downstream generation without a
 * browser-local confirmation step.
 *
 * The historical export name is retained to avoid a broad compatibility-only
 * rename across the consolidated recovery branch.
 */
export function SelectionApprovalPanel({ tenderId, experts, projects, canMutate }: SelectionApprovalPanelProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedExperts = experts.filter((expert) => expert.isSelected);
  const selectedProjects = projects.filter((project) => project.isSelected);
  const topExperts = [...experts].sort((a, b) => b.score - a.score).slice(0, 5);
  const topProjects = [...projects].sort((a, b) => b.score - a.score).slice(0, 5);

  const toggleMatch = useCallback(async (
    matchId: string,
    matchType: "expert" | "project",
    isSelected: boolean,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/tenders/${tenderId}/matches`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, matchType, isSelected }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update selection");
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Selection update failed");
    } finally {
      setBusy(false);
    }
  }, [tenderId, router]);

  const hasMatches = experts.length > 0 || projects.length > 0;
  const hasSelected = selectedExperts.length > 0 || selectedProjects.length > 0;

  if (!hasMatches) return null;

  return (
    <section id="selected-evidence" className="mb-4 rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Engine-selected evidence</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">Best-matched experts and projects</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            The Engine scored and persisted the strongest eligible candidates for this tender. Downstream processing continues automatically; authorized users may adjust a selection only when a documented exception is required.
          </p>
        </div>
        <div className="flex gap-3 text-xs lg:justify-end">
          <span className="rounded-full bg-indigo-100 px-3 py-1 font-semibold text-indigo-700">
            {selectedExperts.length} expert(s) selected
          </span>
          <span className="rounded-full bg-violet-100 px-3 py-1 font-semibold text-violet-700">
            {selectedProjects.length} project(s) selected
          </span>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">
            Top Expert Candidates
            <span className="ml-2 text-xs font-normal text-slate-400">(sorted by score)</span>
          </h3>
          <div className="space-y-2">
            {topExperts.map((expert) => (
              <div
                key={expert.matchId}
                className={`flex items-center gap-3 rounded-lg border p-2.5 text-xs transition-colors ${
                  expert.isSelected ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"
                }`}
              >
                <input
                  type="checkbox"
                  checked={expert.isSelected}
                  disabled={!canMutate || busy}
                  onChange={(event) => void toggleMatch(expert.matchId, "expert", event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  aria-label={`Select ${expert.name}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{expert.name}</p>
                  {expert.title && <p className="text-slate-500">{expert.title}</p>}
                  {expert.rationale && (
                    <p className="mt-0.5 text-[10px] text-slate-400">{expert.rationale.slice(0, 100)}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    expert.score >= 0.75 ? "bg-green-100 text-green-700" :
                    expert.score >= 0.5 ? "bg-amber-100 text-amber-800" :
                    "bg-slate-100 text-slate-600"
                  }`}>
                    {Math.round(expert.score * 100)}%
                  </span>
                  <span className="text-[10px] text-slate-400">{expert.trustLevel}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">
            Top Project Candidates
            <span className="ml-2 text-xs font-normal text-slate-400">(sorted by score)</span>
          </h3>
          <div className="space-y-2">
            {topProjects.map((project) => (
              <div
                key={project.matchId}
                className={`flex items-center gap-3 rounded-lg border p-2.5 text-xs transition-colors ${
                  project.isSelected ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"
                }`}
              >
                <input
                  type="checkbox"
                  checked={project.isSelected}
                  disabled={!canMutate || busy}
                  onChange={(event) => void toggleMatch(project.matchId, "project", event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  aria-label={`Select ${project.name}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{project.name}</p>
                  {project.title && <p className="text-slate-500">{project.title}</p>}
                  {project.rationale && (
                    <p className="mt-0.5 text-[10px] text-slate-400">{project.rationale.slice(0, 100)}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    project.score >= 0.75 ? "bg-green-100 text-green-700" :
                    project.score >= 0.5 ? "bg-amber-100 text-amber-800" :
                    "bg-slate-100 text-slate-600"
                  }`}>
                    {Math.round(project.score * 100)}%
                  </span>
                  <span className="text-[10px] text-slate-400">{project.trustLevel}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {!hasSelected && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No eligible expert or project is currently selected. Repair the source evidence or rerun matching; the workflow will resume automatically when eligible evidence is available.
        </div>
      )}
    </section>
  );
}
