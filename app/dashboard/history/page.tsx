import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { StatusBadge } from "../../../components/status-badge";
import { formatDate } from "../../../lib/tender-workflow";
import { DuplicateButton } from "./duplicate-button";

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const { q, status } = await searchParams;

  const where = {
    userId,
    ...(status && status !== "ALL" ? { status } : {}),
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
      files: { select: { id:true } },
      requirements: { select: { id:true } },
      complianceGaps: { select: { id:true, isResolved:true } },
      generatedDocuments: { select: { id:true, generationStatus:true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const STATUSES = ["ALL","DRAFT","INTAKE","ANALYZED","MATCHED","COMPLIANCE_REVIEW","GENERATED","APPROVED","EXPORTED","CLOSED"];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tender History</h1>
          <p className="mt-0.5 text-sm text-slate-500">{tenders.length} tender{tenders.length!==1?"s":""} found</p>
        </div>
        <Link href="/dashboard/tenders/new" className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800">+ New Tender</Link>
      </div>

      <form method="GET" className="flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search by title, reference, client, category…"
          className="flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black" />
        <button type="submit" className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800">Search</button>
        {q && <Link href="/dashboard/history" className="rounded-lg border px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Clear</Link>}
      </form>

      <div className="flex flex-wrap gap-2 text-xs">
        {STATUSES.map(s => (
          <Link key={s}
            href={`/dashboard/history?${new URLSearchParams({ ...(q?{q}:{}), ...(s!=="ALL"?{status:s}:{}) })}`}
            className={`rounded-full px-3 py-1 border ${(status??"ALL")===s?"bg-black text-white border-black":"bg-white text-slate-600 border-slate-200 hover:border-black"}`}>
            {s}
          </Link>
        ))}
      </div>

      <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
        {tenders.length===0 ? (
          <div className="py-12 text-center text-slate-400"><p>No tenders match your search.</p></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500 text-xs">
              <tr>
                <th className="px-5 py-3 font-medium">Tender</th>
                <th className="px-5 py-3 font-medium hidden md:table-cell">Deadline</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium hidden lg:table-cell">Files</th>
                <th className="px-5 py-3 font-medium hidden lg:table-cell">Docs</th>
                <th className="px-5 py-3 font-medium hidden md:table-cell">Created</th>
                <th className="px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tenders.map(t => {
                const generated = t.generatedDocuments.filter(d=>d.generationStatus==="GENERATED").length;
                return (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-900">{t.title}</p>
                      {t.clientName && <p className="text-xs text-slate-400">{t.clientName}</p>}
                      {t.reference && <p className="text-xs text-slate-400">{t.reference}</p>}
                    </td>
                    <td className="px-5 py-3 text-slate-500 hidden md:table-cell">{formatDate(t.deadline)}</td>
                    <td className="px-5 py-3"><StatusBadge status={t.status} /></td>
                    <td className="px-5 py-3 text-slate-500 hidden lg:table-cell">{t.files.length}</td>
                    <td className="px-5 py-3 hidden lg:table-cell">
                      {generated>0 ? <span className="text-green-600 font-medium">{generated}</span> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-5 py-3 text-slate-400 text-xs hidden md:table-cell">{formatDate(t.createdAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <Link href={`/dashboard/tenders/${t.id}`} className="text-xs text-blue-600 hover:underline">Open</Link>
                        <DuplicateButton tenderId={t.id} />
                      </div>
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
