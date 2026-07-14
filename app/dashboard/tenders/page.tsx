import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { StatusBadge } from "../../../components/status-badge";
import { formatDate, formatTenderStatus, parseTenderStatus } from "../../../lib/tender-workflow";
import { cleanClientName, cleanTenderTitle } from "../../../lib/engine/proposal-labels";
import { DuplicateButton } from "../history/duplicate-button";
import { SortSelect } from "./sort-select";
import { TenderSearchBar } from "../../../components/tender-search-bar";
import { TenderNotificationsBanner } from "../../../components/tender-notifications-banner";

const STATUS_FILTERS = [
  "ALL",
  "DRAFT",
  "INTAKE",
  "ANALYZED",
  "AI_ANALYZED",
  "AI_ANALYSIS_PARTIAL",
  "FALLBACK_DRAFT_CREATED",
  "ANALYSIS_REQUIRES_REVIEW",
  "MATCHED",
  "COMPLIANCE_REVIEW",
  "READY_FOR_GENERATION",
  "GENERATED",
  "IN_REVIEW",
  "APPROVED",
  "EXPORTED",
  "CLOSED",
] as const;

const SORT_OPTIONS = [
  { value: "createdAt_desc", label: "Newest first" },
  { value: "createdAt_asc", label: "Oldest first" },
  { value: "deadline_asc", label: "Deadline (soonest)" },
  { value: "deadline_desc", label: "Deadline (latest)" },
  { value: "readinessScore_desc", label: "Workflow Progress (high)" },
  { value: "readinessScore_asc", label: "Workflow Progress (low)" },
  { value: "status_asc", label: "Status A–Z" },
] as const;

type SortOption = (typeof SORT_OPTIONS)[number]["value"];

function parseSortOption(raw: string): SortOption {
  return SORT_OPTIONS.find((o) => o.value === raw)?.value ?? "createdAt_desc";
}

function buildOrderBy(sort: SortOption): { [key: string]: "asc" | "desc" } {
  const [field, dir] = sort.split("_") as [string, "asc" | "desc"];
  return { [field]: dir };
}

/** Returns JSX for a deadline cell with urgency coloring. */
function DeadlineCell({ deadline }: { deadline: Date | null }) {
  if (!deadline) {
    return <span className="text-slate-400">No deadline</span>;
  }
  const daysLeft = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86_400_000);
  if (daysLeft < 0) {
    return <span className="font-medium text-red-600">⚠ Overdue ({formatDate(deadline)})</span>;
  }
  if (daysLeft <= 7) {
    return <span className="font-medium text-red-500">⚠ {daysLeft}d left ({formatDate(deadline)})</span>;
  }
  if (daysLeft <= 14) {
    return <span className="text-amber-500">⏰ {daysLeft}d left ({formatDate(deadline)})</span>;
  }
  return <span className="text-slate-500">{formatDate(deadline)}</span>;
}

/** Returns JSX for a mobile deadline with pulsing red dot when ≤ 3 days. */
function MobileDeadlineCell({ deadline }: { deadline: Date | null }) {
  if (!deadline) {
    return <span className="text-slate-400">No deadline</span>;
  }
  const daysLeft = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86_400_000);
  if (daysLeft < 0) {
    return <span className="font-medium text-red-600"><span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse mr-1" />Overdue ({formatDate(deadline)})</span>;
  }
  if (daysLeft <= 3) {
    return <span className="font-medium text-red-500"><span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse mr-1" />{daysLeft}d left ({formatDate(deadline)})</span>;
  }
  if (daysLeft <= 7) {
    return <span className="font-medium text-red-500">⚠ {daysLeft}d left ({formatDate(deadline)})</span>;
  }
  if (daysLeft <= 14) {
    return <span className="text-amber-500">⏰ {daysLeft}d left ({formatDate(deadline)})</span>;
  }
  return <span className="text-slate-500">{formatDate(deadline)}</span>;
}

// Pipeline stage order and display config
const STAGE_ORDER = [
  "TENDER_INTAKE",
  "ANALYSIS_COMPLETE",
  "PLAN_CONFIRMED",
  "DOCUMENTS_GENERATED",
  "EXPORT_READY",
  "EXPORTED",
] as const;

type PipelineStage = (typeof STAGE_ORDER)[number];

const STAGE_LABELS: Record<PipelineStage, string> = {
  TENDER_INTAKE: "Intake",
  ANALYSIS_COMPLETE: "Analysed",
  PLAN_CONFIRMED: "Plan Confirmed",
  DOCUMENTS_GENERATED: "Docs Generated",
  EXPORT_READY: "Export Ready",
  EXPORTED: "Exported",
};

const STAGE_COLORS: Record<PipelineStage, string> = {
  TENDER_INTAKE: "bg-slate-100 text-slate-600",
  ANALYSIS_COMPLETE: "bg-blue-100 text-blue-700",
  PLAN_CONFIRMED: "bg-violet-100 text-violet-700",
  DOCUMENTS_GENERATED: "bg-amber-100 text-amber-700",
  EXPORT_READY: "bg-emerald-100 text-emerald-700",
  EXPORTED: "bg-green-100 text-green-700",
};

function StageBadge({ stage }: { stage: string | null }) {
  if (!stage) return null;
  const label = STAGE_LABELS[stage as PipelineStage] ?? stage.replace(/_/g, " ");
  const color = STAGE_COLORS[stage as PipelineStage] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${color}`}>
      {label}
    </span>
  );
}

function isUrgentRow(deadline: Date | null, tenderStatus: string): boolean {
  if (!deadline) return false;
  if (tenderStatus === "EXPORTED" || tenderStatus === "CLOSED") return false;
  const daysLeft = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86_400_000);
  return daysLeft >= 0 && daysLeft <= 7;
}

function parseAnalysisSource(notes?: string | null): "AI" | "PARTIAL" | "REGEX" | null {
  if (!notes) return null;
  for (const line of notes.split("\n")) {
    if (/^Analysis source:/i.test(line.trim())) {
      if (/regex fallback/i.test(line)) return "REGEX";
      if (/partial/i.test(line)) return "PARTIAL";
      if (/\bAI\b/i.test(line)) return "AI";
    }
  }
  return null;
}

export default async function TendersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; sort?: string }>;
}) {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const { status = "ALL", q = "", sort: sortRaw = "createdAt_desc" } = await searchParams;
  const statusFilter = parseTenderStatus(status);
  const sort = parseSortOption(sortRaw);
  // Special pseudo-filter: show only tenders with regex fallback analysis
  const regexOnlyFilter = status === "REGEX_FALLBACK";
  const isFiltered = status !== "ALL" || q !== "";

  const [tenders, allTenders] = await Promise.all([
    prisma.tender.findMany({
      where: {
        userId,
        ...(statusFilter && !regexOnlyFilter ? { status: statusFilter } : {}),
        ...(q ? { title: { contains: q } } : {}),
        ...(regexOnlyFilter ? { notes: { contains: "Analysis source: Regex fallback" } } : {}),
      },
      select: {
        id: true, title: true, reference: true, clientName: true, procuringEntityName: true,
        deadline: true, status: true, category: true, budget: true, currency: true,
        readinessScore: true,
        notes: true,
        stage: true,
        createdAt: true, updatedAt: true,
        _count: { select: { files: true, requirements: true } },
        complianceGaps: { select: { id: true, isResolved: true, severity: true } },
      },
      orderBy: buildOrderBy(sort),
    }),
    // Always load all tenders for KPI summary (no filter, small payload)
    prisma.tender.findMany({
      where: { userId },
      select: { id: true, status: true, stage: true, deadline: true, readinessScore: true },
    }),
  ]);

  // KPI derivations
  const now = new Date();
  const kpi = {
    total: allTenders.length,
    draft: allTenders.filter((t) => t.status === "DRAFT").length,
    exported: allTenders.filter((t) => t.status === "EXPORTED").length,
    generated: allTenders.filter((t) => t.status === "GENERATED" || t.status === "IN_REVIEW" || t.status === "APPROVED").length,
    inProgress: allTenders.filter((t) => !["EXPORTED", "CLOSED", "DRAFT"].includes(t.status)).length,
    urgentDeadlines: allTenders.filter((t) => {
      if (!t.deadline || t.status === "EXPORTED" || t.status === "CLOSED") return false;
      const daysLeft = Math.ceil((new Date(t.deadline).getTime() - now.getTime()) / 86_400_000);
      return daysLeft >= 0 && daysLeft <= 7;
    }).length,
    overdue: allTenders.filter((t) => {
      if (!t.deadline || t.status === "EXPORTED" || t.status === "CLOSED") return false;
      return new Date(t.deadline) < now;
    }).length,
  };

  // Stage counts for pipeline visualization
  const stageCounts = STAGE_ORDER.reduce<Record<string, number>>((acc, s) => {
    acc[s] = allTenders.filter((t) => t.stage === s).length;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <TenderNotificationsBanner />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tenders</h1>
          <p className="mt-1 text-slate-500">{kpi.total} total · {tenders.length} shown</p>
        </div>
        <Link href="/dashboard/tenders/new" className="flex min-h-11 items-center rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800">
          + New Tender
        </Link>
      </div>

      {/* Status summary bar + pipeline stage strip */}
      {kpi.total > 0 && (
        <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
          <div className="grid grid-cols-3 divide-x sm:grid-cols-6">
            <div className="p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{kpi.total}</p>
              <p className="text-xs text-slate-500 mt-0.5">Total</p>
            </div>
            <div className="p-4 text-center">
              <p className="text-2xl font-bold text-slate-400">{kpi.draft}</p>
              <p className="text-xs text-slate-400 mt-0.5">Draft</p>
            </div>
            <div className="p-4 text-center">
              <p className="text-2xl font-bold text-blue-700">{kpi.inProgress}</p>
              <p className="text-xs text-slate-500 mt-0.5">In Progress</p>
            </div>
            <div className="p-4 text-center">
              <p className="text-2xl font-bold text-amber-700">{kpi.generated}</p>
              <p className="text-xs text-slate-500 mt-0.5">Generated</p>
            </div>
            <div className="p-4 text-center bg-emerald-50">
              <p className="text-2xl font-bold text-emerald-700">{kpi.exported}</p>
              <p className="text-xs text-emerald-600 mt-0.5">Exported</p>
            </div>
            <div className={`p-4 text-center ${kpi.overdue > 0 ? "bg-red-50" : kpi.urgentDeadlines > 0 ? "bg-amber-50" : ""}`}>
              {kpi.overdue > 0 ? (
                <>
                  <p className="text-2xl font-bold text-red-700">{kpi.overdue}</p>
                  <p className="text-xs text-red-600 mt-0.5">Overdue</p>
                </>
              ) : (
                <>
                  <p className={`text-2xl font-bold ${kpi.urgentDeadlines > 0 ? "text-amber-700" : "text-slate-400"}`}>{kpi.urgentDeadlines}</p>
                  <p className={`text-xs mt-0.5 ${kpi.urgentDeadlines > 0 ? "text-amber-600" : "text-slate-400"}`}>Due &le;7d</p>
                </>
              )}
            </div>
          </div>
          {/* Pipeline stage strip */}
          <div className="border-t bg-slate-50 px-4 py-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Pipeline stages</p>
            <div className="flex flex-wrap gap-2">
              {STAGE_ORDER.map((stage) => {
                const count = stageCounts[stage] ?? 0;
                return (
                  <div key={stage} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium ${STAGE_COLORS[stage]}`}>
                    <span>{STAGE_LABELS[stage]}</span>
                    <span className="font-bold">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border bg-white shadow-sm">
        {/* Filter bar */}
        <div className="flex flex-col gap-3 border-b p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <form className="flex-1" method="GET">
              <input
                name="q"
                defaultValue={q}
                placeholder="Search tenders"
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black"
              />
              <input type="hidden" name="status" value={status} />
              <input type="hidden" name="sort" value={sort} />
            </form>
            <SortSelect currentSort={sort} />
          </div>
          <div className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((filterValue) => (
              <Link
                key={filterValue}
                href={`/dashboard/tenders?status=${filterValue}&sort=${sort}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  status === filterValue ? "bg-black text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {filterValue === "ALL" ? "All" : formatTenderStatus(filterValue)}
              </Link>
            ))}
            <Link
              href={`/dashboard/tenders?status=REGEX_FALLBACK&sort=${sort}`}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                status === "REGEX_FALLBACK" ? "bg-red-700 text-white" : "bg-red-50 text-red-700 hover:bg-red-100"
              }`}
              title="Tenders analyzed by regex fallback — AI providers failed. These need re-analysis."
            >
              Needs re-analysis
            </Link>
          </div>
        </div>

        {/* Live search bar + result count */}
        <div className="border-b px-4 pt-3">
          <Suspense fallback={null}>
            <TenderSearchBar />
          </Suspense>
          <p className="mb-2 text-xs text-slate-500">{tenders.length} tender{tenders.length !== 1 ? "s" : ""}{q ? ` matching "${q}"` : ""}</p>
        </div>

        {/* Empty states */}
        {tenders.length === 0 ? (
          isFiltered ? (
            <div className="flex flex-col items-center py-16 text-center">
              <p className="text-slate-500 font-medium">No tenders match this filter</p>
              <Link
                href="/dashboard/tenders"
                className="mt-2 text-sm text-blue-600 hover:underline"
              >
                Clear filters
              </Link>
            </div>
          ) : (
            <div className="flex flex-col items-center py-16 text-center px-6">
              <div className="text-5xl mb-4">📋</div>
              <h2 className="text-lg font-semibold text-slate-900 mb-2">No tenders yet</h2>
              <p className="text-slate-500 text-sm max-w-sm mb-6">
                Upload your first tender document to get started with AI-powered analysis and proposal generation.
              </p>
              <Link
                href="/dashboard/tenders/new"
                className="flex min-h-11 items-center rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
              >
                Upload First Tender
              </Link>
            </div>
          )
        ) : (
          <>
            {/* Desktop table — hidden on mobile */}
            <table className="hidden md:table w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Title</th>
                  <th className="px-6 py-3 font-medium">Reference</th>
                  <th className="px-6 py-3 font-medium">Deadline</th>
                  <th className="px-6 py-3 font-medium">Workflow Progress</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tenders.map((tender) => {
                  const unresolvedGaps = tender.complianceGaps.filter((gap) => !gap.isResolved).length;
                  const criticalGaps = tender.complianceGaps.filter((gap) => !gap.isResolved && gap.severity === "CRITICAL").length;
                  const urgent = isUrgentRow(tender.deadline, tender.status);
                  return (
                    <tr key={tender.id} className={`hover:bg-slate-50 ${urgent ? "bg-amber-50/60 hover:bg-amber-50" : ""}`}>
                      <td className="px-6 py-4">
                        <p className="font-medium text-slate-900">{cleanTenderTitle(tender.title, { clientName: tender.clientName || tender.procuringEntityName })}</p>
                        {(() => {
                          const c = cleanClientName(tender.clientName || tender.procuringEntityName);
                          return c && c !== "Client" ? <p className="text-xs text-slate-400">{c}</p> : null;
                        })()}
                        {tender.stage && (
                          <div className="mt-1">
                            <StageBadge stage={tender.stage} />
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-slate-500">{tender.reference || "—"}</td>
                      <td className="px-6 py-4">
                        <DeadlineCell deadline={tender.deadline} />
                      </td>
                      <td className="px-6 py-4 text-slate-500">
                        {tender.readinessScore != null ? (
                          <span className="font-medium text-slate-700">{tender.readinessScore}%</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                        {(() => {
                          const src = parseAnalysisSource(tender.notes);
                          if (!src) return null;
                          if (src === "REGEX") return <span className="ml-1 rounded bg-red-100 px-1 py-0.5 text-[10px] font-semibold text-red-700" title="Analysis by regex fallback — AI providers failed. Re-run AI Analyze.">REGEX</span>;
                          if (src === "PARTIAL") return <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-700" title="Partial AI analysis — some chunks failed.">PARTIAL</span>;
                          return <span className="ml-1 rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-semibold text-emerald-700" title="Analyzed by AI.">AI</span>;
                        })()}
                        <span className="ml-1 text-xs text-slate-400 italic">(workflow)</span>
                        <span className="ml-1 text-xs text-slate-400">
                          ({tender._count.files} files · {tender._count.requirements} reqs
                          {unresolvedGaps > 0 && (
                            <span className={criticalGaps > 0 ? "text-red-500" : "text-amber-500"}>
                              {" "}· {unresolvedGaps} gaps
                            </span>
                          )})
                        </span>
                      </td>
                      <td className="px-6 py-4"><StatusBadge status={tender.status} /></td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <Link href={`/dashboard/tenders/${tender.id}`} className="inline-flex min-h-11 items-center text-blue-600 hover:underline">
                            Open workspace
                          </Link>
                          <DuplicateButton tenderId={tender.id} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Mobile card list — hidden on md+ */}
            <div className="md:hidden divide-y gap-y-0">
              {tenders.map((tender) => {
                const unresolvedGaps = tender.complianceGaps.filter((gap) => !gap.isResolved).length;
                const criticalGaps = tender.complianceGaps.filter((gap) => !gap.isResolved && gap.severity === "CRITICAL").length;
                const clientName = cleanClientName(tender.clientName || tender.procuringEntityName);
                const mobileUrgent = isUrgentRow(tender.deadline, tender.status);
                return (
                  <div key={tender.id} className={`p-4 flex flex-col gap-2 ${mobileUrgent ? "bg-amber-50/60" : "bg-white"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900 leading-snug">
                          {cleanTenderTitle(tender.title, { clientName: tender.clientName || tender.procuringEntityName })}
                        </p>
                        {clientName && clientName !== "Client" && (
                          <p className="text-xs text-slate-400 mt-0.5">{clientName}</p>
                        )}
                        {tender.stage && (
                          <div className="mt-1">
                            <StageBadge stage={tender.stage} />
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <StatusBadge status={tender.status} />
                        {(() => {
                          const src = parseAnalysisSource(tender.notes);
                          if (!src) return null;
                          if (src === "REGEX") return <span className="rounded bg-red-100 px-1 py-0.5 text-[10px] font-semibold text-red-700" title="Analysis by regex fallback — AI providers failed. Re-run AI Analyze.">REGEX</span>;
                          if (src === "PARTIAL") return <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-700" title="Partial AI analysis — some chunks failed.">PARTIAL</span>;
                          return <span className="rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-semibold text-emerald-700" title="Analyzed by AI.">AI</span>;
                        })()}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <MobileDeadlineCell deadline={tender.deadline} />
                      {unresolvedGaps > 0 && (
                        <span className={`text-xs ${criticalGaps > 0 ? "text-red-500" : "text-amber-500"}`}>
                          {unresolvedGaps} gaps
                        </span>
                      )}
                    </div>

                    {/* Readiness bar */}
                    {tender.readinessScore != null && (
                      <div className="h-1 rounded-full bg-slate-100">
                        <div className="h-1 rounded-full bg-emerald-400" style={{ width: `${tender.readinessScore}%` }} />
                      </div>
                    )}

                    {/* Bottom action row */}
                    <div className="flex items-center gap-2 pt-1">
                      <Link
                        href={`/dashboard/tenders/${tender.id}`}
                        className="flex min-h-11 items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
                      >
                        Open
                      </Link>
                      <DuplicateButton tenderId={tender.id} />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
