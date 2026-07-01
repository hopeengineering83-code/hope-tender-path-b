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

  // RACE-SAFE CONFIRMATION: use a serializable transaction with optimistic
  // concurrency. The update includes a WHERE clause that checks id, status=DRAFT,
  // revision, AND contentHash — so if a concurrent rebuild changes revision or
  // hash between our read and our update, the update affects 0 rows and we
  // return a stale/conflict response. This prevents confirming an older revision.
  // P2034 (serialization conflict) is retried up to 3 times before returning 409.
  const MAX_RETRIES = 3;
  let result: { status: number; body: any } | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      result = await prisma.$transaction(async (tx) => {
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
        // OPTIMISTIC CONCURRENCY: update ONLY if id, status=DRAFT, revision,
        // AND contentHash still match the values we read. If a concurrent rebuild
        // changed revision or hash, updateMany returns count=0 and we fail.
        const updateResult = await (tx as any).buildPlan.updateMany({
          where: { id: draft.id, status: "DRAFT", revision: draft.revision, contentHash: draft.contentHash },
          data: { status: "CONFIRMED", confirmedRevision: draft.revision, confirmedContentHash: contentHash, confirmedById: actor.id, confirmedBy: actor.id, confirmedAt: new Date(), validationJson: JSON.stringify({ ok: true, blockers: [] }) },
        });
        if (updateResult.count === 0) {
          return { status: 409 as const, body: { ok: false, code: "BUILD_PLAN_CONFLICT", error: "Build Plan was rebuilt or tender state changed during confirmation. Retry confirmation.", authorizesGeneration: false } };
        }
        const confirmed = await (tx as any).buildPlan.findUnique({ where: { id: draft.id } });
        return { status: 200 as const, body: { ok: true, status: confirmed.status, revision: confirmed.revision, confirmedContentHash: confirmed.confirmedContentHash, authorizesGeneration: true } };
      }, { isolationLevel: "Serializable" });
      break; // success — exit retry loop
    } catch (err: any) {
      if (err?.code === "P2034" && attempt < MAX_RETRIES) {
        // Serialization conflict — retry with a fresh read
        continue;
      }
      // Non-retryable error or max retries exhausted
      return NextResponse.json({ ok: false, code: "BUILD_PLAN_CONFLICT", error: "Confirmation failed due to concurrent modification or serialization conflict. Retry confirmation.", authorizesGeneration: false }, { status: 409 });
    }
  }

  if (!result) {
    return NextResponse.json({ ok: false, code: "BUILD_PLAN_CONFLICT", error: "Confirmation failed after retries. Retry confirmation.", authorizesGeneration: false }, { status: 409 });
  }

  if (result.status === 200) await logAction({ userId: actor.id, action: "SUBMISSION_PLAN_BUILT", entityType: "Tender", entityId: id, description: "Build Plan confirmed after source-grounded validation.", metadata: { tenderId: id, revision: (result.body as any).revision, contentHash: (result.body as any).confirmedContentHash } });
  return NextResponse.json(result.body, { status: result.status });
}
