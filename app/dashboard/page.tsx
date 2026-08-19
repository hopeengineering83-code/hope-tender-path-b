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
import { isClientNameContaminated } from "../../lib/engine/metadata-validators";
import { SparklesIcon, AlertCircleIcon, CrossIcon } from "../../components/icons";

export default async function DashboardPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const now = new Date();
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Truthful workspace totals — use real COUNT / GROUP-BY queries so global
  // metrics are not silently capped by any "take" limit on the recent-tender
  // list. The recent-tender list below only feeds the Live Pipeline table.
  //
  // NOTE: We intentionally do NOT load readinessScore for a workspace-wide
  // average — there is no honest way to compute such an average without
  // per-tender resolution (see PROVISIONAL_NOT_BLOCKED caveat in
  // lib/engine/tender-currentness.ts). The Avg Workflow Progress card was
  // removed entirely.
  const [
    activeTenderCount,
    overdueCount,
    dueSoon7Count,
    criticalComplianceGapCount,
    extractionStateRows,
    budgetByCurrencyRows,
    wonCount,
    decidedCount,
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
    // Per-tender extraction state — used for workspace currentness
    // projection and for the global critical-blockers lower-bound count.
    prisma.tender.findMany({
      where: { userId },
      select: {
        id: true,
        analysisExtractionStatus: true,
        _count: { select: { requirements: true } },
      },
    }),
    // Count tenders with budget > 0 grouped by currency. We do NOT
    // aggregate the sum — Issue #1134 requires unsupported budgets not
    // to be displayed as authoritative financial values. PR #1141's
    // source-grounded currency authority is open and not yet merged.
    // We only fetch the count per currency group for inventory purposes.
    prisma.tender.groupBy({
      by: ["currency"],
      where: {
        userId,
        budget: { gt: 0 },
      },
      _count: true,
    }),
    prisma.tender.count({ where: { userId, bidOutcome: "WON" } }),
    prisma.tender.count({
      where: { userId, NOT: { bidOutcome: null }, bidOutcome: { not: "PENDING" } },
    }),
    // Recent tenders for the Live Pipeline display table only.
    // NOTE: readinessScore is intentionally NOT selected — it is not a
    // valid workflow-stage metric and must not be displayed as progress.
    // See Issue #1134 recheck 9 item #1.
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
  const recentCurrentnessVerdicts = await classifyTenderCurrentnessBatch(
    prisma,
    recentTenders.map((t) => ({
      tenderId: t.id,
      analysisExtractionStatus: t.analysisExtractionStatus,
      requirementsCount: t._count?.requirements ?? 0,
    })),
  );

  // ─── Critical blockers count (LOWER BOUND) ───────────────────────────────
  // This is a LOWER BOUND on the true blocker count. The workspace
  // projection can prove a tender is blocked (latest job failed/superseded/
  // unpromoted/empty-hash, OR persisted BLOCKED status), but it CANNOT prove
  // a tender is clear — only the per-tender resolver
  // (resolveTenderAnalysisState) can do that, because it also checks
  // AiAnalyzeChunk rows, content-hash equality, fallback/mixed-result
  // provenance, and section-detected-but-no-requirements edge cases.
  //
  // Subtitle "minimum — per-tender verification still required" makes the
  // lower-bound semantics explicit.
  const extractionBlockedCount = allTenderIds.filter((id) => {
    const v = currentnessVerdicts.get(id);
    return v ? isCanonicalCurrentnessCritical(v) : true;
  }).length;
  const criticalBlockers = criticalComplianceGapCount + extractionBlockedCount;

  // ─── Budget count (no aggregate sum) ───────────────────────────────────────
  // Issue #1134 requires unsupported budgets not to be displayed as
  // authoritative financial values. PR #1141 introduces source-grounded
  // currency authority, but it is open and not yet merged. Until it merges,
  // we CANNOT prove any currency value is source-grounded. Therefore:
  //   - We count tenders with budget > 0 and a non-null currency (for
  //     inventory purposes only).
  //   - We do NOT compute or display an aggregate pipeline value. Summing
  //     unverified currency values would present unsupported financial
  //     authority.
  // When PR #1141 merges, this count will automatically exclude rows with
  // null currency (defensive `if (!curr) continue`).
  let activeBudgetCount = 0;
  for (const row of budgetByCurrencyRows) {
    const curr = row.currency;
    if (!curr) continue;
    const groupCount = typeof row._count === "number" ? row._count : 0;
    activeBudgetCount += groupCount;
  }

  // ─── Avg workflow progress REMOVED ─────────────────────────────────────────
  // The persisted readinessScore is NOT export readiness, and there is no
  // honest way to compute a workspace-wide average that excludes blocked
  // tenders without per-tender resolution. Even on PROVISIONAL_NOT_BLOCKED
  // tenders, the readinessScore is workflow progress, not authoritative
  // readiness. The card was removed entirely.
  //
  // The winRate card is kept because bidOutcome is a discrete outcome
  // (WON/LOST) — not a readiness claim.
  const winRate = decidedCount > 0 ? Math.round((wonCount / decidedCount) * 100) : null;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Workspace Overview</h1>
          <p className="mt-1 text-slate-500 flex items-center gap-2">
            {aiEnabled
              ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5" title="AI providers are configured. This does not mean analysis is complete or authoritative."><SparklesIcon /> AI providers configured</span>
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

      {/* Workspace projection warning — required by Issue #1134 recheck 7.
          The dashboard's extraction state is a LOWER BOUND projection.
          It can prove a tender is blocked, but it cannot prove a tender is
          clear. The per-tender resolver (command center / export gate) is
          the canonical authority. Do not interpret PROVISIONAL_NOT_BLOCKED
          as overall readiness. */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
        <strong>Workspace projection notice:</strong> Counts on this page are
        lower bounds. Per-tender verification (command center / export gate) is
        the canonical authority for Clear / Blocked / Export readiness.
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Active Tenders", value: activeTenderCount, color: "text-blue-600" },
          {
            label: "Critical blockers",
            value: criticalBlockers,
            color: criticalBlockers > 0 ? "text-red-600" : "text-slate-500",
            subtitle: "minimum — per-tender verification still required",
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

      {winRate !== null && (
        <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500 font-medium">Win Rate</p>
            <p className={`mt-1 text-3xl font-bold ${winRate >= 50 ? "text-green-600" : "text-amber-600"}`}>{winRate}%</p>
            <p className="mt-1 text-xs text-slate-400">{wonCount} of {decidedCount} decided</p>
          </div>
          {activeBudgetCount > 0 && (
            <div className="rounded-2xl border bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500 font-medium">Tenders with budget</p>
              <p className="mt-1 text-3xl font-bold text-slate-600">{activeBudgetCount}</p>
              <p className="mt-1 text-xs text-slate-400">non-null currency — no aggregate until source-grounded authority</p>
            </div>
          )}
          {/* NOTE: The workspace-wide "documents validated" card was removed.
              Counting documents by validationStatus === PASSED/VALIDATED is
              NOT export authority. The canonical export gate is per-tender
              final-package readiness (lib/engine/final-submission-readiness.ts).
              Surface that on the command center / export hub, not as a
              workspace-wide count. */}
          {/* NOTE: The Avg Workflow Progress card was removed. The persisted
              readinessScore is workflow progress, not export readiness, and
              there is no honest way to compute a workspace-wide average that
              excludes blocked tenders without per-tender resolution. */}
          {/* NOTE: The Pipeline Value aggregate was removed. Issue #1134
              requires unsupported budgets not to be displayed as authoritative
              financial values. PR #1141's source-grounded currency authority
              is open and not yet merged. Until it merges, summing unverified
              currency values would present unsupported financial authority. */}
        </div>
      )}

      {winRate === null && activeBudgetCount > 0 && (
        <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500 font-medium">Tenders with budget</p>
            <p className="mt-1 text-3xl font-bold text-slate-600">{activeBudgetCount}</p>
            <p className="mt-1 text-xs text-slate-400">non-null currency — no aggregate until source-grounded authority</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr),minmax(300px,1fr)]">
        <div className="min-w-0 rounded-2xl border bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <div>
              <h2 className="font-bold text-slate-900">Live Pipeline</h2>
              <p className="mt-0.5 text-[10px] text-slate-400">
                Last {recentTenders.length} tender{recentTenders.length === 1 ? "" : "s"} · workspace projection — the canonical state lives in each tender&apos;s Workflow Control Center.
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
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-semibold uppercase tracking-wider text-[10px]">Tender Title</th>
                  <th className="px-6 py-3 font-semibold uppercase tracking-wider text-[10px]">Deadline</th>
                  <th className="px-6 py-3 font-semibold uppercase tracking-wider text-[10px]">Status</th>
                  <th className="px-6 py-3 font-semibold uppercase tracking-wider text-[10px]">Extraction State</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recentTenders.map((tender) => {
                  const isLate = tender.deadline && new Date(tender.deadline) < now && !["EXPORTED", "CLOSED"].includes(tender.status);
                  // Use workspace-currentness verdict. This is a LOWER BOUND
                  // projection — it can prove blocked, but cannot prove clear.
                  // PROVISIONAL_NOT_BLOCKED is NOT a Clear verdict; it just
                  // means "no job-level blocker detected at the workspace
                  // level". The per-tender resolver is the canonical authority.
                  const verdict = recentCurrentnessVerdicts.get(tender.id);
                  const extractionState = verdict?.currentness ?? "BLOCKED";

                  return (
                    <tr key={tender.id} className="hover:bg-slate-50 group">
                      <td className="max-w-[240px] px-6 py-4">
                        <Link href={`/dashboard/tenders/${tender.id}`} className="break-words font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">{tender.title}</Link>
                        {tender.clientName && (
                          isClientNameContaminated(tender.clientName)
                            ? <p className="text-xs text-amber-600 mt-0.5">Client name needs review — the extracted value mixes several fields. Open the tender to correct it.</p>
                            : <p className="text-xs text-slate-400 mt-0.5">{tender.clientName}</p>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className={isLate ? "text-red-600 font-bold" : "text-slate-500"}>
                          {formatDate(tender.deadline)}
                        </span>
                      </td>
                      <td className="px-6 py-4"><StatusBadge status={tender.status} /></td>
                      <td className="px-6 py-4">
                        {extractionState === "PROVISIONAL_NOT_BLOCKED" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 border border-slate-200" title="No job-level blocker detected. NOT a canonical Clear verdict — per-tender resolver may still find chunk/content-hash blockers.">
                            <AlertCircleIcon /> Provisional
                          </span>
                        )}
                        {extractionState === "BLOCKED" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700 border border-red-200" title="Persisted status is BLOCKED, unknown, or stale (no promoted AI job, or latest job failed/superseded/unpromoted/empty-hash).">
                            <CrossIcon /> Blocked
                          </span>
                        )}
                        {extractionState === "NOT_ANALYZED" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 border border-slate-200">
                            <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full border border-slate-400" /> Not analyzed
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>

        <div className="space-y-4">
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
                      <p className="text-xs font-medium text-slate-800 leading-normal line-clamp-2">{log.description}</p>
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
