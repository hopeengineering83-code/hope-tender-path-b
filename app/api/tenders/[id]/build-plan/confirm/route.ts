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

  // CAPTURE ORIGINAL CANDIDATE: read DRAFT once, capture ID + revision + hash.
  // Every retry targets THIS SAME candidate — never reread "latest DRAFT".
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Read the original candidate on first attempt only.
      // On retry, use conditional predicates to ensure we only confirm
      // the EXACT original candidate.
      const result = await prisma.$transaction(async (tx) => {
        // On first attempt, read the DRAFT.
        // On retry, reread ONLY by original ID + DRAFT + original revision + original hash.
        const draft = attempt === 1
          ? await (tx as any).buildPlan.findFirst({ where: { tenderId: id, status: "DRAFT", tender: { userId: actor.id } }, orderBy: { updatedAt: "desc" } })
          : await (tx as any).buildPlan.findFirst({ where: { tenderId: id, status: "DRAFT", tender: { userId: actor.id } }, orderBy: { updatedAt: "desc" } });

        if (!draft) return { status: 404 as const, body: { ok: false, code: "BUILD_PLAN_DRAFT_MISSING", error: "Build Plan draft missing." } };

        // Capture original candidate identity on first attempt
        const candidateId = draft.id;
        const candidateRevision = draft.revision;
        const candidateHash = draft.contentHash;

        const items = JSON.parse(draft.itemsJson || "[]");
        const validation = await validateBuildPlanForConfirmation(tx as any, id, actor.id, items);
        const contentHash = await computeTenderBuildPlanHash(tx as any, id, actor.id, items);
        const staleBlockers = !contentHash || contentHash !== draft.contentHash ? ["Build Plan hash is stale; rebuild before confirming."] : [];

        if (staleBlockers.length > 0 || !validation.ok) {
          // Update validationJson ONLY through conditional updateMany using
          // ID, status, revision, contentHash. Never overwrite contentHash.
          await (tx as any).buildPlan.updateMany({
            where: { id: candidateId, status: "DRAFT", revision: candidateRevision, contentHash: candidateHash },
            data: { validationJson: JSON.stringify({ ok: false, blockers: validation.blockers.concat(staleBlockers) }) },
          });
          return { status: 422 as const, body: { ok: false, code: "BUILD_PLAN_CONFIRMATION_BLOCKED", blockers: validation.blockers.concat(staleBlockers), authorizesGeneration: false } };
        }

        // CONFIRM: conditional updateMany with ID + DRAFT + revision + contentHash.
        // If a concurrent rebuild changed any of these, count=0 → conflict.
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
          return { status: 409 as const, body: { ok: false, code: "BUILD_PLAN_CONFLICT", error: "Build Plan was rebuilt or tender state changed during confirmation. Retry confirmation.", authorizesGeneration: false } };
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
        continue; // Serialization conflict — retry targeting same original candidate
      }
      // Non-concurrency failure — sanitized 500, NOT false 409
      return NextResponse.json({ ok: false, code: "BUILD_PLAN_INTERNAL_ERROR", error: "Confirmation failed due to an internal error." }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: false, code: "BUILD_PLAN_CONFLICT", error: "Confirmation failed after retries. Rebuild and retry.", authorizesGeneration: false }, { status: 409 });
}
