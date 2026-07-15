import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../lib/auth";
import { prisma, prismaReady } from "../../lib/prisma";
import { StatusBadge } from "../../components/status-badge";
import { formatDate } from "../../lib/tender-workflow";
import { isAIEnabled } from "../../lib/ai";

export default async function DashboardPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const [tenders, recentActivity] = await Promise.all([
    prisma.tender.findMany({
      where: { userId },
      take: 25,
      include: {
        _count: {
          select: {
            requirements: true,
            complianceGaps: { where: { isResolved: false } },
          },
        },
        complianceGaps: {
          select: { severity: true, isResolved: true },
          where: { isResolved: false, severity: "CRITICAL" },
        },
        generatedDocuments: {
          select: { id: true, validationStatus: true },
          where: { generationStatus: { not: "SUPERSEDED" } },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.auditLog.findMany({
      where: { userId, NOT: { entityType: "TenderStorageCleanup" } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const aiEnabled = isAIEnabled();
  const now = new Date();
  const in3days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

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
  const wonCount = tenders.filter((t) => t.bidOutcome === "WON").length;
  const winRate = tendersWithOutcome.length > 0
    ? Math.round((wonCount / tendersWithOutcome.length) * 100)
    : null;

  // Only aggregate budgets that have both a valid amount AND a currency.
  // Group by currency to avoid summing ETB + USD into one misleading total.
  const budgetsByCurrency = new Map<string, number>();
  for (const t of tenders) {
    if (t.budget && t.budget > 0 && t.currency) {
      const curr = t.currency as string;
      budgetsByCurrency.set(curr, (budgetsByCurrency.get(curr) ?? 0) + (t.budget as number));
    }
  }
  // Only show a single aggregate if all budgets share one currency.
  // If currencies differ, suppress the aggregate to avoid misrepresentation.
  const currencies = Array.from(budgetsByCurrency.keys());
  const singleCurrency = currencies.length === 1 ? currencies[0] : null;
  const pipelineValue = singleCurrency ? (budgetsByCurrency.get(singleCurrency) ?? 0) : null;
  const activeBudgetCount = Array.from(budgetsByCurrency.values()).reduce((a, b) => a + (b > 0 ? 1 : 0), 0);

  const scoredTenders = tenders.filter((t) => t.readinessScore !== null);
  const avgReadiness = scoredTenders.length > 0
    ? Math.round(scoredTenders.reduce((a, b) => a + (b.readinessScore ?? 0), 0) / scoredTenders.length)
    : null;

  const totalGenDocs = tenders.reduce((a, b) => a + b.generatedDocuments.length, 0);
  const exportReadyDocs = tenders.reduce(
    (a, b) => a + b.generatedDocuments.filter((d) => d.validationStatus === "PASSED" || d.validationStatus === "VALIDATED").length,
    0
  );

  // Critical gaps include both unresolved CRITICAL compliance gaps AND tenders
  // with corrupted/partial/fallback/stale extraction that block generation.
  // A tender with EXTRACTION_CORRUPTED_AI_SKIPPED or similar states IS a
  // critical gap even if it has zero compliance gap rows.
  const EXTRACTION_BLOCKED_STATES = new Set([
    "OCR_REQUIRED",
    "EXTRACTION_CORRUPTED_AI_SKIPPED",
    "EXTRACTION_CORRUPTED",
    "EXTRACTION_QUALITY_ENGINE_BLOCKED",
    "EXTRACTION_QUALITY_BLOCKED",
    "ANALYSIS_FROM_CORRUPTED_EXTRACTION",
    "ANALYSIS_FROM_WEAK_EXTRACTION",
    "PARTIAL_EXTRACTION_AI_ANALYZED",
    "REGEX_FALLBACK_AI_ERROR",
    "REGEX_FALLBACK_UNAPPROVED",
  ]);
  const criticalGaps = tenders.reduce((sum, t) => {
    const gapCount = t.complianceGaps?.length ?? 0;
    const extractionBlocked = t.analysisExtractionStatus
      ? EXTRACTION_BLOCKED_STATES.has(t.analysisExtractionStatus)
      : false;
    const hasNoAnalysis = !t.analysisExtractionStatus || t.analysisExtractionStatus === "NOT_STARTED";
    return sum + gapCount + (extractionBlocked || hasNoAnalysis ? 1 : 0);
  }, 0);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Workspace Overview</h1>
          <p className="mt-1 text-slate-500 flex items-center gap-2">
            {aiEnabled
              ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5" title="AI providers are configured. This does not mean analysis is complete or authoritative.">✦ AI providers configured</span>
              : <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">AI offline — rule-based mode</span>
            }
          </p>
        </div>
        <Link
          href="/dashboard/tenders/new"
          className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition-all active:scale-95"
        >
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

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Active Tenders", value: tenders.length, color: "text-blue-600" },
          { label: "Critical Gaps", value: criticalGaps, color: criticalGaps > 0 ? "text-red-600" : "text-green-600" },
          { label: "Due ≤ 7 Days", value: dueSoon7.length, color: dueSoon7.length > 0 ? "text-amber-600" : "text-slate-400" },
          { label: "Overdue", value: overdue.length, color: overdue.length > 0 ? "text-red-700" : "text-slate-400" },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{s.label}</p>
            <p className={`mt-1 text-3xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {(winRate !== null || (pipelineValue !== null && pipelineValue > 0) || avgReadiness !== null || totalGenDocs > 0) && (
        <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
          {winRate !== null && (
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500 font-medium">Win Rate</p>
              <p className={`mt-1 text-3xl font-bold ${winRate >= 50 ? "text-green-600" : "text-amber-600"}`}>{winRate}%</p>
              <p className="mt-1 text-xs text-slate-400">{wonCount} of {tendersWithOutcome.length} decided</p>
            </div>
          )}
          {pipelineValue !== null && pipelineValue > 0 && singleCurrency && (
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500 font-medium">Pipeline Value ({singleCurrency})</p>
              <p className="mt-1 text-2xl font-bold text-blue-600">
                {pipelineValue >= 1_000_000
                  ? `${singleCurrency} ${(pipelineValue / 1_000_000).toFixed(1)}M`
                  : pipelineValue >= 1_000
                  ? `${singleCurrency} ${(pipelineValue / 1_000).toFixed(0)}K`
                  : `${singleCurrency} ${pipelineValue.toLocaleString()}`}
              </p>
              <p className="mt-1 text-xs text-slate-400">{activeBudgetCount} with budget</p>
            </div>
          )}
          {pipelineValue === null && activeBudgetCount > 0 && (
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500 font-medium">Pipeline Value</p>
              <p className="mt-1 text-2xl font-bold text-slate-400">Mixed currencies</p>
              <p className="mt-1 text-xs text-slate-400">{activeBudgetCount} budgets in {currencies.length} currencies</p>
            </div>
          )}
          {avgReadiness !== null && (
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500 font-medium">Avg Readiness</p>
              <p className={`mt-1 text-3xl font-bold ${avgReadiness >= 80 ? "text-green-600" : avgReadiness >= 50 ? "text-amber-600" : "text-red-500"}`}>{avgReadiness}%</p>
              <p className="mt-1 text-xs text-slate-400">across {scoredTenders.length} tenders</p>
            </div>
          )}
          {totalGenDocs > 0 && (
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500 font-medium">Ready for Export</p>
              <p className={`mt-1 text-3xl font-bold ${exportReadyDocs === totalGenDocs ? "text-green-600" : exportReadyDocs > 0 ? "text-amber-600" : "text-slate-400"}`}>{exportReadyDocs}</p>
              <p className="mt-1 text-xs text-slate-400">of {totalGenDocs} docs</p>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr),minmax(300px,1fr)]">
        <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <h2 className="font-bold text-slate-900">Live Pipeline</h2>
            <Link href="/dashboard/tenders" className="text-sm font-medium text-blue-600 hover:underline">View All</Link>
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
                  <th className="px-6 py-3 font-semibold uppercase tracking-wider text-[10px]">Tender Title</th>
                  <th className="px-6 py-3 font-semibold uppercase tracking-wider text-[10px]">Deadline</th>
                  <th className="px-6 py-3 font-semibold uppercase tracking-wider text-[10px]">Status</th>
                  <th className="px-6 py-3 font-semibold uppercase tracking-wider text-[10px]">Readiness</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tenders.slice(0, 8).map((tender) => {
                  const total = tender._count.requirements;
                  const critical = tender.complianceGaps?.length ?? 0;
                  const readiness = tender.readinessScore ?? (total === 0 ? 0 : Math.max(0, Math.round(((total - critical) / Math.max(total, 1)) * 100)));
                  const isLate = tender.deadline && new Date(tender.deadline) < now && !["EXPORTED", "CLOSED"].includes(tender.status);

                  return (
                    <tr key={tender.id} className="hover:bg-slate-50 group">
                      <td className="px-6 py-4">
                        <Link href={`/dashboard/tenders/${tender.id}`} className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">{tender.title}</Link>
                        {tender.clientName && <p className="text-xs text-slate-400 mt-0.5">{tender.clientName}</p>}
                      </td>
                      <td className="px-6 py-4">
                        <span className={isLate ? "text-red-600 font-bold" : "text-slate-500"}>
                          {formatDate(tender.deadline)}
                        </span>
                      </td>
                      <td className="px-6 py-4"><StatusBadge status={tender.status} /></td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 rounded-full bg-slate-100 overflow-hidden">
                            <div className={`h-full rounded-full ${readiness >= 80 ? "bg-green-500" : readiness >= 50 ? "bg-amber-400" : "bg-red-400"}`}
                              style={{ width: `${readiness}%` }} />
                          </div>
                          <span className="text-[10px] font-bold text-slate-500">{readiness}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border bg-slate-900 p-6 text-white shadow-lg">
            <h3 className="text-lg font-bold">Quick Engine Access</h3>
            <p className="mt-1 text-xs text-slate-400">Jump directly to specialized engine views.</p>
            <div className="mt-6 space-y-2">
              {[
                { href: "/dashboard/analysis", label: "Global Analysis", icon: "🧠" },
                { href: "/dashboard/matching", label: "Global Matching", icon: "🧩" },
                { href: "/dashboard/compliance", label: "Global Compliance", icon: "🛡️" },
                { href: "/dashboard/company", label: "Knowledge Vault", icon: "🗄️" },
                { href: "/dashboard/export", label: "Export Hub", icon: "📦" },
              ].map((item) => (
                <Link key={item.href} href={item.href}
                  className="flex items-center gap-3 rounded-xl bg-slate-800/50 p-3 text-sm hover:bg-slate-800 transition-colors border border-slate-700/50">
                  <span className="text-lg">{item.icon}</span>
                  <span className="font-medium">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>

          {recentActivity.length > 0 && (
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <p className="font-bold text-slate-900 text-sm">Activity Feed</p>
                <Link href="/dashboard/activity" className="text-xs font-medium text-blue-600 hover:underline">View All</Link>
              </div>
              <ul className="space-y-4">
                {recentActivity.map((log) => (
                  <li key={log.id} className="flex gap-3">
                    <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-800 leading-normal">{log.description}</p>
                      <p className="text-[10px] text-slate-400 mt-1">
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
