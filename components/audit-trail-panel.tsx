import { getSession } from "../lib/auth";
import { prisma, prismaReady } from "../lib/prisma";

function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMs / 3_600_000);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffMs / 86_400_000);
  return `${diffDay}d ago`;
}

function formatTimestamp(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffDay = Math.floor(diffMs / 86_400_000);
  if (diffDay < 7) return relativeTime(date);
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function actionBadge(action: string): { label: string; className: string } {
  const a = action.toUpperCase();
  if (a.includes("CREATE")) return { label: "CREATE", className: "bg-blue-100 text-blue-700" };
  if (a.includes("UPDATE")) return { label: "UPDATE", className: "bg-amber-100 text-amber-700" };
  if (a.includes("DELETE")) return { label: "DELETE", className: "bg-red-100 text-red-700" };
  if (a.includes("ANALYZE") || a.includes("ANALYSIS")) return { label: "ANALYZE", className: "bg-violet-100 text-violet-700" };
  if (a.includes("EXPORT")) return { label: "EXPORT", className: "bg-emerald-100 text-emerald-700" };
  if (a.includes("REQUIREMENT")) return { label: "REQUIREMENT", className: "bg-indigo-100 text-indigo-700" };
  if (a.includes("SUBMISSION")) return { label: "SUBMISSION", className: "bg-cyan-100 text-cyan-700" };
  if (a.includes("METADATA") || a.includes("TENDER_FACTS")) return { label: "Tender Details", className: "bg-fuchsia-100 text-fuchsia-700" };
  return { label: action.slice(0, 12), className: "bg-slate-100 text-slate-600" };
}

type AuditLogLike = {
  id: string;
  action: string;
  entityType: string | null;
  description: string;
  createdAt: Date;
  user: { name: string | null; email: string | null } | null;
};

function AuditLogRow({ log }: { log: AuditLogLike }) {
  const badge = actionBadge(log.action);
  const actor = log.user?.name ?? log.user?.email ?? null;
  const ts = formatTimestamp(new Date(log.createdAt));
  return (
    <div className="flex items-start gap-3 px-5 py-2.5">
      <div className="mt-0.5 min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${badge.className}`}>{badge.label}</span>
          {log.entityType && <span className="text-xs font-medium text-slate-500">{log.entityType}</span>}
          <span className="text-xs text-slate-400">{ts}</span>
          {actor && <span className="text-xs text-slate-400">by {actor}</span>}
        </div>
        <p className="mt-0.5 text-sm text-slate-700">{log.description}</p>
      </div>
    </div>
  );
}

export async function AuditTrailPanel({ tenderId }: { tenderId: string }) {
  const userId = await getSession();
  if (!userId) return null;

  try {
    await prismaReady;
    const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId }, select: { id: true } });
    if (!tender) return null;

    const logs = await prisma.auditLog.findMany({
      where: { entityId: tenderId },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { user: { select: { name: true, email: true } } },
    });

    if (logs.length === 0) return null;

    const latest = logs.slice(0, 3) as AuditLogLike[];
    const older = logs.slice(3) as AuditLogLike[];
    const filterLabels = ["Tender Details", "Submission Plan", "Requirement", "Generate", "Export", "Manual Override"];

    return (
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900">Audit Trail</h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{logs.length}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {filterLabels.map((label) => (
              <span key={label} className="rounded-full bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-500">{label}</span>
            ))}
          </div>
        </div>

        <div className="divide-y">
          {latest.map((log) => <AuditLogRow key={log.id} log={log} />)}
        </div>

        {older.length > 0 && (
          <details className="border-t bg-slate-50 px-5 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">Show full audit trail ({logs.length})</summary>
            <div className="mt-3 divide-y rounded-lg border bg-white">
              {older.map((log) => <AuditLogRow key={log.id} log={log} />)}
            </div>
          </details>
        )}
      </div>
    );
  } catch {
    return null;
  }
}
