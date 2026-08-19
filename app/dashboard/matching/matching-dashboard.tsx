"use client";

import Link from "next/link";
import {
  MatchingSelectedEvidencePanel,
  type SelectedEvidenceCandidate,
} from "../../../components/matching-selected-evidence-panel";

type Expert = { fullName: string; title?: string | null; trustLevel?: string | null };
type Project = { name: string; clientName?: string | null; trustLevel?: string | null };
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

type Pagination = { page: number; totalPages: number; totalTenders: number; perPage: number };

export function MatchingDashboard({ tenders, pagination }: { tenders: Tender[]; pagination: Pagination }) {
  return (
    <div className="min-w-0 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Matching and Selected Evidence</h1>
        <p className="mt-1 text-sm text-slate-600">
          Run Engine owns scoring and selection automatically. This page is a read-only view of persisted evidence across {pagination.totalTenders} tender{pagination.totalTenders === 1 ? "" : "s"}.
        </p>
      </header>

      {tenders.length === 0 ? (
        <div className="rounded-2xl border bg-white p-12 text-center shadow-sm">
          <p className="text-slate-600">Automatic verification running.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {tenders.map((tender) => {
            const experts = tender.expertMatches.map((match): SelectedEvidenceCandidate => ({
              id: match.id,
              name: match.expert.fullName,
              subtitle: match.expert.title ?? null,
              score: match.score,
              rationale: match.rationale ?? null,
              isSelected: match.isSelected,
              trustLevel: match.expert.trustLevel ?? "",
            }));
            const projects = tender.projectMatches.map((match): SelectedEvidenceCandidate => ({
              id: match.id,
              name: match.project.name,
              subtitle: match.project.clientName ?? null,
              score: match.score,
              rationale: match.rationale ?? null,
              isSelected: match.isSelected,
              trustLevel: match.project.trustLevel ?? "",
            }));

            return (
              <details key={tender.id} className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <summary className="cursor-pointer break-all text-base font-semibold text-slate-900">
                  {tender.title}
                </summary>
                <div className="mt-4">
                  <MatchingSelectedEvidencePanel
                    tenderId={tender.id}
                    experts={experts}
                    projects={projects}
                    sectionId={`matching-selected-evidence-${tender.id}`}
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    Showing persisted selections first and up to {tender.expertMatchCount} expert / {tender.projectMatchCount} project match records.
                  </p>
                </div>
              </details>
            );
          })}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <nav aria-label="Matching pages" className="flex flex-wrap items-center justify-center gap-2">
          {pagination.page > 1 && <Link href={`/dashboard/matching?page=${pagination.page - 1}`} className="min-h-10 rounded-lg border bg-white px-3 py-2 text-sm font-medium text-slate-700">Previous</Link>}
          <span className="text-sm text-slate-500">Page {pagination.page} of {pagination.totalPages}</span>
          {pagination.page < pagination.totalPages && <Link href={`/dashboard/matching?page=${pagination.page + 1}`} className="min-h-10 rounded-lg border bg-white px-3 py-2 text-sm font-medium text-slate-700">Next</Link>}
        </nav>
      )}
    </div>
  );
}
