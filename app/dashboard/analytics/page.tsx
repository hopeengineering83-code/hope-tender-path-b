import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { getAllProviderHealth } from "../../../lib/ai-provider-health";
import { formatDate, TENDER_STATUSES } from "../../../lib/tender-workflow";

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
  };
  return map[status] ?? "bg-slate-100 text-slate-600";
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

// ─── page ─────────────────────────────────────────────────────────────────

export default async function AnalyticsPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  // ── Fetch all tenders for this user (lean select) ────────────────────────
  const [tenders, auditLogs, company] = await Promise.all([
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
      where: { userId },
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
            experts: true,
            projects: true,
            documents: true,
          },
        },
      },
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

  return (
    <div className="space-y-8">
      {/* ── Page header ── */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Analytics</h1>
        <p className="mt-1 text-sm text-slate-500">
          Pipeline overview, activity, and AI provider health
        </p>
      </div>

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
                View full activity log →
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
                View all tenders →
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
                  Set up now →
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
                    View knowledge vault →
                  </Link>
                  <Link
                    href="/dashboard/company/readiness"
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Readiness check →
                  </Link>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
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
