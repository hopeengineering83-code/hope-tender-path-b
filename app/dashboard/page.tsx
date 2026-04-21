import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth";
import { prisma, prismaReady } from "../../lib/prisma";
import { StatusBadge } from "../../components/status-badge";
import { formatDate } from "../../lib/tender-workflow";

export default async function DashboardPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const [tenders, company] = await Promise.all([
    prisma.tender.findMany({
      where: { userId },
      include: {
        files: true,
        requirements: true,
        complianceGaps: true,
        generatedDocuments: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.company.findUnique({ where: { userId } }),
  ]);

  const now = new Date();
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const stats = {
    total: tenders.length,
    analyzed: tenders.filter((t) => ["ANALYZED", "MATCHED", "COMPLIANCE_REVIEW", "READY_FOR_GENERATION", "GENERATED", "IN_REVIEW", "APPROVED", "EXPORTED", "CLOSED"].includes(t.status)).length,
    unresolvedGaps: tenders.reduce((sum, t) => sum + t.complianceGaps.filter((gap) => !gap.isResolved).length, 0),
    dueSoon: tenders.filter((t) => {
      if (!t.deadline) return false;
      const deadline = new Date(t.deadline);
      return deadline >= now && deadline <= in7days;
    }).length,
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-slate-500">Welcome back{company ? `, ${company.name}` : ""}.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Total Tenders", value: stats.total },
          { label: "Analyzed+", value: stats.analyzed },
          { label: "Unresolved Gaps", value: stats.unresolvedGaps },
          { label: "Due in 7 Days", value: stats.dueSoon },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">{item.label}</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr),minmax(320px,1fr)]">
        <div className="rounded-2xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <h2 className="font-semibold text-slate-900">Live tender pipeline</h2>
            <Link href="/dashboard/tenders/new" className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800">
              + New Tender
            </Link>
          </div>
          {tenders.length === 0 ? (
            <div className="py-12 text-center text-slate-400">No tenders yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Title</th>
                  <th className="px-6 py-3 font-medium">Deadline</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Engine</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tenders.slice(0, 6).map((tender) => (
                  <tr key={tender.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 font-medium text-slate-900">{tender.title}</td>
                    <td className="px-6 py-4 text-slate-500">{formatDate(tender.deadline)}</td>
                    <td className="px-6 py-4"><StatusBadge status={tender.status} /></td>
                    <td className="px-6 py-4 text-slate-500">{tender.files.length} files · {tender.requirements.length} reqs · {tender.generatedDocuments.length} docs</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="space-y-4">
          <Link href="/dashboard/analysis" className="block rounded-2xl border bg-white p-5 shadow-sm transition hover:border-black">
            <p className="font-semibold text-slate-900">Tender Analysis</p>
            <p className="mt-1 text-sm text-slate-500">Extract requirements, file order, templates, and restrictions.</p>
          </Link>
          <Link href="/dashboard/matching" className="block rounded-2xl border bg-white p-5 shadow-sm transition hover:border-black">
            <p className="font-semibold text-slate-900">Matching Engine</p>
            <p className="mt-1 text-sm text-slate-500">Rank experts, projects, and evidence for each tender.</p>
          </Link>
          <Link href="/dashboard/compliance" className="block rounded-2xl border bg-white p-5 shadow-sm transition hover:border-black">
            <p className="font-semibold text-slate-900">Compliance</p>
            <p className="mt-1 text-sm text-slate-500">Detect unsupported mandatory requirements before generation.</p>
          </Link>
          <Link href="/dashboard/export" className="block rounded-2xl border bg-white p-5 shadow-sm transition hover:border-black">
            <p className="font-semibold text-slate-900">Exports</p>
            <p className="mt-1 text-sm text-slate-500">Prepare submission-ready DOCX, PDF, and ZIP packages.</p>
          </Link>
        </div>
      </div>
    </div>
  );
}
