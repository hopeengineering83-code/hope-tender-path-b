import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth";
import { prisma, prismaReady } from "../../lib/prisma";
import { StatusBadge } from "../../components/status-badge";
import { formatDate, formatTenderStatus } from "../../lib/tender-workflow";
import { isAIEnabled } from "../../lib/ai";

export default async function DashboardPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const tenderIds = await prisma.tender.findMany({ where: { userId }, select: { id: true } }).then((r) => r.map((t) => t.id));

  const [tenders, company, recentActivity, generatedDocStats] = await Promise.all([
    prisma.tender.findMany({
      where: { userId },
      select: {
        id: true, title: true, clientName: true, procuringEntityName: true, status: true, deadline: true,
        readinessScore: true, budget: true, currency: true, createdAt: true,
        bidOutcome: true,
        _count: { select: { requirements: true } },
        complianceGaps: { select: { isResolved: true, severity: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.company.findUnique({ where: { userId } }),
    prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    tenderIds.length > 0 ? prisma.generatedDocument.groupBy({
      by: ["reviewStatus"],
      where: { tenderId: { in: tenderIds }, generationStatus: { not: "SUPERSEDED" } },
      _count: { _all: true },
    }) : Promise.resolve([]),
  ]);

  const now = new Date();
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in3days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const overdue = tenders.filter((t) => t.deadline && new Date(t.deadline) < now && !["EXPORTED", "CLOSED"].includes(t.status));
  const dueSoon3 = tenders.filter((t) => {
    if (!t.deadline) return false;
    const d = new Date(t.deadline);
    return d >= now && d <= in3days && !["EXPORTED", "CLOSED"].includes(t.status);
  });
  const dueSoon7 = tenders.filter((t) => {
    if (!t.deadline) return false;
    const d = new Date(t.deadline);
    return d >= now && d <= in7days && !["EXPORTED", "CLOSED"].includes(t.status);
  });

  const tendersWithOutcome = tenders.filter((t) => t.bidOutcome && t.bidOutcome !== "PENDING");
  const wonCount = tendersWithOutcome.filter((t) => t.bidOutcome === "WON").length;
  const winRate = tendersWithOutcome.length > 0 ? Math.round((wonCount / tendersWithOutcome.length) * 100) : null;

  const activeBudgets = tenders.filter((t) => !["DRAFT", "CLOSED"].includes(t.status) && t.budget);
  const pipelineValue = activeBudgets.reduce((sum, t) => sum + (t.budget ?? 0), 0);

  const scoredTenders = tenders.filter((t) => (t.readinessScore ?? 0) > 0);
  const avgReadiness = scoredTenders.length > 0
    ? Math.round(scoredTenders.reduce((s, t) => s + (t.readinessScore ?? 0), 0) / scoredTenders.length)
    : null;

  const stats = {
    total: tenders.length,
    inProgress: tenders.filter((t) => !["DRAFT", "EXPORTED", "CLOSED"].includes(t.status)).length,
    criticalGaps: tenders.reduce((sum, t) => sum + t.complianceGaps.filter((g: { isResolved: boolean; severity: string }) => !g.isResolved && g.severity === "CRITICAL").length, 0),
    highGaps: tenders.reduce((sum, t) => sum + t.complianceGaps.filter((g: { isResolved: boolean; severity: string }) => !g.isResolved && g.severity === "HIGH").length, 0),
    dueSoon: dueSoon7.length,
    overdue: overdue.length,
  };

  const totalGenDocs = generatedDocStats.reduce((s, g) => s + g._count._all, 0);
  const exportReadyDocs = generatedDocStats
    .filter((g) => g.reviewStatus === "READY_FOR_EXPORT" || g.reviewStatus === "APPROVED")
    .reduce((s, g) => s + g._count._all, 0);

  const aiEnabled = isAIEnabled();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="mt-0.5 text-slate-500 flex items-center gap-2">
            {company ? `${company.name}` : ""}
            {company && <span className="text-slate-300">·</span>}
            {aiEnabled
              ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">✦ AI enabled</span>
              : <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">AI offline — rule-based mode</span>
            }
          </p>
        </div>
        <Link href="/dashboard/tenders/new" className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800">
          + New Tender
        </Link>
      </div>

      {/* Urgency alerts */}
      {(overdue.length > 0 || dueSoon3.length > 0) && (
        <div className="space-y-2">
          {overdue.map((t) => (
            <Link key={t.id} href={`/dashboard/tenders/${t.id}`}
              className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm hover:bg-red-100">
              <span className="text-red-500 font-bold">OVERDUE</span>
              <span className="font-medium text-red-900">{t.title}</span>
              <span className="text-red-400">— was due {formatDate(t.deadline)}</span>
            </Link>
          ))}
          {dueSoon3.filter((t) => !overdue.includes(t)).map((t) => (
            <Link key={t.id} href={`/dashboard/tenders/${t.id}`}
              className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm hover:bg-amber-100">
              <span className="text-amber-600 font-bold">DUE SOON</span>
              <span className="font-medium text-amber-900">{t.title}</span>
              <span className="text-amber-500">— due {formatDate(t.deadline)}</span>
            </Link>
          ))}
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-4 grid-cols-2 xl:grid-cols-6">
        {[
          { label: "Total Tenders", value: stats.total, color: "text-slate-900" },
          { label: "In Progress", value: stats.inProgress, color: "text-blue-600" },
          { label: "Critical Gaps", value: stats.criticalGaps, color: stats.criticalGaps > 0 ? "text-red-600" : "text-green-600" },
          { label: "High Gaps", value: stats.highGaps, color: stats.highGaps > 0 ? "text-orange-600" : "text-slate-400" },
          { label: "Due ≤ 7 Days", value: stats.dueSoon, color: stats.dueSoon > 0 ? "text-amber-600" : "text-slate-400" },
          { label: "Overdue", value: stats.overdue, color: stats.overdue > 0 ? "text-red-700" : "text-slate-400" },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">{s.label}</p>
            <p className={`mt-1 text-3xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Analytics strip */}
      {(winRate !== null || pipelineValue > 0 || avgReadiness !== null || totalGenDocs > 0) && (
        <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
          {winRate !== null && (
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Win Rate</p>
              <p className={`mt-1 text-3xl font-bold ${winRate >= 50 ? "text-green-600" : "text-amber-600"}`}>{winRate}%</p>
              <p className="mt-1 text-xs text-slate-400">{wonCount} of {tendersWithOutcome.length} decided tenders</p>
            </div>
          )}
          {pipelineValue > 0 && (
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Pipeline Value</p>
              <p className="mt-1 text-2xl font-bold text-blue-600">
                {pipelineValue >= 1_000_000
                  ? `$${(pipelineValue / 1_000_000).toFixed(1)}M`
                  : pipelineValue >= 1_000
                  ? `$${(pipelineValue / 1_000).toFixed(0)}K`
                  : `$${pipelineValue.toLocaleString()}`}
              </p>
              <p className="mt-1 text-xs text-slate-400">{activeBudgets.length} active tenders with budget</p>
            </div>
          )}
          {avgReadiness !== null && (
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Avg Readiness</p>
              <p className={`mt-1 text-3xl font-bold ${avgReadiness >= 80 ? "text-green-600" : avgReadiness >= 50 ? "text-amber-600" : "text-red-500"}`}>{avgReadiness}%</p>
              <p className="mt-1 text-xs text-slate-400">across {scoredTenders.length} scored tender(s)</p>
            </div>
          )}
          {totalGenDocs > 0 && (
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Docs Export-Ready</p>
              <p className={`mt-1 text-3xl font-bold ${exportReadyDocs === totalGenDocs ? "text-green-600" : exportReadyDocs > 0 ? "text-amber-600" : "text-slate-400"}`}>{exportReadyDocs}</p>
              <p className="mt-1 text-xs text-slate-400">of {totalGenDocs} generated document{totalGenDocs !== 1 ? "s" : ""}</p>
            </div>
          )}
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Outcomes Tracked</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {[["WON","bg-green-100 text-green-700"],["LOST","bg-red-100 text-red-700"],["WITHDRAWN","bg-slate-100 text-slate-600"],["PENDING","bg-amber-100 text-amber-700"]].map(([outcome, cls]) => {
                const count = tenders.filter((t) => t.bidOutcome === outcome).length;
                if (count === 0) return null;
                return <span key={outcome} className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{outcome.toLowerCase()} {count}</span>;
              })}
              {tenders.filter((t) => !t.bidOutcome).length > 0 && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-400">unrecorded {tenders.filter((t) => !t.bidOutcome).length}</span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr),minmax(300px,1fr)]">
        {/* Pipeline table */}
        <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <h2 className="font-semibold text-slate-900">Live pipeline</h2>
            <Link href="/dashboard/tenders" className="text-sm text-blue-600 hover:underline">View all</Link>
          </div>
          {tenders.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <p>No tenders yet.</p>
              <Link href="/dashboard/tenders/new" className="mt-2 inline-block text-sm text-black underline">Create your first tender</Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Title</th>
                  <th className="px-6 py-3 font-medium">Deadline</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Workflow Progress</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tenders.slice(0, 8).map((tender) => {
                  const total = tender._count.requirements;
                  const critical = tender.complianceGaps.filter((g) => !g.isResolved && g.severity === "CRITICAL").length;
                  const readiness = tender.readinessScore ?? (total === 0 ? 0 : Math.max(0, Math.round(((total - critical) / Math.max(total, 1)) * 100)));
                  const isLate = tender.deadline && new Date(tender.deadline) < now && !["EXPORTED", "CLOSED"].includes(tender.status);

                  return (
                    <tr key={tender.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <Link href={`/dashboard/tenders/${tender.id}`} className="font-medium text-slate-900 hover:underline">{tender.title}</Link>
                        {(tender.clientName || (tender as Record<string, unknown>).procuringEntityName as string | null | undefined) && <p className="text-xs text-slate-400">{tender.clientName || (tender as Record<string, unknown>).procuringEntityName as string}</p>}
                      </td>
                      <td className="px-6 py-4">
                        <span className={isLate ? "text-red-600 font-medium" : "text-slate-500"}>
                          {formatDate(tender.deadline)}
                        </span>
                      </td>
                      <td className="px-6 py-4"><StatusBadge status={tender.status} /></td>
                      <td className="px-6 py-4">
                        {total > 0 ? (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 rounded-full bg-slate-100 overflow-hidden">
                              <div className={`h-full rounded-full ${readiness >= 80 ? "bg-green-500" : readiness >= 50 ? "bg-amber-400" : "bg-red-400"}`}
                                style={{ width: `${readiness}%` }} />
                            </div>
                            <span className="text-xs text-slate-500">{readiness}% <span className="text-slate-300">(workflow)</span></span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">No analysis</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-3">
          {!aiEnabled && (
            <div className="rounded-2xl border border-purple-200 bg-purple-50 p-4">
              <p className="text-sm font-semibold text-purple-800">Unlock AI features</p>
              <p className="mt-1 text-xs text-purple-600">Add <code className="bg-purple-100 px-1 rounded">GEMINI_API_KEY</code> to Vercel environment variables to enable AI-powered requirement extraction and proposal generation.</p>
            </div>
          )}
          {[
            { href: "/dashboard/analysis", label: "Tender Analysis", desc: aiEnabled ? "AI-powered requirement extraction" : "Extract requirements and file rules" },
            { href: "/dashboard/matching", label: "Matching Engine", desc: "Rank experts and project references" },
            { href: "/dashboard/compliance", label: "Compliance Review", desc: "Detect and resolve critical gaps" },
            { href: "/dashboard/company", label: "Company Vault", desc: "Experts, projects, and profile data" },
            { href: "/dashboard/export", label: "Export Packages", desc: "Download DOCX proposals and reports" },
          ].map((item) => (
            <Link key={item.href} href={item.href}
              className="block rounded-2xl border bg-white p-4 shadow-sm transition hover:border-black">
              <p className="font-semibold text-slate-900 text-sm">{item.label}</p>
              <p className="mt-0.5 text-xs text-slate-500">{item.desc}</p>
            </Link>
          ))}

          {recentActivity.length > 0 && (
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <p className="font-semibold text-slate-900 text-sm">Recent Activity</p>
                <Link href="/dashboard/activity" className="text-xs text-blue-600 hover:underline">View all</Link>
              </div>
              <ul className="space-y-2">
                {recentActivity.map((log) => (
                  <li key={log.id} className="flex items-start gap-2">
                    <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                    <div className="min-w-0">
                      <p className="text-xs text-slate-700 truncate">{log.description}</p>
                      <p className="text-xs text-slate-400">
                        {new Date(log.createdAt).toLocaleDateString()} · {log.action}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
