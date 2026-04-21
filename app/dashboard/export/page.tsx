import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";

export default async function ExportPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const tenders = await prisma.tender.findMany({
    where: { userId },
    include: {
      generatedDocuments: true,
      complianceGaps: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 12,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Export Packages</h1>
        <p className="mt-1 text-sm text-slate-500">
          Review export readiness and prepare submission packages for each tender.
        </p>
      </div>

      <div className="space-y-4">
        {tenders.map((tender) => {
          const blockingGaps = tender.complianceGaps.filter(
            (gap) => !gap.isResolved && ["CRITICAL", "HIGH"].includes(gap.severity),
          ).length;
          const isExported = tender.status === "EXPORTED";

          return (
            <div key={tender.id} className="rounded-2xl border bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{tender.title}</h2>
                  <p className="text-sm text-slate-500">
                    {tender.generatedDocuments.length} generated docs · {blockingGaps} blocking gaps
                    {isExported && " · Exported"}
                  </p>
                </div>
                <Link href={`/dashboard/tenders/${tender.id}`} className="text-sm text-blue-600 hover:underline">
                  Open workspace
                </Link>
              </div>

              <div className="mt-4">
                {isExported ? (
                  <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                    Package exported and ready for submission.
                  </div>
                ) : blockingGaps > 0 ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {blockingGaps} blocking compliance gap{blockingGaps !== 1 ? "s" : ""} must be resolved before export.
                  </div>
                ) : tender.generatedDocuments.length === 0 ? (
                  <p className="text-sm text-slate-400">Run the tender engine first to generate documents.</p>
                ) : (
                  <p className="text-sm text-slate-400">Ready for export — open workspace to prepare package.</p>
                )}
              </div>
            </div>
          );
        })}
        {tenders.length === 0 && (
          <p className="text-slate-400 text-sm">No tenders found.</p>
        )}
      </div>
    </div>
  );
}
