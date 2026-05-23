import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getCanonicalTenderReadiness } from "../../../../../lib/canonical-tender-readiness";

export const dynamic = "force-dynamic";

/**
 * GET /api/tenders/[id]/readiness
 * Canonical single-call readiness summary: combines analysis quality,
 * matching state, generation readiness, and final export readiness into
 * one response so the UI doesn't need to fan out to multiple endpoints.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id: tenderId } = await params;
  const readiness = await getCanonicalTenderReadiness(prisma, userId, tenderId);
  if (!readiness) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  return NextResponse.json({ readiness });
}
