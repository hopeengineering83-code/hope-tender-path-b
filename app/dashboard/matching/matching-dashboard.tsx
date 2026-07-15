"use client";

import { useState, useCallback } from "react";
import Link from "next/link";

type Expert = { id: string; fullName: string; title?: string | null; disciplines: string; sectors: string; trustLevel?: string | null };
type Project = { id: string; name: string; clientName?: string | null; sector?: string | null; contractValue?: number | null; currency?: string | null; trustLevel?: string | null };
type ExpertMatch = { id: string; score: number; rationale?: string | null; isSelected: boolean; expert: Expert };
type ProjectMatch = { id: string; score: number; rationale?: string | null; isSelected: boolean; project: Project };
type Tender = {
  id: string;
  title: string;
  expertMatchCount: number;
  projectMatchCount: number;
  expertMatches: ExpertMatch[];
  projectMatches: ProjectMatch[];
};

type Pagination = {
  page: number;
  totalPages: number;
  totalTenders: number;
  perPage: number;
};

function TrustBadge({ level }: { level?: string | null }) {
  if (level === "REVIEWED") return <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">✓ REVIEWED</span>;
  if (level === "AI_DRAFT") return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">AI DRAFT</span>;
  return <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">DRAFT — review needed</span>;
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.round(score * 100));
  const color = pct >= 75 ? "bg-green-500" : pct >= 40 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-semibold ${pct >= 75 ? "text-green-700" : pct >= 40 ? "text-amber-600" : "text-red-500"}`}>
        {pct}%
      </span>
    </div>
  );
}

export function MatchingDashboard({
  tenders: initial,
  pagination,
}: {
  tenders: Tender[];
  pagination: Pagination;
}) {
  const [tenders, setTenders] = useState(initial);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [expandedTender, setExpandedTender] = useState<string | null>(initial[0]?.id ?? null);
  const [expandedMatches, setExpandedMatches] = useState<Set<string>>(new Set());
  // GLM-A2 Issue #1135 Gap #6: Surface server rejection errors
  const [error, setError] = useState<string | null>(null);

  function toggleMatch_(id: string) {
    setExpandedMatches((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // GLM-A2 Issue #1135 Gap #6: Surface server rejection and re-fetch
  // authoritative state. Previously, non-OK responses were silently
  // ignored, leaving stale optimistic state.
  const toggleMatch = useCallback(async (tenderId: string, matchId: string, matchType: "expert" | "project", isSelected: boolean) => {
    setTogglingId(matchId);
    setError(null);
    try {
      const res = await fetch(`/api/tenders/${tenderId}/matches`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, matchType, isSelected }),
      });

      if (res.ok) {
        // Optimistic update is safe — server confirmed
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
      } else {
        // GLM-A2 Issue #1135 Gap #6: Server rejected — surface the error
        // and re-fetch authoritative state.
        let errorMsg = "Server rejected the selection change.";
        try {
          const body = await res.json();
          if (body?.error) errorMsg = body.error;
        } catch { /* non-JSON error */ }
        setError(`${errorMsg} (HTTP ${res.status}). Reverting to server state.`);

        // Re-fetch authoritative state for this tender
        try {
          const refetch = await fetch(`/api/tenders/${tenderId}/matches`, { cache: "no-store" });
          if (refetch.ok) {
            const authoritative = await refetch.json();
            setTenders((prev) =>
              prev.map((t) => {
                if (t.id !== tenderId) return t;
                return {
                  ...t,
                  expertMatches: authoritative.expertMatches ?? t.expertMatches,
                  projectMatches: authoritative.projectMatches ?? t.projectMatches,
                };
              })
            );
          }
        } catch {
          // Re-fetch failed — the error message above is shown
        }
      }
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : "unknown"}. Selection may be stale.`);
    } finally {
      setTogglingId(null);
    }
  }, []);

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
        <p className="mt-1 text-sm text-slate-600">
          Showing {tenders.length} of {pagination.totalTenders} tenders · Page {pagination.page} of {pagination.totalPages}
        </p>
      </div>

      {/* GLM-A2 Issue #1135 Gap #6: Error banner */}
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3">
          <p className="text-sm font-medium text-red-800">⚠ {error}</p>
        </div>
      )}

      {/* GLM-A2 Issue #1135 Gap #5: No-candidate warning */}
      {tenders.some((t) => t.expertMatches.every((m) => !m.isSelected) && t.projectMatches.every((m) => !m.isSelected)) && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-800">
            ⚠ One or more tenders have no selected matches. This is a blocking evidence gap — generation is locked until relevant evidence is linked.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {tenders.map((tender) => {
          const selectedExperts = tender.expertMatches.filter((m) => m.isSelected).length;
          const selectedProjects = tender.projectMatches.filter((m) => m.isSelected).length;
          const isExpanded = expandedTender === tender.id;

          return (
            <div key={tender.id} className="rounded-2xl border bg-white shadow-sm">
              <button
                onClick={() => setExpandedTender(isExpanded ? null : tender.id)}
                className="flex w-full items-center justify-between p-4 text-left"
              >
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{tender.title}</h2>
                  <p className="text-xs text-slate-500">
                    {selectedExperts} expert{selectedExperts !== 1 ? "s" : ""} · {selectedProjects} project{selectedProjects !== 1 ? "s" : ""} selected
                    {" · "}
                    {tender.expertMatchCount} total expert matches, {tender.projectMatchCount} total project matches
                  </p>
                </div>
                <span className="text-slate-400">{isExpanded ? "▲" : "▼"}</span>
              </button>

              {isExpanded && (
                <div className="border-t p-4">
                  <div className="grid gap-6 lg:grid-cols-2">
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-slate-700">
                        Experts ({selectedExperts} selected)
                      </h3>
                      <div className="space-y-2">
                        {tender.expertMatches.length === 0 && (
                          <p className="text-xs text-slate-400">No expert matches.</p>
                        )}
                        {tender.expertMatches.map((match) => (
                          <div key={match.id} className="rounded-lg border p-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-slate-900">{match.expert.fullName}</p>
                                {match.expert.title && <p className="text-xs text-slate-500">{match.expert.title}</p>}
                                <div className="mt-1 flex items-center gap-2">
                                  <TrustBadge level={match.expert.trustLevel} />
                                  <ScoreBar score={match.score} />
                                </div>
                                {match.rationale && (
                                  <p className="mt-1 text-[10px] text-slate-400 line-clamp-2">{match.rationale}</p>
                                )}
                              </div>
                              <button
                                onClick={() => toggleMatch(tender.id, match.id, "expert", !match.isSelected)}
                                disabled={togglingId === match.id}
                                className={`rounded px-2 py-1 text-xs font-medium ${
                                  match.isSelected
                                    ? "bg-green-100 text-green-700 hover:bg-green-200"
                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                } disabled:opacity-50`}
                              >
                                {togglingId === match.id ? "..." : match.isSelected ? "✓ Selected" : "Select"}
                              </button>
                            </div>
                          </div>
                        ))}
                        {tender.expertMatchCount > tender.expertMatches.length && (
                          <p className="text-xs text-slate-400">
                            Showing top {tender.expertMatches.length} of {tender.expertMatchCount} matches.
                          </p>
                        )}
                      </div>
                    </div>

                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-slate-700">
                        Projects ({selectedProjects} selected)
                      </h3>
                      <div className="space-y-2">
                        {tender.projectMatches.length === 0 && (
                          <p className="text-xs text-slate-400">No project matches.</p>
                        )}
                        {tender.projectMatches.map((match) => (
                          <div key={match.id} className="rounded-lg border p-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-slate-900">{match.project.name}</p>
                                {match.project.clientName && <p className="text-xs text-slate-500">{match.project.clientName}</p>}
                                <div className="mt-1 flex items-center gap-2">
                                  <TrustBadge level={match.project.trustLevel} />
                                  <ScoreBar score={match.score} />
                                </div>
                                {match.rationale && (
                                  <p className="mt-1 text-[10px] text-slate-400 line-clamp-2">{match.rationale}</p>
                                )}
                              </div>
                              <button
                                onClick={() => toggleMatch(tender.id, match.id, "project", !match.isSelected)}
                                disabled={togglingId === match.id}
                                className={`rounded px-2 py-1 text-xs font-medium ${
                                  match.isSelected
                                    ? "bg-green-100 text-green-700 hover:bg-green-200"
                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                } disabled:opacity-50`}
                              >
                                {togglingId === match.id ? "..." : match.isSelected ? "✓ Selected" : "Select"}
                              </button>
                            </div>
                          </div>
                        ))}
                        {tender.projectMatchCount > tender.projectMatches.length && (
                          <p className="text-xs text-slate-400">
                            Showing top {tender.projectMatches.length} of {tender.projectMatchCount} matches.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* GLM-A2 Issue #1135 Gap #5: Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {pagination.page > 1 && (
            <Link
              href={`/dashboard/matching?page=${pagination.page - 1}`}
              className="rounded-lg border bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Previous
            </Link>
          )}
          <span className="text-sm text-slate-500">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          {pagination.page < pagination.totalPages && (
            <Link
              href={`/dashboard/matching?page=${pagination.page + 1}`}
              className="rounded-lg border bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
