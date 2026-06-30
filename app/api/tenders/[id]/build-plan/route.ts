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
  const plan = await buildDraftBuildPlan(prisma, id, actor.id);
  if (!plan) return NextResponse.json({ ok: false, code: "TENDER_NOT_FOUND", error: "Tender not found" }, { status: 404 });
  const after = await prisma.generatedDocument.count({ where: { tenderId: id } });
  await logAction({ userId: actor.id, action: "TENDER_PLAN_BUILT", entityType: "Tender", entityId: id, description: "Draft Build Plan built with zero GeneratedDocument rows created.", metadata: { tenderId: id, generatedDocumentsCreated: after - before } });
  return NextResponse.json({ ok: true, status: plan.status, revision: plan.revision, contentHash: plan.contentHash, items: JSON.parse(plan.itemsJson), authorizesGeneration: false, generatedDocumentsCreated: after - before });
}
