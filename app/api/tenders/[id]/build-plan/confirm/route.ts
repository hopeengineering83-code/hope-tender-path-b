import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { computeTenderBuildPlanHash, validateBuildPlanForConfirmation } from "../../../../../../lib/engine/build-plan";
import { logAction } from "../../../../../../lib/audit";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  await prismaReady;
  const { id } = await params;
  const draft = await (prisma as any).buildPlan.findFirst({ where: { tenderId: id, status: "DRAFT", tender: { userId: actor.id } }, orderBy: { updatedAt: "desc" } });
  if (!draft) return NextResponse.json({ ok: false, code: "BUILD_PLAN_DRAFT_MISSING", error: "Build Plan draft missing." }, { status: 404 });
  const items = JSON.parse(draft.itemsJson || "[]");
  const validation = await validateBuildPlanForConfirmation(prisma, id, actor.id, items);
  const contentHash = await computeTenderBuildPlanHash(prisma, id, actor.id, items);
  if (!contentHash || contentHash !== draft.contentHash || !validation.ok) {
    await (prisma as any).buildPlan.update({ where: { id: draft.id }, data: { validationJson: JSON.stringify(validation), contentHash: contentHash ?? draft.contentHash } });
    return NextResponse.json({ ok: false, code: "BUILD_PLAN_CONFIRMATION_BLOCKED", blockers: validation.blockers.concat(contentHash !== draft.contentHash ? ["Build Plan hash is stale; rebuild before confirming."] : []) }, { status: 422 });
  }
  await (prisma as any).buildPlan.deleteMany({ where: { tenderId: id, status: "CONFIRMED" } });
  const confirmed = await (prisma as any).buildPlan.update({ where: { id: draft.id }, data: { status: "CONFIRMED", confirmedRevision: draft.revision, confirmedContentHash: contentHash, confirmedById: actor.id, confirmedAt: new Date(), validationJson: JSON.stringify({ ok: true, blockers: [] }) } });
  await logAction({ userId: actor.id, action: "SUBMISSION_PLAN_BUILT", entityType: "Tender", entityId: id, description: "Build Plan confirmed after source-grounded validation.", metadata: { tenderId: id, revision: confirmed.revision, contentHash } });
  return NextResponse.json({ ok: true, status: confirmed.status, revision: confirmed.revision, confirmedContentHash: confirmed.confirmedContentHash, authorizesGeneration: true });
}
