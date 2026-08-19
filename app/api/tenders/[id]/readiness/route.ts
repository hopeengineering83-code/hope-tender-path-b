import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getCanonicalTenderReadiness } from "../../../../../lib/canonical-tender-readiness";
import { getCanonicalReleaseDecision } from "../../../../../lib/canonical-release-decision";
import { randomUUID } from "node:crypto";

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

  const { id: tenderId } = await params;

  try {
    await prismaReady;
    const readiness = await getCanonicalTenderReadiness(prisma, userId, tenderId);
    if (!readiness) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

    // Gap 5: include the CanonicalReleaseDecision so every consumer gets the
    // same five-status classification from the single authority.
    const releaseDecision = await getCanonicalReleaseDecision(prisma, userId, tenderId);

    return NextResponse.json({ readiness, releaseDecision });
  } catch (error) {
    const diagnosticId = randomUUID();
    logger.error("[readiness]", {
      route: "/api/tenders/[id]/readiness",
      tenderId,
      diagnosticId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({
      error: "Readiness panel failed to load.",
      panel: "readiness",
      endpoint: "/api/tenders/[id]/readiness",
      diagnosticId,
      code: "READINESS_RUNTIME_ERROR",
      retryable: true,
      staleDataPossible: false,
    }, { status: 500 });
  }
}
