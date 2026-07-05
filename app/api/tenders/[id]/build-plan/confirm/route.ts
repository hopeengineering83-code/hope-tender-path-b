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

  // CAPTURE ORIGINAL CANDIDATE BEFORE retry loop.
  // Read the DRAFT once, capture ID + revision + contentHash.
  // Every retry targets THIS SAME candidate — never reread "latest DRAFT".
  const originalDraft = await prisma.buildPlan.findFirst({
    where: { tenderId: id, status: "DRAFT", tender: { userId: actor.id } },
    orderBy: { updatedAt: "desc" },
  });
  if (!originalDraft) {
    return NextResponse.json({ ok: false, code: "BUILD_PLAN_DRAFT_MISSING", error: "Build Plan draft missing." }, { status: 404 });
  }
  const candidateId = originalDraft.id;
  const candidateRevision = originalDraft.revision;
  const candidateHash = originalDraft.contentHash;

  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Reread ONLY by original ID + DRAFT + original revision + original hash.
        // Never select "latest DRAFT" again.
        const draft = await (tx as any).buildPlan.findUnique({ where: { id: candidateId } });
        if (!draft || draft.status !== "DRAFT" || draft.revision !== candidateRevision || draft.contentHash !== candidateHash) {
          return { status: 409 as const, body: { ok: false, code: "BUILD_PLAN_CONFLICT", error: "Build Plan was rebuilt or changed during confirmation. Rebuild and retry.", authorizesGeneration: false } };
        }

        const items = JSON.parse(draft.itemsJson || "[]");
        const validation = await validateBuildPlanForConfirmation(tx as any, id, actor.id, items);
        const contentHash = await computeTenderBuildPlanHash(tx as any, id, actor.id, items);
        const staleBlockers = !contentHash || contentHash !== draft.contentHash ? ["Build Plan hash is stale; rebuild before confirming."] : [];

        if (staleBlockers.length > 0 || !validation.ok) {
          // Update validationJson ONLY through conditional updateMany.
          // Never overwrite contentHash. Check count — if zero, candidate was
          // concurrently rebuilt → return 409, not 422.
          const valUpdate = await (tx as any).buildPlan.updateMany({
            where: { id: candidateId, status: "DRAFT", revision: candidateRevision, contentHash: candidateHash },
            data: { validationJson: JSON.stringify({ ok: false, blockers: validation.blockers.concat(staleBlockers) }) },
          });
          if (valUpdate.count === 0) {
            return { status: 409 as const, body: { ok: false, code: "BUILD_PLAN_CONFLICT", error: "Build Plan was rebuilt during validation. Rebuild and retry.", authorizesGeneration: false } };
          }
          return { status: 422 as const, body: { ok: false, code: "BUILD_PLAN_CONFIRMATION_BLOCKED", blockers: validation.blockers.concat(staleBlockers), authorizesGeneration: false } };
        }

        // CONFIRM: conditional updateMany with ID + DRAFT + revision + contentHash.
        const updateResult = await (tx as any).buildPlan.updateMany({
          where: { id: candidateId, status: "DRAFT", revision: candidateRevision, contentHash: candidateHash },
          data: {
            status: "CONFIRMED",
            confirmedRevision: candidateRevision,
            confirmedContentHash: contentHash,
            confirmedById: actor.id,
            confirmedBy: actor.id,
            confirmedAt: new Date(),
            validationJson: JSON.stringify({ ok: true, blockers: [] }),
          },
        });

        if (updateResult.count === 0) {
          return { status: 409 as const, body: { ok: false, code: "BUILD_PLAN_CONFLICT", error: "Build Plan was rebuilt or changed during confirmation. Rebuild and retry.", authorizesGeneration: false } };
        }

        const confirmed = await (tx as any).buildPlan.findUnique({ where: { id: candidateId } });
        return { status: 200 as const, body: { ok: true, status: confirmed.status, revision: confirmed.revision, confirmedContentHash: confirmed.confirmedContentHash, authorizesGeneration: true } };
      }, { isolationLevel: "Serializable" });

      if (result.status === 200) {
        await logAction({ userId: actor.id, action: "SUBMISSION_PLAN_BUILT", entityType: "Tender", entityId: id, description: "Build Plan confirmed after source-grounded validation.", metadata: { tenderId: id, revision: (result.body as any).revision, contentHash: (result.body as any).confirmedContentHash } });
      }
      return NextResponse.json(result.body, { status: result.status });
    } catch (err: any) {
      if (err?.code === "P2034" && attempt < MAX_RETRIES) {
        continue; // Retry targeting same original candidate
      }
      if (err?.code === "P2034") {
        // Final P2034 exhaustion — this IS a concurrency conflict → 409
        return NextResponse.json({ ok: false, code: "BUILD_PLAN_CONFLICT", error: "Confirmation failed after retries due to concurrent modification. Rebuild and retry.", authorizesGeneration: false }, { status: 409 });
      }
      // Non-concurrency failure — sanitized 500
      return NextResponse.json({ ok: false, code: "BUILD_PLAN_INTERNAL_ERROR", error: "Confirmation failed due to an internal error." }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: false, code: "BUILD_PLAN_CONFLICT", error: "Confirmation failed after retries. Rebuild and retry.", authorizesGeneration: false }, { status: 409 });
}
