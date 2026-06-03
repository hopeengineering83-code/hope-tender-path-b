import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { getSession } from "../../../../lib/auth";
import { API_RATE_LIMIT, rateLimit } from "../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /api/tenders/summary
 *
 * Returns lightweight aggregate counts for the current user's tenders and
 * generated documents. Uses groupBy (COUNT queries only) — no large field
 * selection such as fileContent is loaded.
 */
export async function GET(req: Request) {
  const userId = await getSession();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = rateLimit(`tender-summary:${userId}`, API_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: "Rate limit exceeded", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  await prismaReady;

  const [tenderCounts, docCounts] = await Promise.all([
    prisma.tender.groupBy({
      by: ["status"],
      where: { userId },
      _count: { id: true },
    }),
    prisma.generatedDocument.groupBy({
      by: ["reviewStatus"],
      where: { tender: { userId } },
      _count: { id: true },
    }),
  ]);

  return NextResponse.json({
    tenders: tenderCounts.map((r) => ({ status: r.status, count: r._count.id })),
    documents: docCounts.map((r) => ({ status: r.reviewStatus, count: r._count.id })),
    timestamp: new Date().toISOString(),
  });
}
