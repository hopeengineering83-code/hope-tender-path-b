import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { buildDraftBuildPlan } from "../../../../../lib/engine/build-plan";
import { logAction } from "../../../../../lib/audit";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  await prismaReady;
  const { id } = await params;
  const before = await prisma.generatedDocument.count({ where: { tenderId: id } });
  // buildDraftBuildPlan returns a typed result: { ok: true, plan, items } or
  // { ok: false, code, message, status }. Failed preflight never returns 404
  // — it returns the real blocker code (extraction, analysis, grounding, etc.).
  // Only a genuinely missing/foreign tender returns 404.
  const draftResult = await buildDraftBuildPlan(prisma, id, actor.id);
  if (!draftResult.ok) {
    return NextResponse.json({ ok: false, code: draftResult.code, error: draftResult.message }, { status: draftResult.status });
  }
  const { plan, items } = draftResult;
  const after = await prisma.generatedDocument.count({ where: { tenderId: id } });
  await logAction({ userId: actor.id, action: "TENDER_PLAN_BUILT", entityType: "Tender", entityId: id, description: "Draft Build Plan built with zero GeneratedDocument rows created.", metadata: { tenderId: id, generatedDocumentsCreated: after - before } });
  return NextResponse.json({ ok: true, status: plan.status, revision: plan.revision, contentHash: plan.contentHash, items, authorizesGeneration: false, generatedDocumentsCreated: after - before });
}
