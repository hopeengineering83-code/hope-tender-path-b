import Link from "next/link";
import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";
import { WarningIcon, ArrowRightIcon, ClockIcon } from "./icons";

export async function TenderNotificationsBanner() {
  const userId = await getSession();
  if (!userId) return null;
  try {
    await prismaReady;
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const [urgentTenders, criticalGapTenders] = await Promise.all([
      prisma.tender.findMany({
        where: { userId, status: { notIn: ["EXPORTED", "CLOSED"] }, deadline: { gte: now, lte: in7Days } },
        select: { id: true, title: true, deadline: true },
        orderBy: { deadline: "asc" },
        take: 5,
      }),
      prisma.tender.findMany({
        where: { userId, status: { notIn: ["EXPORTED", "CLOSED"] }, complianceGaps: { some: { isResolved: false, severity: "CRITICAL" } } },
        select: { id: true, title: true, _count: { select: { complianceGaps: { where: { isResolved: false, severity: "CRITICAL" } } } } },
        take: 5,
      }),
    ]);
    if (urgentTenders.length === 0 && criticalGapTenders.length === 0) return null;
    return (
      <div className="mb-4 flex flex-col gap-2">
        {urgentTenders.map((t) => {
          const daysLeft = Math.ceil((new Date(t.deadline!).getTime() - Date.now()) / 86_400_000);
          return (
            <div key={t.id} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm">
              <ClockIcon className="h-4 w-4 text-amber-600" />
              <span className="flex-1 text-amber-900"><strong>{(t.title ?? "Untitled").slice(0, 60)}</strong> — deadline in {daysLeft} day{daysLeft !== 1 ? "s" : ""}</span>
              <Link href={`/dashboard/tenders/${t.id}`} className="text-xs font-medium text-amber-800 underline inline-flex items-center gap-0.5">View <ArrowRightIcon className="inline h-3 w-3" /></Link>
            </div>
          );
        })}
        {criticalGapTenders.map((t) => {
          const count = t._count.complianceGaps;
          return (
            <div key={t.id} className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm">
              <WarningIcon className="h-4 w-4 text-red-600" />
              <span className="flex-1 text-red-900"><strong>{(t.title ?? "Untitled").slice(0, 60)}</strong> — {count} critical compliance gap{count !== 1 ? "s" : ""}</span>
              <Link href={`/dashboard/tenders/${t.id}`} className="text-xs font-medium text-red-700 underline inline-flex items-center gap-0.5">Review <ArrowRightIcon className="inline h-3 w-3" /></Link>
            </div>
          );
        })}
      </div>
    );
  } catch {
    return null;
  }
}
