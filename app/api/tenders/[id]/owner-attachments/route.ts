import { NextResponse } from "next/server";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { loadOwnerAttachmentChecklist, ownerAttachmentChecklistText } from "../../../../../lib/engine/owner-attachment-checklist";
import { safeFileBaseName } from "../../../../../lib/engine/proposal-labels";

export const dynamic = "force-dynamic";

/** The Owner Attachment Checklist: JSON, or plain text with ?format=text. Read-only. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  if (!["ADMIN", "PROPOSAL_MANAGER", "REVIEWER", "VIEWER"].includes(actor.role)) return forbiddenResponse();
  const { id } = await params;
  await prismaReady;
  const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { title: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  const checklist = await loadOwnerAttachmentChecklist(id, actor.id);
  if (!checklist) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  if (new URL(req.url).searchParams.get("format") === "text") {
    return new NextResponse(ownerAttachmentChecklistText(tender.title, checklist), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeFileBaseName(tender.title)}-owner-attachment-checklist.txt"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  return NextResponse.json({ checklist });
}
