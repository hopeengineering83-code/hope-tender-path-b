"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { CheckIcon, ChevronDownIcon, WarningIcon } from "../../../components/icons";

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
  if (level === "REVIEWED") {
    return <span className="inline-flex items-center gap-1 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700"><CheckIcon /> REVIEWED</span>;
  }
  if (level === "AI_DRAFT") return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">AI DRAFT</span>;
  return <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">DRAFT — review needed</span>;
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.round(score * 100));
  const color = pct >= 75 ? "bg-green-500" : pct >= 40 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex min-w-0 items-center gap-2" aria-label={`Match score ${pct} percent`}>
      <div className="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-slate-100 sm:w-24 sm:flex-none">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`shrink-0 text-xs font-semibold ${pct >= 75 ? "text-green-700" : pct >= 40 ? "text-amber-600" : "text-red-500"}`}>
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
  const [error, setError] = useState<string | null>(null);

  const toggleMatch = useCallback(async (
    tenderId: string,
    matchId: string,
    matchType: "expert" | "project",
    isSelected: boolean,
  ) => {
    setTogglingId(matchId);
    setError(null);
    try {
      const response = await fetch(`/api/tenders/${tenderId}/matches`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, matchType, isSelected }),
      });

      if (response.ok) {
        setTenders((previous) => previous.map((tender) => {
          if (tender.id !== tenderId) return tender;
          if (matchType === "expert") {
            return {
              ...tender,
              expertMatches: tender.expertMatches.map((match) => match.id === matchId ? { ...match, isSelected } : match),
            };
          }
          return {
            ...tender,
            projectMatches: tender.projectMatches.map((match) => match.id === matchId ? { ...match, isSelected } : match),
          };
        }));
      } else {
        let errorMessage = "Server rejected the selection change.";
        try {
          const body = await response.json();
          if (body?.error) errorMessage = body.error;
        } catch {
          // Non-JSON errors still use the safe message above.
        }
        setError(`${errorMessage} (HTTP ${response.status}). Reverting to server state.`);

        try {
          const authoritativeResponse = await fetch(`/api/tenders/${tenderId}/matches`, { cache: "no-store" });
          if (authoritativeResponse.ok) {
            const authoritative = await authoritativeResponse.json();
            setTenders((previous) => previous.map((tender) => tender.id === tenderId
              ? {
                  ...tender,
                  expertMatches: authoritative.expertMatches ?? tender.expertMatches,
                  projectMatches: authoritative.projectMatches ?? tender.projectMatches,
                }
              : tender));
          }
        } catch {
          // The visible error already tells the user the state may be stale.
        }
      }
    } catch (reason) {
      setError(`Network error: ${reason instanceof Error ? reason.message : "unknown"}. Selection may be stale.`);
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

  const hasTenderWithoutSelection = tenders.some((tender) =>
    tender.expertMatches.every((match) => !match.isSelected)
    && tender.projectMatches.every((match) => !match.isSelected));

  return (
    <div className="min-w-0 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Matching Engine</h1>
        <p className="mt-1 text-sm text-slate-600">
          Showing {tenders.length} of {pagination.totalTenders} tenders · Page {pagination.page} of {pagination.totalPages}
        </p>
      </header>

      {/* REVIEWED-only guidance banner — only REVIEWED records can be used for final generation */}
      <div role="status" className="flex min-w-0 items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-800">
        <WarningIcon className="mt-0.5 shrink-0" />
        <p className="min-w-0 break-words text-sm font-medium">
          Only REVIEWED experts and projects can be used for final document generation.{" "}
          <a href="/dashboard/company/review" className="font-semibold underline hover:no-underline">Review knowledge records</a>
        </p>
      </div>

      {error && (
        <div role="alert" className="flex min-w-0 items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-red-800">
          <WarningIcon className="mt-0.5 shrink-0" />
          <p className="min-w-0 break-words text-sm font-medium">{error}</p>
        </div>
      )}

      {hasTenderWithoutSelection && (
        <div role="status" className="flex min-w-0 items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-800">
          <WarningIcon className="mt-0.5 shrink-0" />
          <p className="min-w-0 break-words text-sm font-medium">
            One or more tenders have no selected matches. This is a blocking evidence gap — generation is locked until relevant evidence is linked.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {tenders.map((tender) => {
          const selectedExperts = tender.expertMatches.filter((match) => match.isSelected).length;
          const selectedProjects = tender.projectMatches.filter((match) => match.isSelected).length;
          const isExpanded = expandedTender === tender.id;

          return (
            <section key={tender.id} className="min-w-0 rounded-2xl border bg-white shadow-sm">
              <button
                type="button"
                onClick={() => setExpandedTender(isExpanded ? null : tender.id)}
                aria-expanded={isExpanded}
                aria-controls={`matching-${tender.id}`}
                className="flex min-h-14 w-full min-w-0 items-start justify-between gap-3 p-4 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-lg font-semibold text-slate-900">{tender.title}</span>
                  <span className="mt-1 block break-words text-xs text-slate-500">
                    {selectedExperts} expert{selectedExperts !== 1 ? "s" : ""} · {selectedProjects} project{selectedProjects !== 1 ? "s" : ""} selected · {tender.expertMatchCount} total expert matches, {tender.projectMatchCount} total project matches
                  </span>
                </span>
                <ChevronDownIcon className={`mt-1 shrink-0 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
              </button>

              {isExpanded && (
                <div id={`matching-${tender.id}`} className="border-t p-3 sm:p-4">
                  <div className="grid min-w-0 gap-6 lg:grid-cols-2">
                    <div className="min-w-0">
                      <h2 className="mb-2 text-sm font-semibold text-slate-700">Experts ({selectedExperts} selected)</h2>
                      <div className="space-y-2">
                        {tender.expertMatches.length === 0 && <p className="text-xs text-slate-400">No expert matches.</p>}
                        {tender.expertMatches.map((match) => (
                          <article key={match.id} className="min-w-0 rounded-lg border p-3">
                            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0 flex-1">
                                <p className="break-words text-sm font-medium text-slate-900">{match.expert.fullName}</p>
                                {match.expert.title && <p className="break-words text-xs text-slate-500">{match.expert.title}</p>}
                                <div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                                  <TrustBadge level={match.expert.trustLevel} />
                                  <ScoreBar score={match.score} />
                                </div>
                                {match.rationale && <p className="mt-2 line-clamp-3 break-words text-[10px] text-slate-500">{match.rationale}</p>}
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleMatch(tender.id, match.id, "expert", !match.isSelected)}
                                disabled={togglingId === match.id}
                                aria-pressed={match.isSelected}
                                className={`min-h-10 shrink-0 rounded px-3 py-2 text-xs font-medium ${match.isSelected ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-slate-100 text-slate-600 hover:bg-slate-200"} disabled:opacity-50`}
                              >
                                {togglingId === match.id ? "Saving…" : match.isSelected ? <span className="inline-flex items-center gap-1"><CheckIcon /> Selected</span> : "Select"}
                              </button>
                            </div>
                          </article>
                        ))}
                        {tender.expertMatchCount > tender.expertMatches.length && (
                          <p className="text-xs text-slate-400">Showing top {tender.expertMatches.length} of {tender.expertMatchCount} matches.</p>
                        )}
                      </div>
                    </div>

                    <div className="min-w-0">
                      <h2 className="mb-2 text-sm font-semibold text-slate-700">Projects ({selectedProjects} selected)</h2>
                      <div className="space-y-2">
                        {tender.projectMatches.length === 0 && <p className="text-xs text-slate-400">No project matches.</p>}
                        {tender.projectMatches.map((match) => (
                          <article key={match.id} className="min-w-0 rounded-lg border p-3">
                            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0 flex-1">
                                <p className="break-words text-sm font-medium text-slate-900">{match.project.name}</p>
                                {match.project.clientName && <p className="break-words text-xs text-slate-500">{match.project.clientName}</p>}
                                <div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                                  <TrustBadge level={match.project.trustLevel} />
                                  <ScoreBar score={match.score} />
                                </div>
                                {match.rationale && <p className="mt-2 line-clamp-3 break-words text-[10px] text-slate-500">{match.rationale}</p>}
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleMatch(tender.id, match.id, "project", !match.isSelected)}
                                disabled={togglingId === match.id}
                                aria-pressed={match.isSelected}
                                className={`min-h-10 shrink-0 rounded px-3 py-2 text-xs font-medium ${match.isSelected ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-slate-100 text-slate-600 hover:bg-slate-200"} disabled:opacity-50`}
                              >
                                {togglingId === match.id ? "Saving…" : match.isSelected ? <span className="inline-flex items-center gap-1"><CheckIcon /> Selected</span> : "Select"}
                              </button>
                            </div>
                          </article>
                        ))}
                        {tender.projectMatchCount > tender.projectMatches.length && (
                          <p className="text-xs text-slate-400">Showing top {tender.projectMatches.length} of {tender.projectMatchCount} matches.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {pagination.totalPages > 1 && (
        <nav aria-label="Matching pages" className="flex flex-wrap items-center justify-center gap-2">
          {pagination.page > 1 && (
            <Link href={`/dashboard/matching?page=${pagination.page - 1}`} className="min-h-10 rounded-lg border bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Previous</Link>
          )}
          <span className="text-sm text-slate-500">Page {pagination.page} of {pagination.totalPages}</span>
          {pagination.page < pagination.totalPages && (
            <Link href={`/dashboard/matching?page=${pagination.page + 1}`} className="min-h-10 rounded-lg border bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Next</Link>
          )}
        </nav>
      )}
    </div>
  );
}
