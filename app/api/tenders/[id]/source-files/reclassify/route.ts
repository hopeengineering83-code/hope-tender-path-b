// POST /api/tenders/[id]/source-files/reclassify
//
// Reclassify a tender file into a new category.
// Only ADMIN and PROPOSAL_MANAGER can reclassify.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  await prismaReady;
  const { id: tenderId } = await params;

  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    select: { id: true },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const body = await req.json().catch(() => null) as { fileId?: string; classification?: string } | null;
  if (!body?.fileId || !body.classification) {
    return NextResponse.json({ error: "fileId and classification are required" }, { status: 400 });
  }

  const file = await prisma.tenderFile.findFirst({
    where: { id: body.fileId, tenderId, deletionStatus: "ACTIVE" },
    select: { id: true },
  });
  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

  await prisma.tenderFile.update({
    where: { id: body.fileId },
    data: { classification: body.classification },
  });

  return NextResponse.json({ ok: true, fileId: body.fileId, classification: body.classification });
}
