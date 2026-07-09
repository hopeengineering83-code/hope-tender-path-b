import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { rateLimit, API_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { sanitizeError } from "../../../../../lib/sanitize-error";
import { getFinalPackageReadinessModel } from "../../../../../lib/engine/final-package-readiness-model";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
    const rl = rateLimit(`final-package-readiness:${actor.id}`, API_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
    await prismaReady;
    const { id } = await params;
    const model = await getFinalPackageReadinessModel(prisma, id, actor.id);
    const contradictions = [];
    if (model.documents.required.length > 0 && model.documents.planned.length === 0) contradictions.push({ area: "documents", reason: "Required docs count differs between plan and final package model", values: { required: model.documents.required.length, plan: model.documents.planned.length } });
    return NextResponse.json({ ok: true, tenderId: id, model, contradictions }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const safe = sanitizeError(error);
    return NextResponse.json({ ok: false, error: safe, code: "FINAL_PACKAGE_READINESS_FAILED" }, { status: /not found/i.test(safe) ? 404 : 500 });
  }
}
