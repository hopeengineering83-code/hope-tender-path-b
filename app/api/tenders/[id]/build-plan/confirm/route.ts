import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { buildAndVerifyBuildPlan } from "../../../../../../lib/engine/automatic-build-plan";
import { logAction } from "../../../../../../lib/audit";

export const dynamic = "force-dynamic";

/**
 * Compatibility endpoint for older clients. Build Plan authority is now
 * machine-derived and source-verified; this route no longer records a human
 * approval or requires a browser review checkbox.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  await prismaReady;
  const { id } = await params;
  const result = await buildAndVerifyBuildPlan(prisma, id, actor.id, { reuseCurrent: true });
  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      code: result.code,
      error: result.message,
      blockers: result.blockers ?? [],
      authorizesGeneration: false,
      automaticVerificationPending: true,
    }, { status: result.status });
  }

  await logAction({
    userId: actor.id,
    action: "SUBMISSION_PLAN_BUILT",
    entityType: "Tender",
    entityId: id,
    description: result.reusedCurrentPlan
      ? "Returned the current source-verified Build Plan through the compatibility endpoint."
      : "Build Plan automatically derived and source-verified through the compatibility endpoint.",
    metadata: {
      tenderId: id,
      revision: result.revision,
      contentHash: result.contentHash,
      confirmationMode: result.confirmationMode,
      reusedCurrentPlan: result.reusedCurrentPlan,
    },
  });

  return NextResponse.json({
    ok: true,
    status: result.status,
    state: "CONFIRMED",
    revision: result.revision,
    confirmedContentHash: result.contentHash,
    confirmationMode: result.confirmationMode,
    authorizesGeneration: true,
    automaticVerificationPending: false,
    reusedCurrentPlan: result.reusedCurrentPlan,
  });
}
