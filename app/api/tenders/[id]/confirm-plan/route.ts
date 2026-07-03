import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { confirmSubmissionPlan } from "../../../../../lib/engine/persisted-submission-plan";
import { extractRequestId } from "../../../../../lib/request-id";
import { logger } from "../../../../../lib/observability";

export const dynamic = "force-dynamic";

type ConfirmPlanBody = {
  expectedSourceContentHash?: unknown;
  expectedRequirementsHash?: unknown;
  sourceContentHash?: unknown;
  requirementsHash?: unknown;
};

function safeError(code: string, message: string, requestId: string, status: number) {
  return NextResponse.json({ ok: false, code, error: message, requestId }, { status });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  await prismaReady;
  const { id: tenderId } = await params;
  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId: actor.id }, select: { id: true } });
  if (!tender) return safeError("TENDER_NOT_FOUND", "Tender not found or not accessible.", requestId, 404);

  try {
    const body = (await req.json().catch(() => ({}))) as ConfirmPlanBody;
    const expectedSourceContentHash = body.expectedSourceContentHash ?? body.sourceContentHash;
    const expectedRequirementsHash = body.expectedRequirementsHash ?? body.requirementsHash;
    if (typeof expectedSourceContentHash !== "string" || typeof expectedRequirementsHash !== "string") {
      return safeError("PLAN_CONFIRMATION_HASHES_REQUIRED", "Current source and requirements hashes are required to confirm the plan.", requestId, 400);
    }

    const result = await confirmSubmissionPlan(tenderId, actor.id, expectedSourceContentHash, expectedRequirementsHash);
    if (!result.ok) {
      return safeError(result.code, result.error, requestId, result.code === "PLAN_STALE_REBUILD_REQUIRED" ? 409 : 422);
    }

    await logAction({
      userId: actor.id,
      action: "SUBMISSION_PLAN_CONFIRMED",
      entityType: "Tender",
      entityId: tenderId,
      description: `Submission plan confirmed (revision ${result.revision})`,
      metadata: { tenderId, planId: result.planId, revision: result.revision, confirmationHash: result.confirmationHash },
    });

    return NextResponse.json({ ok: true, planId: result.planId, revision: result.revision, confirmationHash: result.confirmationHash, status: "CONFIRMED" });
  } catch (error) {
    logger.error("[confirm-plan] failed", { requestId, tenderId, detail: error });
    return safeError("PLAN_CONFIRMATION_FAILED", "Plan confirmation failed. Try again or rebuild the plan.", requestId, 500);
  }
}