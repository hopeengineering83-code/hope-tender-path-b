"use client";

import { useState } from "react";
import Link from "next/link";

type Expert = { id: string; fullName: string; title?: string | null; disciplines: string; sectors: string };
type Project = { id: string; name: string; clientName?: string | null; sector?: string | null; contractValue?: number | null; currency?: string | null };
type ExpertMatch = { id: string; score: number; rationale?: string | null; isSelected: boolean; expert: Expert };
type ProjectMatch = { id: string; score: number; rationale?: string | null; isSelected: boolean; project: Project };
type Tender = { id: string; title: string; expertMatches: ExpertMatch[]; projectMatches: ProjectMatch[] };

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.round(score * 100));
  const color = pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-semibold ${pct >= 70 ? "text-green-700" : pct >= 40 ? "text-amber-600" : "text-red-500"}`}>
        {pct}%
      </span>
    </div>
  );
}

export function MatchingDashboard({ tenders: initial }: { tenders: Tender[] }) {
  const [tenders, setTenders] = useState(initial);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [expandedTender, setExpandedTender] = useState<string | null>(initial[0]?.id ?? null);

  async function toggleMatch(tenderId: string, matchId: string, matchType: "expert" | "project", isSelected: boolean) {
    setTogglingId(matchId);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/matches`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, matchType, isSelected }),
      });
      if (res.ok) {
        setTenders((prev) =>
          prev.map((t) => {
            if (t.id !== tenderId) return t;
            if (matchType === "expert") {
              return { ...t, expertMatches: t.expertMatches.map((m) => m.id === matchId ? { ...m, isSelected } : m) };
            } else {
              return { ...t, projectMatches: t.projectMatches.map((m) => m.id === matchId ? { ...m, isSelected } : m) };
            }
          })
        );
      }
    } finally {
      setTogglingId(null);
    }
  }

  if (tenders.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">Matching Engine</h1>
        <div className="rounded-2xl border bg-white p-12 text-center shadow-sm">
          <p className="text-slate-400">No tenders with match data yet. Run the engine on a tender to generate matches.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Matching Engine</h1>
        <p className="mt-1 text-sm text-slate-500">
          Review ranked experts and project references. Toggle selection to include or exclude from proposal.
        </p>
      </div>

      <div className="space-y-4">
        {tenders.map((tender) => {
          const selectedExperts = tender.expertMatches.filter((m) => m.isSelected).length;
          const selectedProjects = tender.projectMatches.filter((m) => m.isSelected).length;
          const isExpanded = expandedTender === tender.id;

          return (
            <div key={tender.id} className="rounded-2xl border bg-white shadow-sm">
              <div
                className="flex cursor-pointer items-center justify-between gap-4 p-6"
                onClick={() => setExpandedTender(isExpanded ? null : tender.id)}
              >
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{tender.title}</h2>
                  <p className="text-sm text-slate-500">
                    {tender.expertMatches.length} expert candidates · {tender.projectMatches.length} project candidates
                    {(selectedExperts + selectedProjects > 0) && (
                      <span className="ml-2 text-green-600">· {selectedExperts} experts + {selectedProjects} projects selected</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Link
                    href={`/dashboard/tenders/${tender.id}`}
                    className="rounded border px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Open workspace
                  </Link>
                  <span className="text-slate-400">{isExpanded ? "▲" : "▼"}</span>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t px-6 pb-6 pt-4">
                  <div className="grid gap-6 lg:grid-cols-2">
                    <div>
                      <p className="mb-3 text-sm font-semibold text-slate-700">
                        Experts
                        <span className="ml-1.5 font-normal text-slate-400">({selectedExperts} selected)</span>
                      </p>
                      <div className="space-y-2">
                        {tender.expertMatches.length === 0 && (
                          <p className="text-sm text-slate-400">No expert matches yet.</p>
                        )}
                        {tender.expertMatches.map((match) => {
                          const disciplines = (() => { try { return JSON.parse(match.expert.disciplines) as string[]; } catch { return []; } })();
                          const isBusy = togglingId === match.id;
                          return (
                            <div key={match.id} className={`rounded-xl border px-4 py-3 transition-colors ${match.isSelected ? "border-green-300 bg-green-50" : "hover:bg-slate-50"}`}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="font-medium text-slate-900">{match.expert.fullName}</p>
                                  {match.expert.title && <p className="text-xs text-slate-500">{match.expert.title}</p>}
                                  <div className="mt-1.5 flex flex-wrap gap-1">
                                    {disciplines.slice(0, 3).map((d) => (
                                      <span key={d} className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">{d}</span>
                                    ))}
                                  </div>
                                  <div className="mt-2">
                                    <ScoreBar score={match.score} />
                                  </div>
                                  {match.rationale && (
                                    <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">{match.rationale}</p>
                                  )}
                                </div>
                                <button
                                  onClick={() => toggleMatch(tender.id, match.id, "expert", !match.isSelected)}
                                  disabled={isBusy}
                                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                                    match.isSelected
                                      ? "bg-green-600 text-white hover:bg-green-700"
                                      : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                                  }`}
                                >
                                  {isBusy ? "…" : match.isSelected ? "✓ Selected" : "Select"}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <p className="mb-3 text-sm font-semibold text-slate-700">
                        Projects
                        <span className="ml-1.5 font-normal text-slate-400">({selectedProjects} selected)</span>
                      </p>
                      <div className="space-y-2">
                        {tender.projectMatches.length === 0 && (
                          <p className="text-sm text-slate-400">No project matches yet.</p>
                        )}
                        {tender.projectMatches.map((match) => {
                          const isBusy = togglingId === match.id;
                          return (
                            <div key={match.id} className={`rounded-xl border px-4 py-3 transition-colors ${match.isSelected ? "border-green-300 bg-green-50" : "hover:bg-slate-50"}`}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="font-medium text-slate-900">{match.project.name}</p>
                                  {match.project.clientName && <p className="text-xs text-slate-500">{match.project.clientName}</p>}
                                  {match.project.sector && (
                                    <span className="mt-1 inline-block rounded bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-700">{match.project.sector}</span>
                                  )}
                                  <div className="mt-2">
                                    <ScoreBar score={match.score} />
                                  </div>
                                  {match.rationale && (
                                    <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">{match.rationale}</p>
                                  )}
                                </div>
                                <button
                                  onClick={() => toggleMatch(tender.id, match.id, "project", !match.isSelected)}
                                  disabled={isBusy}
                                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                                    match.isSelected
                                      ? "bg-green-600 text-white hover:bg-green-700"
                                      : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                                  }`}
                                >
                                  {isBusy ? "…" : match.isSelected ? "✓ Selected" : "Select"}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
