import { NextResponse } from "next/server";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_req: Request) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prismaReady;

  // Paginated + filtered — was unbounded (loaded ALL tenders + ALL compliance
  // gaps). Now: take 100 most recent (analytics doesn't need historical
  // tenders from years ago), filter complianceGaps to unresolved-only.
  const tenders = await prisma.tender.findMany({
    where: { userId },
    select: {
      id: true,
      status: true,
      bidOutcome: true,
      bidOutcomeAt: true,
      budget: true,
      currency: true,
      readinessScore: true,
      createdAt: true,
      deadline: true,
      complianceGaps: { select: { severity: true, isResolved: true }, where: { isResolved: false } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Outcome summary
  const decided = tenders.filter((t) => t.bidOutcome && t.bidOutcome !== "PENDING");
  const won = decided.filter((t) => t.bidOutcome === "WON");
  const lost = decided.filter((t) => t.bidOutcome === "LOST");
  const withdrawn = decided.filter((t) => t.bidOutcome === "WITHDRAWN");
  const pending = tenders.filter((t) => t.bidOutcome === "PENDING");

  const winRate = decided.length > 0 ? Math.round((won.length / decided.length) * 100) : null;

  // Pipeline value
  const activeBudgets = tenders.filter((t) => !["DRAFT", "CLOSED"].includes(t.status) && t.budget);
  const pipelineValue = activeBudgets.reduce((s, t) => s + (t.budget ?? 0), 0);

  // Won value
  const wonValue = won.filter((t) => t.budget).reduce((s, t) => s + (t.budget ?? 0), 0);

  // Avg readiness
  const scored = tenders.filter((t) => (t.readinessScore ?? 0) > 0);
  const avgReadiness = scored.length > 0
    ? Math.round(scored.reduce((s, t) => s + (t.readinessScore ?? 0), 0) / scored.length)
    : null;

  // Monthly trend (last 12 months of createdAt)
  const now = new Date();
  const monthTrend: { month: string; created: number; won: number; lost: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const created = tenders.filter((t) => {
      const c = new Date(t.createdAt);
      return c.getFullYear() === d.getFullYear() && c.getMonth() === d.getMonth();
    }).length;
    const wonM = won.filter((t) => {
      const at = t.bidOutcomeAt ? new Date(t.bidOutcomeAt) : null;
      return at && at.getFullYear() === d.getFullYear() && at.getMonth() === d.getMonth();
    }).length;
    const lostM = lost.filter((t) => {
      const at = t.bidOutcomeAt ? new Date(t.bidOutcomeAt) : null;
      return at && at.getFullYear() === d.getFullYear() && at.getMonth() === d.getMonth();
    }).length;
    monthTrend.push({ month: label, created, won: wonM, lost: lostM });
  }

  // Status distribution
  const statusDist: Record<string, number> = {};
  for (const t of tenders) {
    statusDist[t.status] = (statusDist[t.status] ?? 0) + 1;
  }

  // Compliance health
  const totalCritical = tenders.reduce((s, t) => s + t.complianceGaps.filter((g) => !g.isResolved && g.severity === "CRITICAL").length, 0);
  const totalHigh = tenders.reduce((s, t) => s + t.complianceGaps.filter((g) => !g.isResolved && g.severity === "HIGH").length, 0);

  return NextResponse.json({
    summary: {
      total: tenders.length,
      decided: decided.length,
      won: won.length,
      lost: lost.length,
      withdrawn: withdrawn.length,
      pending: pending.length,
      winRate,
      pipelineValue,
      wonValue,
      avgReadiness,
      criticalGaps: totalCritical,
      highGaps: totalHigh,
    },
    monthTrend,
    statusDist,
  });
}
