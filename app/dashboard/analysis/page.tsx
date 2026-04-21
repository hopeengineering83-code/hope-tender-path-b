import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { formatDate } from "../../../lib/tender-workflow";

export default async function AnalysisPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const tenders = await prisma.tender.findMany({
    where: { userId },
    include: { requirements: true, files: true },
    orderBy: { updatedAt: "desc" },
    take: 12,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Tender Analysis</h1>
        <p className="mt-1 text-sm text-slate-500">
          Run extraction on a tender to create structured requirements, file naming rules, and analysis summaries.
        </p>
      </div>

      <div className="rounded-2xl border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-6 py-3 font-medium">Tender</th>
              <th className="px-6 py-3 font-medium">Files</th>
              <th className="px-6 py-3 font-medium">Requirements</th>
              <th className="px-6 py-3 font-medium">Last Engine Run</th>
              <th className="px-6 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {tenders.map((tender) => (
              <tr key={tender.id} className="hover:bg-slate-50">
                <td className="px-6 py-4">
                  <p className="font-medium text-slate-900">{tender.title}</p>
                  <p className="text-xs text-slate-500">{tender.analysisSummary || "No analysis summary yet."}</p>
                </td>
                <td className="px-6 py-4 text-slate-500">{tender.files.length}</td>
                <td className="px-6 py-4 text-slate-500">{tender.requirements.length}</td>
                <td className="px-6 py-4 text-slate-500">{formatDate(tender.lastEngineRunAt)}</td>
                <td className="px-6 py-4">
                  <Link href={`/dashboard/tenders/${tender.id}`} className="text-blue-600 hover:underline">
                    Open workspace
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
