import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { repairSourceGrounding } from "../../../../../lib/engine/repair-source-grounding";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  await prismaReady;
  const { id } = await params;

  const tender = await prisma.tender.findFirst({
    where: { id, userId: actor.id },
    select: { id: true, title: true },
  });
  if (!tender) {
    return NextResponse.json({ error: "Tender not found." }, { status: 404 });
  }

  const result = await repairSourceGrounding(id);

  await logAction({
    userId: actor.id,
    action: "UPDATE",
    entityType: "Tender",
    entityId: id,
    description: `Source-grounding repair: checked ${result.checkedCount}, repaired ${result.repairedCount}, remaining ${result.remainingCount}`,
    metadata: {
      operation: "REPAIR_SOURCE_GROUNDING",
      tenderId: id,
      checkedCount: result.checkedCount,
      repairedCount: result.repairedCount,
      remainingCount: result.remainingCount,
    },
  });

  return NextResponse.json({
    ok: result.remainingCount === 0,
    checkedCount: result.checkedCount,
    repairedCount: result.repairedCount,
    remainingCount: result.remainingCount,
    repairedRequirementIds: result.repairedRequirementIds,
    remainingRequirements: result.remainingRequirements,
    warnings: result.warnings,
  });
}
