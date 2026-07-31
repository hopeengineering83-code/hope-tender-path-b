import { NextResponse } from "next/server";
import {
  forbiddenResponse,
  requireRole,
  unauthorizedResponse,
} from "../../../../../../lib/auth";
import { logAction } from "../../../../../../lib/audit";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import {
  MUTATION_RATE_LIMIT,
  rateLimit,
} from "../../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../../lib/request-id";
import { logger } from "../../../../../../lib/observability";
import { reconcileAutomaticRequirementCoverage } from "../../../../../../lib/engine/automatic-requirement-coverage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Reconciles historical or newly changed tenders without a confirmation click.
 * The same service runs inside ENGINE_RUN. This endpoint exists so an already
 * created tender repairs itself when its coverage panel is first opened.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = extractRequestId(req);
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  const rl = rateLimit(`requirement-coverage-auto-sync:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { ok: false, error: "Too many requests", code: "RATE_LIMITED", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  try {
    await prismaReady;
    const { id } = await params;
    const ownedTender = await prisma.tender.findFirst({
      where: { id, userId: actor.id },
      select: { id: true },
    });
    if (!ownedTender) {
      return NextResponse.json(
        { ok: false, error: "Tender not found", code: "TENDER_NOT_FOUND" },
        { status: 404 },
      );
    }

    const result = await reconcileAutomaticRequirementCoverage(
      prisma,
      id,
      actor.id,
    );

    await logAction({
      userId: actor.id,
      action: "AUTOMATIC_REQUIREMENT_COVERAGE_RECONCILED",
      entityType: "Tender",
      entityId: id,
      description: `Automatic requirement coverage reconciled: ${result.desiredLinks} current link(s), ${result.remainingUngrounded.length} ungrounded, ${result.remainingWithoutEligibleEvidence.length} true evidence gap(s).`,
      metadata: {
        requestId,
        sourceRepairChecked: result.sourceRepair.checkedCount,
        sourceRepairRepaired: result.sourceRepair.repairedCount,
        sourceRepairRemaining: result.sourceRepair.remainingCount,
        requirementsChecked: result.requirementsChecked,
        groundedRequirements: result.groundedRequirements,
        desiredLinks: result.desiredLinks,
        created: result.created,
        updated: result.updated,
        removedStale: result.removedStale,
        unchanged: result.unchanged,
        remainingUngrounded: result.remainingUngrounded.length,
        remainingWithoutEligibleEvidence: result.remainingWithoutEligibleEvidence.length,
      },
      requestId,
    });

    return NextResponse.json({
      ...result,
      automatic: true,
      manualConfirmationRequired: false,
      requestId,
    }, { status: result.ok ? 200 : 422 });
  } catch (error) {
    logger.error("automatic requirement coverage reconciliation failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json(
      {
        ok: false,
        error: "Automatic requirement coverage could not be reconciled.",
        code: "AUTOMATIC_REQUIREMENT_COVERAGE_FAILED",
        requestId,
      },
      { status: 500 },
    );
  }
}
