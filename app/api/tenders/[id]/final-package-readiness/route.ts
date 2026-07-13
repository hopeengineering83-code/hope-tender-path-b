import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { rateLimit, API_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { getFinalPackageReadinessModel } from "../../../../../lib/engine/final-package-readiness-model";
import { extractRequestId } from "../../../../../lib/request-id";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    const rl = rateLimit(`final-package-readiness:${actor.id}`, API_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ ok: false, error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 });

    await prismaReady;
    const { id } = await params;

    // Resolve ownership explicitly instead of deriving HTTP status from an
    // exception string emitted by a downstream model.
    const tender = await prisma.tender.findFirst({
      where: { id, userId: actor.id },
      select: { id: true },
    });
    if (!tender) {
      return NextResponse.json(
        { ok: false, error: "Tender not found", code: "TENDER_NOT_FOUND" },
        { status: 404 },
      );
    }

    const model = await getFinalPackageReadinessModel(prisma, id, actor.id);
    const contradictions = [];
    if (model.documents.required.length > 0 && model.documents.planned.length === 0) {
      contradictions.push({
        area: "documents",
        reason: "Required docs count differs between plan and final package model",
        values: { required: model.documents.required.length, plan: model.documents.planned.length },
      });
    }

    return NextResponse.json(
      { ok: true, tenderId: id, model, contradictions },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logger.error("final-package-readiness GET failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json(
      {
        ok: false,
        error: "Final package readiness could not be evaluated.",
        code: "FINAL_PACKAGE_READINESS_FAILED",
        requestId,
      },
      { status: 500 },
    );
  }
}
