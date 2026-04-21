import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";

export default async function CompliancePage() {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const tenders = await prisma.tender.findMany({
    where: { userId },
    include: {
      complianceGaps: { orderBy: { createdAt: "desc" } },
      requirements: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 12,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Compliance Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Review mandatory gaps, evidence support signals, and export blockers before submission packaging.
        </p>
      </div>

      <div className="space-y-4">
        {tenders.map((tender) => {
          const unresolved = tender.complianceGaps.filter((gap) => !gap.isResolved);
          return (
            <div key={tender.id} className="rounded-2xl border bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{tender.title}</h2>
                  <p className="text-sm text-slate-500">{tender.requirements.length} requirements · {unresolved.length} unresolved gaps</p>
                </div>
                <Link href={`/dashboard/tenders/${tender.id}`} className="text-sm text-blue-600 hover:underline">Open workspace</Link>
              </div>

              <div className="mt-4 space-y-2">
                {unresolved.slice(0, 5).map((gap) => (
                  <div key={gap.id} className="rounded-xl border px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-slate-900">{gap.title}</p>
                      <span className="text-xs font-medium text-amber-700">{gap.severity}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{gap.description}</p>
                    {gap.mitigationPlan && <p className="mt-1 text-xs text-slate-500">Mitigation: {gap.mitigationPlan}</p>}
                  </div>
                ))}
                {unresolved.length === 0 && <p className="text-sm text-slate-400">No unresolved compliance gaps.</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
