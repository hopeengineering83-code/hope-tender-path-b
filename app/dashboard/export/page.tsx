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
      exportPackages: { orderBy: { createdAt: "desc" } },
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
          Review export readiness, package records, and final submission preparation state.
        </p>
      </div>

      <div className="space-y-4">
        {tenders.map((tender) => {
          const blockingGaps = tender.complianceGaps.filter(
            (gap) => !gap.isResolved && ["CRITICAL", "HIGH"].includes(gap.severity),
          ).length;

          return (
            <div key={tender.id} className="rounded-2xl border bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{tender.title}</h2>
                  <p className="text-sm text-slate-500">
                    {tender.generatedDocuments.length} generated docs · {blockingGaps} blocking gaps · {tender.exportPackages.length} package records
                  </p>
                </div>
                <Link href={`/dashboard/tenders/${tender.id}`} className="text-sm text-blue-600 hover:underline">Open workspace</Link>
              </div>

              <div className="mt-4 space-y-2">
                {tender.exportPackages.length === 0 ? (
                  <p className="text-sm text-slate-400">No export packages prepared yet.</p>
                ) : (
                  tender.exportPackages.map((pkg) => (
                    <div key={pkg.id} className="rounded-xl border px-4 py-3 text-sm">
                      <p className="font-medium text-slate-900">{pkg.name}</p>
                      <p className="text-xs text-slate-500">{pkg.format} · {pkg.exportStatus}</p>
                      {pkg.storagePath && (
                        <Link href={`/api/export-packages/${pkg.id}/download`} className="mt-2 inline-block text-xs text-blue-600 hover:underline">
                          Download package
                        </Link>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
