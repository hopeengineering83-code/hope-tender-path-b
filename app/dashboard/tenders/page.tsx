import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { StatusBadge } from "../../../components/status-badge";
import { formatDate, formatTenderStatus, parseTenderStatus } from "../../../lib/tender-workflow";
import { cleanClientName, cleanTenderTitle } from "../../../lib/engine/proposal-labels";
import { DuplicateButton } from "../history/duplicate-button";
import { SortSelect } from "./sort-select";

const STATUS_FILTERS = [
  "ALL",
  "DRAFT",
  "INTAKE",
  "ANALYZED",
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
  { value: "readinessScore_desc", label: "Readiness (high)" },
  { value: "readinessScore_asc", label: "Readiness (low)" },
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
  const isFiltered = status !== "ALL" || q !== "";

  const tenders = await prisma.tender.findMany({
    where: {
      userId,
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(q ? { title: { contains: q } } : {}),
    },
    select: {
      id: true, title: true, reference: true, clientName: true,
      deadline: true, status: true, category: true, budget: true, currency: true,
      readinessScore: true,
      createdAt: true, updatedAt: true,
      // Only counts — never fetch fileContent, extractedText, or base64 data
      _count: { select: { files: true, requirements: true } },
      complianceGaps: { select: { id: true, isResolved: true, severity: true } },
    },
    orderBy: buildOrderBy(sort),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tenders</h1>
          <p className="mt-1 text-slate-500">{tenders.length} tender{tenders.length !== 1 ? "s" : ""}</p>
        </div>
        <Link href="/dashboard/tenders/new" className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800">
          + New Tender
        </Link>
      </div>

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
          </div>
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
                className="rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
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
                  return (
                    <tr key={tender.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <p className="font-medium text-slate-900">{cleanTenderTitle(tender.title, { clientName: tender.clientName })}</p>
                        {(() => {
                          const c = cleanClientName(tender.clientName);
                          return c && c !== "Client" ? <p className="text-xs text-slate-400">{c}</p> : null;
                        })()}
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
                          <Link href={`/dashboard/tenders/${tender.id}`} className="text-blue-600 hover:underline">
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
            <div className="md:hidden divide-y">
              {tenders.map((tender) => {
                const unresolvedGaps = tender.complianceGaps.filter((gap) => !gap.isResolved).length;
                const criticalGaps = tender.complianceGaps.filter((gap) => !gap.isResolved && gap.severity === "CRITICAL").length;
                const clientName = cleanClientName(tender.clientName);
                return (
                  <div key={tender.id} className="p-4 flex flex-col gap-2 bg-white">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900 leading-snug">
                          {cleanTenderTitle(tender.title, { clientName: tender.clientName })}
                        </p>
                        {clientName && clientName !== "Client" && (
                          <p className="text-xs text-slate-400 mt-0.5">{clientName}</p>
                        )}
                      </div>
                      <StatusBadge status={tender.status} />
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <DeadlineCell deadline={tender.deadline} />
                      {tender.readinessScore != null ? (
                        <span className="text-slate-500">
                          Workflow: <span className="font-medium text-slate-700">{tender.readinessScore}%</span>
                        </span>
                      ) : null}
                      {unresolvedGaps > 0 && (
                        <span className={`text-xs ${criticalGaps > 0 ? "text-red-500" : "text-amber-500"}`}>
                          {unresolvedGaps} gaps
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <Link
                        href={`/dashboard/tenders/${tender.id}`}
                        className="rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                      >
                        Open workspace
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
