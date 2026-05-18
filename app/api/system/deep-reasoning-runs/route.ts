import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../lib/auth";

/**
 * Recent TENDER_DEEP_REASONING_RUN audit-log entries — operators
 * can query historical deep-reasoning usage without going through
 * Prisma Studio or the database directly.
 *
 * GET /api/system/deep-reasoning-runs?limit=20&tenderId=...&userId=...
 *
 * Auth: ADMIN or PROPOSAL_MANAGER. Returns the most recent N audit
 * rows (default 20, cap 100) optionally filtered by tenderId or
 * userId. Metadata is returned as parsed JSON so consumers can
 * read per-step telemetry without re-parsing.
 *
 * Read-only — no mutations.
 */
export async function GET(req: Request) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  if (!["ADMIN", "PROPOSAL_MANAGER"].includes(actor.role)) return forbiddenResponse();

  await prismaReady;

  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;
  const tenderIdFilter = url.searchParams.get("tenderId");
  const userIdFilter = url.searchParams.get("userId");

  const where: Record<string, unknown> = { action: "TENDER_DEEP_REASONING_RUN" };
  if (tenderIdFilter) where.entityId = tenderIdFilter;
  if (userIdFilter) where.userId = userIdFilter;

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const runs = rows.map((row) => {
    let metadata: unknown = null;
    if (row.metadata) {
      try {
        metadata = JSON.parse(row.metadata);
      } catch {
        // Leave as null when stored metadata isn't valid JSON.
      }
    }
    return {
      id: row.id,
      createdAt: row.createdAt,
      tenderId: row.entityId,
      userId: row.userId,
      description: row.description,
      metadata,
    };
  });

  // Roll-up aggregate stats for the operator: total runs, average
  // call count, average AI time. Cheap because we're aggregating
  // the already-fetched page; if the operator wants global stats
  // they can raise the limit.
  const aggregates = (() => {
    const callCounts: number[] = [];
    const totalMsValues: number[] = [];
    for (const run of runs) {
      const meta = run.metadata as Record<string, unknown> | null;
      const telemetry = meta && typeof meta === "object" ? meta.telemetry : null;
      if (telemetry && typeof telemetry === "object") {
        const t = telemetry as Record<string, unknown>;
        if (typeof t.totalCalls === "number") callCounts.push(t.totalCalls);
        if (typeof t.totalMs === "number") totalMsValues.push(t.totalMs);
      }
    }
    const avg = (arr: number[]): number | null => arr.length === 0 ? null : Math.round((arr.reduce((s, n) => s + n, 0) / arr.length) * 10) / 10;
    return {
      runsInWindow: runs.length,
      averageCallsPerRun: avg(callCounts),
      averageMsPerRun: avg(totalMsValues),
    };
  })();

  return NextResponse.json({ runs, aggregates });
}
