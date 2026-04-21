import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { StatusBadge } from "../../../components/status-badge";
import { formatDate, formatTenderStatus, parseTenderStatus } from "../../../lib/tender-workflow";

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

export default async function TendersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const { status = "ALL", q = "" } = await searchParams;
  const statusFilter = parseTenderStatus(status);

  const tenders = await prisma.tender.findMany({
    where: {
      userId,
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
    },
    include: {
      files: true,
      requirements: true,
      complianceGaps: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tenders</h1>
          <p className="mt-1 text-slate-500">{tenders.length} tenders</p>
        </div>
        <Link href="/dashboard/tenders/new" className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800">
          + New Tender
        </Link>
      </div>

      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row">
          <form className="flex-1" method="GET">
            <input
              name="q"
              defaultValue={q}
              placeholder="Search tenders"
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black"
            />
            <input type="hidden" name="status" value={status} />
          </form>
          <div className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((filterValue) => (
              <Link
                key={filterValue}
                href={`/dashboard/tenders?status=${filterValue}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  status === filterValue ? "bg-black text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {filterValue === "ALL" ? "All" : formatTenderStatus(filterValue)}
              </Link>
            ))}
          </div>
        </div>

        {tenders.length === 0 ? (
          <div className="py-16 text-center text-slate-400">No tenders found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-6 py-3 font-medium">Title</th>
                <th className="px-6 py-3 font-medium">Reference</th>
                <th className="px-6 py-3 font-medium">Deadline</th>
                <th className="px-6 py-3 font-medium">Readiness</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tenders.map((tender) => {
                const unresolvedGaps = tender.complianceGaps.filter((gap) => !gap.isResolved).length;
                return (
                  <tr key={tender.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 font-medium text-slate-900">{tender.title}</td>
                    <td className="px-6 py-4 text-slate-500">{tender.reference || "—"}</td>
                    <td className="px-6 py-4 text-slate-500">{formatDate(tender.deadline)}</td>
                    <td className="px-6 py-4 text-slate-500">{tender.files.length} files · {tender.requirements.length} reqs · {unresolvedGaps} gaps</td>
                    <td className="px-6 py-4"><StatusBadge status={tender.status} /></td>
                    <td className="px-6 py-4">
                      <Link href={`/dashboard/tenders/${tender.id}`} className="text-blue-600 hover:underline">
                        Open workspace
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
