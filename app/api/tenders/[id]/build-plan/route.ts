import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getCurrentConfirmedBuildPlan } from "../../../../../lib/engine/build-plan";
import { buildAndVerifyBuildPlan } from "../../../../../lib/engine/automatic-build-plan";
import { logAction } from "../../../../../lib/audit";
import { extractRequestId } from "../../../../../lib/request-id";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  try {
    await prismaReady;
    const { id } = await params;
    const tender = await prisma.tender.findFirst({
      where: { id, userId: actor.id },
      select: { id: true },
    });
    if (!tender) {
      return NextResponse.json(
        { ok: false, code: "TENDER_NOT_FOUND", error: "Tender not found." },
        { status: 404 },
      );
    }

    const persisted = await prisma.buildPlan.findUnique({
      where: { tenderId: id },
      select: {
        status: true,
        revision: true,
        itemsJson: true,
        confirmedAt: true,
        confirmedBy: true,
      },
    });
    if (!persisted) {
      return NextResponse.json({
        ok: true,
        state: "NOT_BUILT",
        authorizesGeneration: false,
        automaticVerificationPending: true,
        items: [],
      });
    }

    let items: unknown[];
    try {
      const parsed = JSON.parse(persisted.itemsJson || "[]");
      if (!Array.isArray(parsed)) throw new Error("itemsJson is not an array");
      items = parsed;
    } catch {
      return NextResponse.json(
        {
          ok: false,
          code: "BUILD_PLAN_ITEMS_CORRUPTED",
          error: "The saved Build Plan cannot be read. Rebuild it so automatic verification can run again.",
          authorizesGeneration: false,
        },
        { status: 409 },
      );
    }

    if (persisted.status === "CONFIRMED") {
      const confirmed = await getCurrentConfirmedBuildPlan(prisma, id, actor.id);
      if (!confirmed.ok) {
        return NextResponse.json({
          ok: true,
          state: "STALE_CONFIRMED",
          revision: persisted.revision,
          items,
          blocker: confirmed.blocker,
          authorizesGeneration: false,
          automaticVerificationPending: true,
        });
      }
      return NextResponse.json({
        ok: true,
        state: "CONFIRMED",
        revision: persisted.revision,
        items: confirmed.items,
        confirmedAt: persisted.confirmedAt,
        confirmationMode: persisted.confirmedBy === "SYSTEM_AUTOMATION"
          ? "AUTOMATIC_SOURCE_GROUNDED"
          : "LEGACY_MANUAL",
        authorizesGeneration: true,
        automaticVerificationPending: false,
      });
    }

    return NextResponse.json({
      ok: true,
      state: "DRAFT",
      revision: persisted.revision,
      items,
      authorizesGeneration: false,
      automaticVerificationPending: true,
    });
  } catch (error) {
    logger.error("build-plan GET failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json(
      {
        ok: false,
        code: "BUILD_PLAN_STATUS_RUNTIME_ERROR",
        error: "Build Plan status could not be loaded. Retry or contact support with the request ID.",
        requestId,
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  try {
    await prismaReady;
    const { id } = await params;
    const before = await prisma.generatedDocument.count({ where: { tenderId: id } });
    const result = await buildAndVerifyBuildPlan(prisma, id, actor.id, { reuseCurrent: false });
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          code: result.code,
          error: result.message,
          blockers: result.blockers ?? [],
          authorizesGeneration: false,
          automaticVerificationPending: true,
        },
        { status: result.status },
      );
    }

    const after = await prisma.generatedDocument.count({ where: { tenderId: id } });
    await logAction({
      userId: actor.id,
      action: "TENDER_PLAN_BUILT",
      entityType: "Tender",
      entityId: id,
      description: "Build Plan automatically derived and source-verified with zero GeneratedDocument rows created.",
      metadata: {
        tenderId: id,
        revision: result.revision,
        contentHash: result.contentHash,
        confirmationMode: result.confirmationMode,
        generatedDocumentsCreated: after - before,
      },
      requestId,
    });

    return NextResponse.json({
      ok: true,
      status: result.status,
      state: "CONFIRMED",
      revision: result.revision,
      contentHash: result.contentHash,
      items: result.items,
      confirmationMode: result.confirmationMode,
      authorizesGeneration: true,
      automaticVerificationPending: false,
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
        error: "Build Plan could not be automatically derived and verified. Retry or contact support with the request ID.",
        requestId,
      },
      { status: 500 },
    );
  }
}
