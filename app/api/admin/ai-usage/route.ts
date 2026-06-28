// Admin endpoint for per-tenant AI cost monitoring (OBS-004).
//
// GET /api/admin/ai-usage
//   Query params (all optional):
//     sinceDays=<int>   — look-back window in days (default 7, max 90)
//     userId=<uuid>     — restrict to a single tenant
//     tenderId=<uuid>   — restrict to a single tender
//     provider=<string> — restrict to a single provider
//
// Returns an aggregated usage summary. Admins see all tenants by default;
// passing ?userId=<id> narrows the result to one tenant.
//
// Auth: ADMIN only.

import { NextRequest, NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { logger } from "../../../../lib/observability";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

function err(message: string, status = 500, extra: Record<string, unknown> = {}) {
  const code = typeof extra.code === "string" ? extra.code : "AI_USAGE_ERROR";
  return NextResponse.json({ ok: false, success: false, code, error: message, message, ...extra }, { status });
}

function parseSinceDays(raw: string | null): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return 7;
  return Math.min(n, 90);
}

export async function GET(req: NextRequest) {
  try {
    let actor;
    try {
      actor = await requireRole("ADMIN");
    } catch (e) {
      return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
    }

    const url = req.nextUrl ?? new URL(req.url);
    const sinceDays = parseSinceDays(url.searchParams.get("sinceDays"));
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const userId = url.searchParams.get("userId");
    const tenderId = url.searchParams.get("tenderId");
    const provider = url.searchParams.get("provider");

    await prismaReady;

    const where: {
      createdAt: { gte: Date };
      userId?: string;
      tenderId?: string;
      provider?: string;
    } = { createdAt: { gte: since } };
    if (userId) where.userId = userId;
    if (tenderId) where.tenderId = tenderId;
    if (provider) where.provider = provider;

    // Aggregate counts and token totals in a single grouped query.
    const grouped = await prisma.aiUsageRecord.groupBy({
      by: ["provider", "success"],
      where,
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true },
    });

    const byProvider: Record<string, { calls: number; tokens: number }> = {};
    let totalCalls = 0;
    let successfulCalls = 0;
    let failedCalls = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const row of grouped) {
      const calls = row._count._all;
      const tokens = (row._sum.inputTokens ?? 0) + (row._sum.outputTokens ?? 0);
      totalCalls += calls;
      totalInputTokens += row._sum.inputTokens ?? 0;
      totalOutputTokens += row._sum.outputTokens ?? 0;
      if (row.success) successfulCalls += calls;
      else failedCalls += calls;
      const entry = byProvider[row.provider] ?? { calls: 0, tokens: 0 };
      entry.calls += calls;
      entry.tokens += tokens;
      byProvider[row.provider] = entry;
    }

    // Per-tenant roll-up (only meaningful for the admin "all tenants" view).
    let perTenant: Array<{ userId: string; totalCalls: number; totalTokens: number }> = [];
    if (!userId) {
      const tenantRows = await prisma.aiUsageRecord.groupBy({
        by: ["userId"],
        where,
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true },
      });
      perTenant = tenantRows
        .map((r) => ({
          userId: r.userId,
          totalCalls: r._count._all,
          totalTokens: (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0),
        }))
        .sort((a, b) => b.totalCalls - a.totalCalls)
        .slice(0, 50);
    }

    return NextResponse.json({
      success: true,
      filter: {
        sinceDays,
        since: since.toISOString(),
        userId: userId ?? null,
        tenderId: tenderId ?? null,
        provider: provider ?? null,
      },
      requestedBy: actor.id,
      summary: {
        totalCalls,
        successfulCalls,
        failedCalls,
        totalInputTokens,
        totalOutputTokens,
        byProvider,
      },
      perTenant,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("admin/ai-usage GET failed", { error: error instanceof Error ? error.message : String(error) });
    return err("AI usage lookup failed.", 500, {
      code: "AI_USAGE_RUNTIME_ERROR",
      correlationId: require("crypto").randomUUID().slice(0, 8),
    });
  }
}
