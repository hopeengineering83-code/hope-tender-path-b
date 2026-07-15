import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../lib/auth";
import { prisma, prismaReady } from "../../lib/prisma";
import { StatusBadge } from "../../components/status-badge";
import { formatDate } from "../../lib/tender-workflow";
import { isAIEnabled } from "../../lib/ai";
import {
  classifyTenderCurrentnessBatch,
  isCanonicalCurrentnessCritical,
} from "../../lib/engine/tender-currentness";

export default async function DashboardPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const now = new Date();
  const in3days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Truthful workspace totals — use real COUNT / GROUP-BY queries so global
  // metrics are not silently capped by any "take" limit on the recent-tender
  // list. The recent-tender list below only feeds the Live Pipeline table.
  const [
    activeTenderCount,
    overdueCount,
    dueSoon3Count,
    dueSoon7Count,
    criticalComplianceGapCount,
    extractionStateRows,
    budgetByCurrencyRows,
    wonCount,
    decidedCount,
    scoredRows,
    recentTenders,
    recentActivity,
  ] = await Promise.all([
    prisma.tender.count({ where: { userId } }),
    prisma.tender.count({
      where: {
        userId,
        deadline: { lt: now },
        status: { notIn: ["EXPORTED", "CLOSED"] },
      },
    }),
    prisma.tender.count({
      where: {
        userId,
        deadline: { gte: now, lte: in3days },
        status: { notIn: ["EXPORTED", "CLOSED"] },
      },
    }),
    prisma.tender.count({
      where: {
        userId,
        deadline: { gte: now, lte: in7days },
        status: { notIn: ["EXPORTED", "CLOSED"] },
      },
    }),
    prisma.complianceGap.count({
      where: {
        tender: { userId },
        isResolved: false,
        severity: "CRITICAL",
      },
    }),
    // Per-tender extraction state — used for canonical currentness check
    // and for the global critical-blockers count.
    prisma.tender.findMany({
      where: { userId },
      select: {
        id: true,
        analysisExtractionStatus: true,
        _count: { select: { requirements: true } },
      },
    }),
    // Aggregate budget by currency across ALL tenders, not just recent.
    // PR #1141 (open, not yet merged) makes Tender.currency nullable. We
    // defensively skip null currencies at runtime in the loop below so
    // this code is forward-compatible with the nullable schema.
    prisma.tender.groupBy({
      by: ["currency"],
      where: {
        userId,
        budget: { gt: 0 },
      },
      _sum: { budget: true },
      _count: true,
    }),
    prisma.tender.count({ where: { userId, bidOutcome: "WON" } }),
    prisma.tender.count({
      where: { userId, NOT: { bidOutcome: null }, bidOutcome: { not: "PENDING" } },
    }),
    // Only fetch readinessScore for averaging — cheap column.
    // readinessScore is non-nullable (Float @default(0)) so no filter needed.
    // Note: we'll exclude blocked tenders from the average below.
    prisma.tender.findMany({
      where: { userId },
      select: {
        id: true,
        readinessScore: true,
        analysisExtractionStatus: true,
        _count: { select: { requirements: true } },
      },
    }),
    // Recent tenders for the Live Pipeline display table only.
    prisma.tender.findMany({
      where: { userId },
      take: 8,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        clientName: true,
        deadline: true,
        status: true,
        analysisExtractionStatus: true,
        readinessScore: true,
        _count: {
          select: {
            requirements: true,
            complianceGaps: { where: { isResolved: false, severity: "CRITICAL" } },
          },
        },
      },
    }),
    prisma.auditLog.findMany({
      where: { userId, NOT: { entityType: "TenderStorageCleanup" } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const aiEnabled = isAIEnabled();

  // ─── Canonical currentness batch ─────────────────────────────────────────
  // The persisted analysisExtractionStatus alone cannot prove current
  // authoritative analysis. Combine it with the existence of a non-superseded
  // promoted AI job (proved by classifyTenderCurrentnessBatch).
  const allTenderIds = extractionStateRows.map((r) => r.id);
  const currentnessVerdicts = await classifyTenderCurrentnessBatch(
    prisma,
    extractionStateRows.map((r) => ({
      tenderId: r.id,
      analysisExtractionStatus: r.analysisExtractionStatus,
      requirementsCount: r._count?.requirements ?? 0,
    })),
  );
  const recentTenderIds = recentTenders.map((t) => t.id);
  const recentCurrentnessVerdicts = await classifyTenderCurrentnessBatch(
    prisma,
    recentTenders.map((t) => ({
      tenderId: t.id,
      analysisExtractionStatus: t.analysisExtractionStatus,
      requirementsCount: t._count?.requirements ?? 0,
    })),
  );

  // ─── Critical blockers count ─────────────────────────────────────────────
  // "Critical blockers" replaces "Critical Gaps" to make the semantics clear:
  //   - 1 tender with 3 CRITICAL compliance gaps + a stale extraction → 4 blockers
  //   - This is a count of BLOCKERS, not a count of tenders.
  // The card label was changed to "Critical blockers" and the subtitle reads
  // "gaps + extraction blockers" so the reader cannot mistake it for a
  // tender count.
  const extractionBlockedCount = allTenderIds.filter((id) => {
    const v = currentnessVerdicts.get(id);
    return v ? isCanonicalCurrentnessCritical(v) : true;
  }).length;
  const criticalBlockers = criticalComplianceGapCount + extractionBlockedCount;

  // ─── Budget totals — group by present currency, suppress when mixed ──────
  // NOTE: This counts tenders by their persisted `currency` column. It does
  // NOT prove field-level source/human authority on each currency value
  // (that authority is being introduced by PR #1141, not yet merged). The
  // label "with non-null currency" is intentionally honest — it does not
  // claim "verified". When PR #1141 merges, default/legacy USD rows will
  // have null currency and be excluded automatically; until then, this
  // metric counts every tender with budget > 0 and a non-null currency.
  const budgetsByCurrency = new Map<string, number>();
  let activeBudgetCount = 0;
  for (const row of budgetByCurrencyRows) {
    // row.currency is non-null in the current schema (default "USD") but
    // becomes nullable after PR #1141 merges. Skip nulls defensively.
    const curr = row.currency;
    if (!curr) continue;
    const sum = row._sum?.budget ?? 0;
    budgetsByCurrency.set(curr, (budgetsByCurrency.get(curr) ?? 0) + sum);
    // _count from groupBy returns the number of tenders in this currency group.
    const groupCount = typeof row._count === "number" ? row._count : 0;
    activeBudgetCount += groupCount;
  }
  const currencies = Array.from(budgetsByCurrency.keys());
  const singleCurrency = currencies.length === 1 ? currencies[0] : null;
  const pipelineValue = singleCurrency ? (budgetsByCurrency.get(singleCurrency) ?? 0) : null;

  // ─── Avg workflow progress — exclude blocked tenders, suppress green ──────
  // Blocked tenders cannot be "ready" — including their persisted
  // readinessScore would let a stale 100% score appear beside canonical
  // blockers. We:
  //   1. Compute currentness for every tender with a readinessScore.
  //   2. Exclude tenders whose currentness is BLOCKED or NOT_ANALYZED.
  //   3. Average only the CANONICAL_CLEAR tenders.
  //   4. Color the metric neutrally (slate) — no green authority, because
  //      the persisted readinessScore is workflow progress, not export
  //      readiness. Even on a CLEAR tender, it must not read as release-
  //      ready green.
  const clearScoredRows = scoredRows.filter((r) => {
    const v = currentnessVerdicts.get(r.id);
    return v ? v.currentness === "CANONICAL_CLEAR" : false;
  });
  const avgReadiness = clearScoredRows.length > 0
    ? Math.round(clearScoredRows.reduce((a, b) => a + (b.readinessScore ?? 0), 0) / clearScoredRows.length)
    : null;

  const winRate = decidedCount > 0 ? Math.round((wonCount / decidedCount) * 100) : null;

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

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Active Tenders", value: activeTenderCount, color: "text-blue-600" },
          {
            label: "Critical blockers",
            value: criticalBlockers,
            color: criticalBlockers > 0 ? "text-red-600" : "text-green-600",
            subtitle: "gaps + extraction blockers",
          },
          { label: "Due ≤ 7 Days", value: dueSoon7Count, color: dueSoon7Count > 0 ? "text-amber-600" : "text-slate-400" },
          { label: "Overdue", value: overdueCount, color: overdueCount > 0 ? "text-red-700" : "text-slate-400" },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{s.label}</p>
            <p className={`mt-1 text-3xl font-bold ${s.color}`}>{s.value}</p>
            {s.subtitle && <p className="mt-0.5 text-[10px] text-slate-400">{s.subtitle}</p>}
          </div>
        ))}
      </div>

      {(winRate !== null || (pipelineValue !== null && pipelineValue > 0) || avgReadiness !== null || (pipelineValue === null && activeBudgetCount > 0)) && (
        <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
          {winRate !== null && (
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500 font-medium">Win Rate</p>
              <p className={`mt-1 text-3xl font-bold ${winRate >= 50 ? "text-green-600" : "text-amber-600"}`}>{winRate}%</p>
              <p className="mt-1 text-xs text-slate-400">{wonCount} of {decidedCount} decided</p>
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
              <p className="mt-1 text-xs text-slate-400">{activeBudgetCount} with non-null currency</p>
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
              <p className="text-sm text-slate-500 font-medium">Avg Workflow Progress</p>
              {/* Color is intentionally slate (neutral), never green. Persisted
                  readinessScore is workflow progress, not export readiness. */}
              <p className="mt-1 text-3xl font-bold text-slate-600">{avgReadiness}%</p>
              <p className="mt-1 text-xs text-slate-400">Not export readiness</p>
              <p className="mt-1 text-xs text-slate-400">across {clearScoredRows.length} canonical-clear tenders</p>
            </div>
          )}
          {/* NOTE: The workspace-wide "documents validated" card was removed.
              Counting documents by validationStatus === PASSED/VALIDATED is
              NOT export authority. The canonical export gate is per-tender
              final-package readiness (lib/engine/final-submission-readiness.ts).
              Surface that on the command center / export hub, not as a
              workspace-wide count. */}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr),minmax(300px,1fr)]">
        <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <div>
              <h2 className="font-bold text-slate-900">Live Pipeline</h2>
              <p className="mt-0.5 text-[10px] text-slate-400">
                Recent {recentTenders.length} tenders · Canonical extraction state, not the workflow % bar.
              </p>
            </div>
            <Link href="/dashboard/tenders" className="text-sm font-medium text-blue-600 hover:underline">View All</Link>
          </div>
          {recentTenders.length === 0 ? (
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
                  <th className="px-6 py-3 font-semibold uppercase tracking-wider text-[10px]">Extraction State</th>
                  <th className="px-6 py-3 font-semibold uppercase tracking-wider text-[10px]">Workflow %</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recentTenders.map((tender) => {
                  const total = tender._count.requirements;
                  const critical = tender._count.complianceGaps;
                  const workflowPct = tender.readinessScore ?? (total === 0 ? 0 : Math.max(0, Math.round(((total - critical) / Math.max(total, 1)) * 100)));
                  const isLate = tender.deadline && new Date(tender.deadline) < now && !["EXPORTED", "CLOSED"].includes(tender.status);
                  // Use canonical-currentness verdict instead of bare
                  // analysisExtractionStatus string. This catches stale
                  // statuses that no longer have a promoted AI job.
                  const verdict = recentCurrentnessVerdicts.get(tender.id);
                  const extractionState = verdict?.currentness ?? "BLOCKED";
                  // Suppress green authority styling on the workflow % bar
                  // whenever the canonical currentness is not CLEAR. The bar
                  // is workflow progress, not export readiness.
                  const workflowBarColor = extractionState === "CANONICAL_CLEAR"
                    ? (workflowPct >= 80 ? "bg-slate-500" : workflowPct >= 50 ? "bg-slate-400" : "bg-slate-300")
                    : "bg-slate-200";

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
                        {extractionState === "CANONICAL_CLEAR" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 border border-emerald-200" title="Persisted CLEAR status with a non-superseded promoted AI job.">
                            ✓ Clear
                          </span>
                        )}
                        {extractionState === "BLOCKED" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700 border border-red-200" title="Persisted status is BLOCKED, unknown, or stale (no promoted AI job).">
                            ✗ Blocked
                          </span>
                        )}
                        {extractionState === "NOT_ANALYZED" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 border border-slate-200">
                            ○ Not analyzed
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 rounded-full bg-slate-100 overflow-hidden">
                            <div className={`h-full rounded-full ${workflowBarColor}`}
                              style={{ width: `${workflowPct}%` }} />
                          </div>
                          <span className="text-[10px] font-bold text-slate-500" title="Workflow progress, not export readiness">{workflowPct}%</span>
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
