import { logger } from "../../../../../../lib/observability";
import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { buildAndVerifyBuildPlan } from "../../../../../../lib/engine/automatic-build-plan";
import { logAction } from "../../../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../../lib/request-id";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Compatibility endpoint for older clients.
 *
 * It delegates to the same automatic, source-grounded Build Plan authority as
 * POST /api/tenders/[id]/build-plan. It never creates GeneratedDocument rows,
 * never leaves a competing DRAFT workflow, and never requires a human
 * confirmation token.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (error) { return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const rl = rateLimit(`submission-plan-build:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded. Please wait and retry.", code: "RATE_LIMITED", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  try {
    await prismaReady;
    const { id } = await params;
    const beforeDocs = await prisma.generatedDocument.count({ where: { tenderId: id } });
    const result = await buildAndVerifyBuildPlan(prisma, id, actor.id, { reuseCurrent: false });
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.message,
          code: result.code,
          blockers: result.blockers ?? [],
          authorizesGeneration: false,
          automaticVerificationPending: true,
        },
        { status: result.status },
      );
    }

    const afterDocs = await prisma.generatedDocument.count({ where: { tenderId: id } });
    await logAction({
      userId: actor.id,
      action: "SUBMISSION_PLAN_BUILT",
      entityType: "Tender",
      entityId: id,
      description: `Build Plan automatically derived and source-verified via compatibility endpoint — revision ${result.revision}; ${result.items.length} planned files; ${afterDocs - beforeDocs} GeneratedDocument rows created.`,
      metadata: {
        tenderId: id,
        created: 0,
        skipped: 0,
        total: result.items.length,
        isDerivedDraft: false,
        contentHash: result.contentHash,
        revision: result.revision,
        confirmationMode: result.confirmationMode,
        generatedDocumentsCreated: afterDocs - beforeDocs,
      },
      requestId,
    });

    return NextResponse.json({
      ok: true,
      created: 0,
      skipped: 0,
      total: result.items.length,
      contentHash: result.contentHash,
      revision: result.revision,
      status: result.status,
      state: "CONFIRMED",
      items: result.items,
      confirmationMode: result.confirmationMode,
      authorizesGeneration: true,
      automaticVerificationPending: false,
      generatedDocumentsCreated: afterDocs - beforeDocs,
    });
  } catch (error) {
    logger.error("submission-plan/build POST failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json(
      {
        ok: false,
        code: "BUILD_PLAN_RUNTIME_ERROR",
        error: "Build Plan could not be automatically derived and verified. Retry or contact support with the request ID.",
        requestId,
      },
      { status: 500 },
    );
  }
}
