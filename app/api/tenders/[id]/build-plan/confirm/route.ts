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
  const result = await prisma.$transaction(async (tx) => {
    const draft = await (tx as any).buildPlan.findFirst({ where: { tenderId: id, status: "DRAFT", tender: { userId: actor.id } }, orderBy: { updatedAt: "desc" } });
    if (!draft) return { status: 404 as const, body: { ok: false, code: "BUILD_PLAN_DRAFT_MISSING", error: "Build Plan draft missing." } };
    const items = JSON.parse(draft.itemsJson || "[]");
    const validation = await validateBuildPlanForConfirmation(tx as any, id, actor.id, items);
    const contentHash = await computeTenderBuildPlanHash(tx as any, id, actor.id, items);
    const staleBlockers = !contentHash || contentHash !== draft.contentHash ? ["Build Plan hash is stale; rebuild before confirming."] : [];
    if (staleBlockers.length > 0 || !validation.ok) {
      await (tx as any).buildPlan.update({ where: { id: draft.id }, data: { validationJson: JSON.stringify({ ok: false, blockers: validation.blockers.concat(staleBlockers) }), contentHash: contentHash ?? draft.contentHash } });
      return { status: 422 as const, body: { ok: false, code: "BUILD_PLAN_CONFIRMATION_BLOCKED", blockers: validation.blockers.concat(staleBlockers), authorizesGeneration: false } };
    }
    await (tx as any).buildPlan.deleteMany({ where: { tenderId: id, status: "CONFIRMED" } });
    const confirmed = await (tx as any).buildPlan.update({ where: { id: draft.id }, data: { status: "CONFIRMED", confirmedRevision: draft.revision, confirmedContentHash: contentHash, confirmedById: actor.id, confirmedAt: new Date(), validationJson: JSON.stringify({ ok: true, blockers: [] }) } });
    return { status: 200 as const, body: { ok: true, status: confirmed.status, revision: confirmed.revision, confirmedContentHash: confirmed.confirmedContentHash, authorizesGeneration: true } };
  });
  if (result.status === 200) await logAction({ userId: actor.id, action: "SUBMISSION_PLAN_BUILT", entityType: "Tender", entityId: id, description: "Build Plan confirmed after source-grounded validation.", metadata: { tenderId: id, revision: (result.body as any).revision, contentHash: (result.body as any).confirmedContentHash } });
  return NextResponse.json(result.body, { status: result.status });
}
