import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { StatusBadge } from "../../../components/status-badge";
import { TENDER_STATUSES, formatDate, formatTenderStatus } from "../../../lib/tender-workflow";
import { DuplicateButton } from "./duplicate-button";

const STATUSES = ["ALL", ...TENDER_STATUSES] as const;

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const { q, status } = await searchParams;
  const activeStatus = status && STATUSES.includes(status as (typeof STATUSES)[number]) ? status : "ALL";

  const where = {
    userId,
    ...(activeStatus !== "ALL" ? { status: activeStatus } : {}),
    ...(q ? {
      OR: [
        { title: { contains: q } },
        { reference: { contains: q } },
        { clientName: { contains: q } },
        { category: { contains: q } },
      ],
    } : {}),
  };

  const tenders = await prisma.tender.findMany({
    where,
    include: {
      files: { select: { id: true } },
      requirements: { select: { id: true } },
      complianceGaps: { select: { id: true, isResolved: true } },
      generatedDocuments: { select: { id: true, generationStatus: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900">Tender History</h1>
          <p className="mt-0.5 text-sm text-slate-500">{tenders.length} tender{tenders.length !== 1 ? "s" : ""} found</p>
        </div>
        <Link href="/dashboard/tenders/new" className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800">New Tender</Link>
      </div>

      <form method="GET" className="flex flex-col gap-2 sm:flex-row">
        {activeStatus !== "ALL" && <input type="hidden" name="status" value={activeStatus} />}
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by title, reference, client, or category"
          className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        />
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800">Search</button>
          {q && <Link href={`/dashboard/history${activeStatus !== "ALL" ? `?status=${encodeURIComponent(activeStatus)}` : ""}`} className="rounded-lg border px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Clear</Link>}
        </div>
      </form>

      <form method="GET" className="flex items-end gap-2 rounded-xl border bg-white p-3 md:hidden">
        {q && <input type="hidden" name="q" value={q} />}
        <label className="min-w-0 flex-1 text-sm font-medium text-slate-700">
          <span className="mb-1 block text-xs text-slate-500">Filter by status</span>
          <select name="status" defaultValue={activeStatus} className="w-full rounded-lg border px-3 py-2 text-sm">
            {STATUSES.map((item) => (
              <option key={item} value={item}>{item === "ALL" ? "All statuses" : formatTenderStatus(item)}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Apply</button>
      </form>

      <nav aria-label="Tender status filters" className="hidden flex-wrap gap-2 text-xs md:flex">
        {STATUSES.map((item) => (
          <Link
            key={item}
            href={`/dashboard/history?${new URLSearchParams({ ...(q ? { q } : {}), ...(item !== "ALL" ? { status: item } : {}) })}`}
            className={`rounded-full border px-3 py-1 ${activeStatus === item ? "border-black bg-black text-white" : "border-slate-200 bg-white text-slate-600 hover:border-black"}`}
          >
            {item === "ALL" ? "All statuses" : formatTenderStatus(item)}
          </Link>
        ))}
      </nav>

      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        {tenders.length === 0 ? (
          <div className="py-12 text-center text-slate-400"><p>No tenders match your search.</p></div>
        ) : (
          <>
            <div className="divide-y md:hidden">
              {tenders.map((tender) => {
                const generated = tender.generatedDocuments.filter((document) => document.generationStatus === "GENERATED").length;
                return (
                  <article key={tender.id} className="space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h2 className="break-words font-semibold text-slate-900">{tender.title}</h2>
                        {tender.clientName && <p className="break-words text-xs text-slate-500">{tender.clientName}</p>}
                        {tender.reference && <p className="break-all text-xs text-slate-400">{tender.reference}</p>}
                      </div>
                      <StatusBadge status={tender.status} />
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500">
                      <dt>Deadline</dt><dd className="text-right text-slate-700">{formatDate(tender.deadline)}</dd>
                      <dt>Files</dt><dd className="text-right text-slate-700">{tender.files.length}</dd>
                      <dt>Generated docs</dt><dd className="text-right text-slate-700">{generated}</dd>
                      <dt>Created</dt><dd className="text-right text-slate-700">{formatDate(tender.createdAt)}</dd>
                    </dl>
                    <div className="flex flex-wrap items-center gap-3 border-t pt-3">
                      <Link href={`/dashboard/tenders/${tender.id}`} className="text-sm font-medium text-blue-600 hover:underline">Open workspace</Link>
                      <DuplicateButton tenderId={tender.id} />
                    </div>
                  </article>
                );
              })}
            </div>

            <table className="hidden w-full text-sm md:table">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Tender</th>
                  <th className="px-5 py-3 font-medium">Deadline</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="hidden px-5 py-3 font-medium lg:table-cell">Files</th>
                  <th className="hidden px-5 py-3 font-medium lg:table-cell">Docs</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                  <th className="whitespace-nowrap px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tenders.map((tender) => {
                  const generated = tender.generatedDocuments.filter((document) => document.generationStatus === "GENERATED").length;
                  return (
                    <tr key={tender.id} className="hover:bg-slate-50">
                      <td className="max-w-xs px-5 py-3">
                        <p className="break-words font-medium text-slate-900">{tender.title}</p>
                        {tender.clientName && <p className="truncate text-xs text-slate-400">{tender.clientName}</p>}
                        {tender.reference && <p className="truncate text-xs text-slate-400">{tender.reference}</p>}
                      </td>
                      <td className="px-5 py-3 text-slate-500">{formatDate(tender.deadline)}</td>
                      <td className="px-5 py-3"><StatusBadge status={tender.status} /></td>
                      <td className="hidden px-5 py-3 text-slate-500 lg:table-cell">{tender.files.length}</td>
                      <td className="hidden px-5 py-3 lg:table-cell">{generated > 0 ? <span className="font-medium text-green-600">{generated}</span> : <span className="text-slate-400">—</span>}</td>
                      <td className="px-5 py-3 text-xs text-slate-400">{formatDate(tender.createdAt)}</td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/dashboard/tenders/${tender.id}`} className="text-xs text-blue-600 hover:underline">Open</Link>
                          <DuplicateButton tenderId={tender.id} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
