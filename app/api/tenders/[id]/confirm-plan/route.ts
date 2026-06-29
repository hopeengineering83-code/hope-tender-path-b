/**
 * Confirm a persisted submission plan.
 *
 * Only ADMIN or PROPOSAL_MANAGER can confirm.
 * Confirmation requires current sourceContentHash and requirementsHash.
 * Confirmation fails closed when hashes are stale.
 * Confirmation requires all mandatory requirements to have a valid plan mapping.
 * Confirmation requires each plan item to have exact filename, order, type, envelope.
 * Confirmed plan content is immutable — any edit creates a new draft revision.
 */

import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getSession, requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { logAction } from "../../../../../lib/audit";
import { confirmSubmissionPlan, computeSourceContentHash, computeRequirementsHash } from "../../../../../lib/engine/persisted-submission-plan";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch {
    return unauthorizedResponse();
  }

  await prismaReady;
  const { id: tenderId } = await params;

  // Verify ownership
  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId: actor.id } });
  if (!tender) {
    return forbiddenResponse();
  }

  try {
    const body = await req.json().catch(() => ({}));
    const expectedSourceContentHash = body.sourceContentHash;
    const expectedRequirementsHash = body.requirementsHash;

    if (!expectedSourceContentHash || !expectedRequirementsHash) {
      return NextResponse.json(
        { ok: false, error: "sourceContentHash and requirementsHash are required" },
        { status: 400 },
      );
    }

    const result = await confirmSubmissionPlan(
      tenderId,
      actor.id,
      expectedSourceContentHash,
      expectedRequirementsHash,
    );

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
    }

    await logAction({
      userId: actor.id,
      action: "SUBMISSION_PLAN_CONFIRMED",
      entityType: "Tender",
      entityId: tenderId,
      description: `Submission plan confirmed (revision ${result.revision})`,
      metadata: { tenderId, planId: result.planId, revision: result.revision },
    });

    return NextResponse.json({
      ok: true,
      planId: result.planId,
      revision: result.revision,
      status: "CONFIRMED",
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Failed to confirm submission plan" },
      { status: 500 },
    );
  }
}
