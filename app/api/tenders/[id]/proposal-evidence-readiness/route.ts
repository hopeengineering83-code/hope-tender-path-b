import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prismaReady } from "../../../../../lib/prisma";
import { checkProposalEvidenceReadiness } from "../../../../../lib/engine/proposal-evidence-readiness";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  await prismaReady;
  const { id } = await params;
  const readiness = await checkProposalEvidenceReadiness(id, actor.id);
  if (!readiness) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  return NextResponse.json({ success: true, readiness });
}
