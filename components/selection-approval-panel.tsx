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

export function SelectionApprovalPanel({ tenderId, experts, projects, canMutate }: SelectionApprovalPanelProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);

  const selectedExperts = experts.filter((e) => e.isSelected);
  const selectedProjects = projects.filter((p) => p.isSelected);
  const topExperts = [...experts].sort((a, b) => b.score - a.score).slice(0, 5);
  const topProjects = [...projects].sort((a, b) => b.score - a.score).slice(0, 5);

  const toggleMatch = useCallback(async (matchId: string, matchType: "expert" | "project", isSelected: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/matches`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, matchType, isSelected }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update selection");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Selection update failed");
    } finally {
      setBusy(false);
    }
  }, [tenderId, router]);

  const approveSelection = useCallback(async () => {
    setApproved(true);
    router.refresh();
  }, [router]);

  const hasMatches = experts.length > 0 || projects.length > 0;
  const hasSelected = selectedExperts.length > 0 || selectedProjects.length > 0;

  if (!hasMatches) return null;

  return (
    <section id="selection-approval" className="mb-4 rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Step 7 · Selection Approval</p>
          <h2 className="mt-1 text-lg font-bold text-slate-900">Review and approve best-matched experts and projects</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            The engine scored and auto-selected the best candidates based on your tender requirements.
            Review the scores below, change selections if needed, then approve to proceed to generation.
          </p>
        </div>
        <div className="flex flex-col gap-2 lg:items-end">
          <div className="flex gap-3 text-xs">
            <span className="rounded-full bg-indigo-100 px-3 py-1 font-semibold text-indigo-700">
              {selectedExperts.length} expert(s) selected
            </span>
            <span className="rounded-full bg-violet-100 px-3 py-1 font-semibold text-violet-700">
              {selectedProjects.length} project(s) selected
            </span>
          </div>
          {canMutate && hasSelected && !approved && (
            <button
              type="button"
              onClick={() => void approveSelection()}
              disabled={busy}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Approve Selection & Continue
            </button>
          )}
          {approved && (
            <span className="rounded-lg bg-emerald-100 px-4 py-2 text-sm font-semibold text-emerald-700">
              ✓ Selection Approved
            </span>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Top Experts */}
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
                  onChange={(e) => void toggleMatch(expert.matchId, "expert", e.target.checked)}
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

        {/* Top Projects */}
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
                  onChange={(e) => void toggleMatch(project.matchId, "project", e.target.checked)}
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
          No experts or projects are currently selected. Select at least one candidate above, then click &ldquo;Approve Selection & Continue&rdquo; to proceed to document generation.
        </div>
      )}
    </section>
  );
}
