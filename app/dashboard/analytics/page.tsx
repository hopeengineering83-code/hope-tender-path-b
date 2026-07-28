import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { getAllProviderHealth } from "../../../lib/ai-provider-health";
import { formatDate, TENDER_STATUSES } from "../../../lib/tender-workflow";
import { ArrowRightIcon } from "../../../components/icons";

// ─── helpers ──────────────────────────────────────────────────────────────

function fmtRelative(iso: Date | string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function statusColor(status: string): string {
  const map: Record<string, string> = {
    DRAFT: "bg-slate-100 text-slate-600",
    INTAKE: "bg-yellow-100 text-yellow-700",
    ANALYZED: "bg-blue-100 text-blue-700",
    MATCHED: "bg-violet-100 text-violet-700",
    COMPLIANCE_REVIEW: "bg-orange-100 text-orange-700",
    READY_FOR_GENERATION: "bg-teal-100 text-teal-700",
    GENERATED: "bg-cyan-100 text-cyan-700",
    IN_REVIEW: "bg-amber-100 text-amber-700",
    APPROVED: "bg-green-100 text-green-700",
    EXPORTED: "bg-emerald-100 text-emerald-700",
    CLOSED: "bg-slate-200 text-slate-500",
    NO_BID: "bg-neutral-800 text-neutral-100",
  };
  return map[status] ?? "bg-slate-100 text-slate-600";
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

function parseQualityScore(contentSummary: string | null): number | null {
  const m = contentSummary?.match(/QUALITY_SCORE:\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function qualityColor(score: number): string {
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-amber-400";
  return "bg-red-400";
}

function qualityTextColor(score: number): string {
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-amber-600";
  return "text-red-500";
}

// ─── page ─────────────────────────────────────────────────────────────────

export default async function AnalyticsPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  // ── Fetch all tenders for this user (lean select) ────────────────────────
  const [tenders, auditLogs, company, bidOutcomeTenders, technicalProposals] = await Promise.all([
    prisma.tender.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        status: true,
        deadline: true,
        readinessScore: true,
        notes: true,
        updatedAt: true,
      },
      orderBy: { readinessScore: "desc" },
    }),
    prisma.auditLog.findMany({
      where: { userId, NOT: { entityType: "TenderStorageCleanup" } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        action: true,
        entityType: true,
        description: true,
        createdAt: true,
      },
    }),
    prisma.company.findUnique({
      where: { userId },
      select: {
        id: true,
        updatedAt: true,
        _count: {
          select: {
            // A relation _count with no `where` counts every row including
            // soft-deleted ones. Every other expert/project count in the app
            // filters deletedAt: null, so after deleting a record the Company
            // Vault page correctly showed it gone while these tiles kept the
            // pre-delete total — "one place says present, another says zero".
            experts: { where: { deletedAt: null } },
            projects: { where: { deletedAt: null } },
            documents: true,
          },
        },
      },
    }),
    prisma.tender.findMany({
      where: { userId, bidOutcome: { not: null } },
      select: { id: true, title: true, bidOutcome: true, bidOutcomeAt: true },
      orderBy: { bidOutcomeAt: "desc" },
    }),
    prisma.generatedDocument.findMany({
      where: {
        tender: { userId },
        documentType: "TECHNICAL_PROPOSAL",
        contentSummary: { contains: "QUALITY_SCORE:" },
      },
      select: { id: true, contentSummary: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // ── Derive pipeline summary ──────────────────────────────────────────────
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  const activeTenders = tenders.filter(
    (t) => t.status !== "CLOSED" && t.status !== "EXPORTED",
  );

  const urgentCount = tenders.filter((t) => {
    if (!t.deadline) return false;
    const msLeft = new Date(t.deadline).getTime() - now;
    return msLeft >= 0 && msLeft <= sevenDaysMs;
  }).length;

  const avgReadiness =
    tenders.length > 0
      ? Math.round(tenders.reduce((sum, t) => sum + (t.readinessScore ?? 0), 0) / tenders.length)
      : 0;

  // Count tenders using regex fallback from notes field
  const regexFallbackCount = tenders.filter((t) =>
    /analysis\s+source:\s*regex\s+fallback/i.test(t.notes ?? ""),
  ).length;
  const aiAnalyzedCount = tenders.filter((t) =>
    /analysis\s+source:\s*ai/i.test(t.notes ?? ""),
  ).length;

  // ── Status breakdown ─────────────────────────────────────────────────────
  const statusCounts: Record<string, number> = {};
  for (const s of TENDER_STATUSES) statusCounts[s] = 0;
  for (const t of tenders) {
    if (statusCounts[t.status] !== undefined) {
      statusCounts[t.status]++;
    }
  }

  // ── Top 5 tenders by readiness ────────────────────────────────────────────
  const topTenders = tenders.slice(0, 5);

  // ── AI provider health ────────────────────────────────────────────────────
  const providerHealth = getAllProviderHealth();

  // ── Knowledge vault stats ─────────────────────────────────────────────────
  const expertCount = company?._count.experts ?? 0;
  const projectCount = company?._count.projects ?? 0;
  const documentCount = company?._count.documents ?? 0;
  const lastImport = company?.updatedAt ?? null;

  // ── Last AI analysis info from audit logs ─────────────────────────────────
  const lastAiLog = auditLogs.find((l) => l.action === "TENDER_ANALYZED" || l.action === "AI_ANALYZE");

  // ── Bid outcome summary ───────────────────────────────────────────────────
  const winCount = bidOutcomeTenders.filter((t) => t.bidOutcome === "WIN").length;
  const lostCount = bidOutcomeTenders.filter((t) => t.bidOutcome === "LOST").length;
  const noBidCount = bidOutcomeTenders.filter((t) => t.bidOutcome === "NO_BID").length;
  const winRateDenominator = winCount + lostCount;
  const winRate =
    winRateDenominator > 0 ? Math.round((winCount / winRateDenominator) * 100) : null;

  // ── Proposal quality distribution ────────────────────────────────────────
  const proposalScores = technicalProposals
    .map((d) => parseQualityScore(d.contentSummary))
    .filter((s): s is number => s !== null);

  const excellentCount = proposalScores.filter((s) => s >= 80).length;
  const goodCount = proposalScores.filter((s) => s >= 60 && s < 80).length;
  const needsWorkCount = proposalScores.filter((s) => s < 60).length;
  const avgQualityScore =
    proposalScores.length > 0
      ? Math.round(proposalScores.reduce((sum, s) => sum + s, 0) / proposalScores.length)
      : null;

  // ── Recent quality trend (last 10) ───────────────────────────────────────
  const recentProposals = technicalProposals.slice(0, 10).map((d) => ({
    id: d.id,
    score: parseQualityScore(d.contentSummary),
    createdAt: d.createdAt,
  }));

  return (
    <div className="space-y-8">
      {/* ── Page header ── */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Analytics</h1>
        <p className="mt-1 text-sm text-slate-500">
          Pipeline overview, activity, and AI provider health
        </p>
      </div>

      {/* SCREENSHOT-R2: Empty state when no tenders exist */}
      {tenders.length === 0 && (
        <div className="rounded-2xl border bg-white p-12 text-center shadow-sm">
          <p className="text-lg font-medium text-slate-700">No tender data yet</p>
          <p className="mt-2 text-sm text-slate-400">
            Create a tender and run the engine to see pipeline analytics, quality scores, and AI provider health.
          </p>
          <Link href="/dashboard/tenders/new" className="mt-4 inline-block rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-800">
            + New Tender
          </Link>
        </div>
      )}

      {tenders.length > 0 && (
        <>
      {/* ── 1. Tender pipeline summary cards ── */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Tender Pipeline
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Active Tenders" value={activeTenders.length} />
          <StatCard
            label="Due in ≤ 7 Days"
            value={urgentCount}
            accent={urgentCount > 0 ? "amber" : undefined}
          />
          <StatCard
            label="Avg Readiness Score"
            value={`${avgReadiness}%`}
            accent={avgReadiness >= 70 ? "green" : avgReadiness >= 40 ? "amber" : "red"}
          />
          <div className="rounded-lg border bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Analysis Source</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{aiAnalyzedCount}</p>
            <p className="mt-1 text-xs text-slate-400">AI-analyzed</p>
            {regexFallbackCount > 0 && (
              <p className="mt-0.5 text-xs text-amber-600">
                {regexFallbackCount} regex fallback
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ── 2. Status breakdown ── */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Status Breakdown
        </h2>
        <div className="rounded-lg border bg-white p-6 shadow-sm">
          {tenders.length === 0 ? (
            <p className="text-sm text-slate-400">No tenders yet.</p>
          ) : (
            <div className="space-y-3">
              {TENDER_STATUSES.map((s) => {
                const count = statusCounts[s] ?? 0;
                const pct = tenders.length > 0 ? Math.round((count / tenders.length) * 100) : 0;
                return (
                  <div key={s} className="flex items-center gap-3">
                    <span
                      className={`w-36 shrink-0 rounded-full px-2.5 py-0.5 text-center text-xs font-medium ${statusColor(s)}`}
                    >
                      {statusLabel(s)}
                    </span>
                    <div className="flex-1 overflow-hidden rounded-full bg-slate-100" style={{ height: 8 }}>
                      <div
                        className="h-full rounded-full bg-slate-800 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-sm font-semibold text-slate-700">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── 3 + 4. Activity + Top tenders ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent activity */}
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Recent Activity
          </h2>
          <div className="rounded-lg border bg-white shadow-sm">
            {auditLogs.length === 0 ? (
              <p className="p-6 text-sm text-slate-400">No activity recorded yet.</p>
            ) : (
              <ol className="divide-y">
                {auditLogs.map((log) => (
                  <li key={log.id} className="flex items-start gap-3 px-5 py-3">
                    <span className="mt-0.5 flex h-2 w-2 shrink-0 rounded-full bg-slate-300" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-slate-800">{log.description}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          {log.action.replace(/_/g, " ")}
                        </span>
                        {fmtRelative(log.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <div className="border-t px-5 py-3">
              <Link href="/dashboard/activity" className="text-xs text-blue-600 hover:underline">
                View full activity log <ArrowRightIcon />
              </Link>
            </div>
          </div>
        </section>

        {/* Top tenders by readiness */}
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Top Tenders by Readiness
          </h2>
          <div className="rounded-lg border bg-white shadow-sm">
            {topTenders.length === 0 ? (
              <p className="p-6 text-sm text-slate-400">No tenders yet.</p>
            ) : (
              <ol className="divide-y">
                {topTenders.map((tender) => {
                  const score = Math.round(tender.readinessScore ?? 0);
                  const daysLeft = tender.deadline
                    ? Math.ceil(
                        (new Date(tender.deadline).getTime() - now) / 86_400_000,
                      )
                    : null;
                  return (
                    <li key={tender.id} className="px-5 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/dashboard/tenders/${tender.id}`}
                            className="block truncate text-sm font-medium text-slate-900 hover:text-blue-600"
                          >
                            {tender.title}
                          </Link>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColor(tender.status)}`}
                            >
                              {statusLabel(tender.status)}
                            </span>
                            {tender.deadline && (
                              <span
                                className={
                                  daysLeft !== null && daysLeft <= 7
                                    ? "text-amber-600"
                                    : "text-slate-400"
                                }
                              >
                                {daysLeft !== null && daysLeft < 0
                                  ? "Overdue"
                                  : `Due ${formatDate(tender.deadline)}`}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span
                            className={`text-sm font-bold ${
                              score >= 70
                                ? "text-green-600"
                                : score >= 40
                                  ? "text-amber-600"
                                  : "text-red-500"
                            }`}
                          >
                            {score}%
                          </span>
                          <div className="w-16 overflow-hidden rounded-full bg-slate-100" style={{ height: 4 }}>
                            <div
                              className={`h-full rounded-full ${
                                score >= 70
                                  ? "bg-green-500"
                                  : score >= 40
                                    ? "bg-amber-400"
                                    : "bg-red-400"
                              }`}
                              style={{ width: `${score}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            <div className="border-t px-5 py-3">
              <Link href="/dashboard/tenders" className="text-xs text-blue-600 hover:underline">
                View all tenders <ArrowRightIcon />
              </Link>
            </div>
          </div>
        </section>
      </div>

      {/* ── 5 + 6. AI provider health + Knowledge vault ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* AI provider health */}
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
            AI Provider Health
          </h2>
          <div className="rounded-lg border bg-white p-6 shadow-sm">
            <div className="space-y-3">
              {providerHealth.map((p) => {
                const cooling = p.cooldownUntil && new Date(p.cooldownUntil) > new Date();
                return (
                  <div key={p.provider} className="flex items-center gap-3">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        !p.configured
                          ? "bg-slate-300"
                          : cooling
                            ? "bg-amber-400"
                            : "bg-green-500"
                      }`}
                    />
                    <span className="w-24 shrink-0 text-sm font-medium capitalize text-slate-700">
                      {p.provider}
                    </span>
                    {!p.configured ? (
                      <span className="text-xs text-slate-400">not configured</span>
                    ) : cooling ? (
                      <span className="text-xs text-amber-600">
                        cooldown until {fmtRelative(p.cooldownUntil)}
                      </span>
                    ) : (
                      <span className="text-xs text-green-600">ready</span>
                    )}
                    {p.lastSuccessAt && (
                      <span className="ml-auto text-xs text-slate-400">
                        last ok {fmtRelative(p.lastSuccessAt)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {lastAiLog && (
              <div className="mt-5 border-t pt-4 text-xs text-slate-500">
                <span className="font-medium">Last AI analysis:</span>{" "}
                {fmtRelative(lastAiLog.createdAt)} —{" "}
                <span className="text-slate-400">{lastAiLog.description}</span>
              </div>
            )}
          </div>
        </section>

        {/* Knowledge vault stats */}
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Knowledge Vault
          </h2>
          <div className="rounded-lg border bg-white p-6 shadow-sm">
            {!company ? (
              <p className="text-sm text-slate-400">
                No company profile set up yet.{" "}
                <Link href="/dashboard/setup" className="text-blue-600 hover:underline">
                  Set up now <ArrowRightIcon />
                </Link>
              </p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <KvStat label="Experts" value={expertCount} href="/dashboard/company" />
                  <KvStat label="Projects" value={projectCount} href="/dashboard/company" />
                  <KvStat label="Documents" value={documentCount} href="/dashboard/company" />
                </div>
                {lastImport && (
                  <p className="mt-4 text-xs text-slate-400">
                    Last updated {fmtRelative(lastImport)}
                  </p>
                )}
                <div className="mt-4 flex gap-3 border-t pt-4">
                  <Link href="/dashboard/company" className="text-xs text-blue-600 hover:underline">
                    View knowledge vault <ArrowRightIcon />
                  </Link>
                  <Link
                    href="/dashboard/company/readiness"
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Readiness check <ArrowRightIcon />
                  </Link>
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      {/* ── 7. Bid Outcome Summary ── */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Bid Outcomes
        </h2>
        {bidOutcomeTenders.length === 0 ? (
          <div className="rounded-lg border bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-400">No bid outcomes recorded yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            <div className="rounded-lg border bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500">Wins</p>
              <p className="mt-2 text-3xl font-bold text-green-600">{winCount}</p>
              <p className="mt-1 text-xs text-slate-400">bids won</p>
            </div>
            <div className="rounded-lg border bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500">Losses</p>
              <p className="mt-2 text-3xl font-bold text-red-500">{lostCount}</p>
              <p className="mt-1 text-xs text-slate-400">bids lost</p>
            </div>
            <div className="rounded-lg border bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500">No Bid</p>
              <p className="mt-2 text-3xl font-bold text-slate-500">{noBidCount}</p>
              <p className="mt-1 text-xs text-slate-400">decided not to bid</p>
            </div>
            <div className="rounded-lg border bg-white p-6 shadow-sm">
              <p className="text-sm font-medium text-slate-500">Win Rate</p>
              {winRate !== null ? (
                <>
                  <p
                    className={`mt-2 text-3xl font-bold ${
                      winRate >= 50 ? "text-green-600" : winRate >= 30 ? "text-amber-600" : "text-red-500"
                    }`}
                  >
                    {winRate}%
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {winCount}/{winRateDenominator} contested bids
                  </p>
                  <div className="mt-2 overflow-hidden rounded-full bg-slate-100" style={{ height: 6 }}>
                    <div
                      className={`h-full rounded-full transition-all ${
                        winRate >= 50 ? "bg-green-500" : winRate >= 30 ? "bg-amber-400" : "bg-red-400"
                      }`}
                      style={{ width: `${winRate}%` }}
                    />
                  </div>
                </>
              ) : (
                <p className="mt-2 text-3xl font-bold text-slate-400">—</p>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── 8 + 9. Proposal quality distribution + recent quality trend ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Proposal quality distribution */}
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Proposal Quality Distribution
          </h2>
          <div className="rounded-lg border bg-white p-6 shadow-sm">
            {proposalScores.length === 0 ? (
              <p className="text-sm text-slate-400">
                No technical proposals with quality scores yet.
              </p>
            ) : (
              <>
                <div className="mb-5 flex items-baseline gap-2">
                  <span
                    className={`text-4xl font-bold ${
                      avgQualityScore !== null
                        ? qualityTextColor(avgQualityScore)
                        : "text-slate-400"
                    }`}
                  >
                    {avgQualityScore ?? "—"}
                  </span>
                  <span className="text-sm text-slate-500">avg quality score</span>
                  <span className="ml-auto text-xs text-slate-400">
                    {proposalScores.length} proposal{proposalScores.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="space-y-3">
                  {(
                    [
                      { label: "Excellent (≥80)", count: excellentCount, color: "bg-green-500", textColor: "text-green-700", bgLight: "bg-green-50" },
                      { label: "Good (60–79)", count: goodCount, color: "bg-amber-400", textColor: "text-amber-700", bgLight: "bg-amber-50" },
                      { label: "Needs work (<60)", count: needsWorkCount, color: "bg-red-400", textColor: "text-red-700", bgLight: "bg-red-50" },
                    ] as const
                  ).map(({ label, count, color, textColor, bgLight }) => {
                    const pct =
                      proposalScores.length > 0
                        ? Math.round((count / proposalScores.length) * 100)
                        : 0;
                    return (
                      <div key={label}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className={`font-medium ${textColor}`}>{label}</span>
                          <span className="text-slate-500">
                            {count} ({pct}%)
                          </span>
                        </div>
                        <div className={`overflow-hidden rounded-full ${bgLight}`} style={{ height: 10 }}>
                          <div
                            className={`h-full rounded-full transition-all ${color}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </section>

        {/* Recent quality trend */}
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Recent Quality Trend
          </h2>
          <div className="rounded-lg border bg-white p-6 shadow-sm">
            {recentProposals.length === 0 ? (
              <p className="text-sm text-slate-400">
                No recent technical proposals with quality scores.
              </p>
            ) : (
              <>
                <p className="mb-4 text-xs text-slate-400">
                  Last {recentProposals.length} technical proposal
                  {recentProposals.length !== 1 ? "s" : ""} — oldest to newest
                </p>
                {/* Sparkline: colored blocks */}
                <div className="flex items-end gap-1.5">
                  {[...recentProposals].reverse().map((p) => {
                    if (p.score === null) {
                      return (
                        <div
                          key={p.id}
                          className="flex flex-1 flex-col items-center gap-1"
                          title="Score unavailable"
                        >
                          <div
                            className="w-full rounded-sm bg-slate-200"
                            style={{ height: 32 }}
                          />
                          <span className="text-[10px] text-slate-400">—</span>
                        </div>
                      );
                    }
                    const barHeight = Math.max(8, Math.round((p.score / 100) * 64));
                    return (
                      <div
                        key={p.id}
                        className="flex flex-1 flex-col items-center gap-1"
                        title={`Score: ${p.score} — ${fmtRelative(p.createdAt)}`}
                      >
                        <div
                          className={`w-full rounded-sm ${qualityColor(p.score)}`}
                          style={{ height: barHeight }}
                        />
                        <span
                          className={`text-[10px] font-medium ${qualityTextColor(p.score)}`}
                        >
                          {p.score}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {/* Legend */}
                <div className="mt-4 flex flex-wrap gap-3 border-t pt-3 text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-500" />
                    Excellent ≥80
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" />
                    Good 60–79
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-400" />
                    Needs work &lt;60
                  </span>
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      {/* ── 10. Readiness score distribution — all tenders ── */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Readiness Score — All Tenders
        </h2>
        <div className="rounded-lg border bg-white shadow-sm">
          {tenders.length === 0 ? (
            <p className="p-6 text-sm text-slate-400">No tenders yet.</p>
          ) : (
            <ol className="divide-y">
              {tenders.map((tender) => {
                const score = Math.round(tender.readinessScore ?? 0);
                const daysLeft = tender.deadline
                  ? Math.ceil((new Date(tender.deadline).getTime() - now) / 86_400_000)
                  : null;
                return (
                  <li key={tender.id} className="flex items-center gap-3 px-5 py-2.5">
                    {/* Score bar */}
                    <div className="flex w-14 shrink-0 flex-col items-end gap-0.5">
                      <span
                        className={`text-xs font-bold ${
                          score >= 70
                            ? "text-green-600"
                            : score >= 40
                              ? "text-amber-600"
                              : "text-red-500"
                        }`}
                      >
                        {score}%
                      </span>
                      <div
                        className="w-full overflow-hidden rounded-full bg-slate-100"
                        style={{ height: 4 }}
                      >
                        <div
                          className={`h-full rounded-full ${
                            score >= 70
                              ? "bg-green-500"
                              : score >= 40
                                ? "bg-amber-400"
                                : "bg-red-400"
                          }`}
                          style={{ width: `${score}%` }}
                        />
                      </div>
                    </div>
                    {/* Tender info */}
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/dashboard/tenders/${tender.id}`}
                        className="block truncate text-sm font-medium text-slate-900 hover:text-blue-600"
                      >
                        {tender.title}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColor(tender.status)}`}
                        >
                          {statusLabel(tender.status)}
                        </span>
                        {tender.deadline && (
                          <span
                            className={`text-[10px] ${
                              daysLeft !== null && daysLeft <= 7
                                ? "text-amber-600"
                                : "text-slate-400"
                            }`}
                          >
                            {daysLeft !== null && daysLeft < 0
                              ? "Overdue"
                              : `Due ${formatDate(tender.deadline)}`}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>
        </>
      )}
    </div>
  );
}

// ─── micro-components ──────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: "green" | "amber" | "red";
}) {
  const accentClass =
    accent === "green"
      ? "text-green-600"
      : accent === "amber"
        ? "text-amber-600"
        : accent === "red"
          ? "text-red-500"
          : "text-slate-900";
  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${accentClass}`}>{value}</p>
    </div>
  );
}

function KvStat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="group block rounded-lg border p-4 text-center hover:border-slate-400">
      <p className="text-2xl font-bold text-slate-900 group-hover:text-blue-600">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </Link>
  );
}
