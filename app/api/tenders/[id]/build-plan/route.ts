import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { buildDraftBuildPlan } from "../../../../../lib/engine/build-plan";
import { logAction } from "../../../../../lib/audit";
import { extractRequestId } from "../../../../../lib/request-id";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  try {
    await prismaReady;
    const { id } = await params;
    const before = await prisma.generatedDocument.count({ where: { tenderId: id } });

    // buildDraftBuildPlan returns a typed result: { ok: true, plan, items } or
    // { ok: false, code, message, status }. Failed preflight keeps its exact
    // domain blocker; only unexpected runtime failures use the stable 500 below.
    const draftResult = await buildDraftBuildPlan(prisma, id, actor.id);
    if (!draftResult.ok) {
      return NextResponse.json(
        { ok: false, code: draftResult.code, error: draftResult.message },
        { status: draftResult.status },
      );
    }

    const { plan, items } = draftResult;
    const after = await prisma.generatedDocument.count({ where: { tenderId: id } });
    await logAction({
      userId: actor.id,
      action: "TENDER_PLAN_BUILT",
      entityType: "Tender",
      entityId: id,
      description: "Draft Build Plan built with zero GeneratedDocument rows created.",
      metadata: { tenderId: id, generatedDocumentsCreated: after - before },
      requestId,
    });

    return NextResponse.json({
      ok: true,
      status: plan.status,
      revision: plan.revision,
      contentHash: plan.contentHash,
      items,
      authorizesGeneration: false,
      generatedDocumentsCreated: after - before,
    });
  } catch (error) {
    logger.error("build-plan POST failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json(
      {
        ok: false,
        code: "BUILD_PLAN_RUNTIME_ERROR",
        error: "Build Plan could not be created. Retry or contact support with the request ID.",
        requestId,
      },
      { status: 500 },
    );
  }
}
