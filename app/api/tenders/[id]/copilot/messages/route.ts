import { logger } from "../../../../../../lib/observability";
import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../../lib/auth";

export const dynamic = "force-dynamic";

// GET /api/tenders/[id]/copilot/messages
// Returns the last 50 messages for this tender + authenticated user, ordered oldest-first.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  if (!["ADMIN", "PROPOSAL_MANAGER", "REVIEWER"].includes(actor.role)) return forbiddenResponse();

  const { id } = await params;
  await prismaReady;

  // Verify the tender belongs to this user before returning messages.
  const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  try {
    // Fetch the LATEST 50 messages (desc + take), then reverse to chronological
    // order for the client. The old `orderBy: asc + take: 50` returned the
    // OLDEST 50 — permanently hiding everything past message 50 in long chats.
    const messagesDesc = await prisma.tenderCopilotMessage.findMany({
      where: { tenderId: id, userId: actor.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, role: true, content: true, citations: true, createdAt: true },
    });
    const messages = messagesDesc.reverse();
    return NextResponse.json({ success: true, messages });
  } catch (err) {
    logger.error("[copilot/messages GET]", { detail: err });
    return NextResponse.json({ error: "Failed to load messages" }, { status: 500 });
  }
}

// DELETE /api/tenders/[id]/copilot/messages
// Deletes all messages for this tender + authenticated user.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  if (!["ADMIN", "PROPOSAL_MANAGER", "REVIEWER"].includes(actor.role)) return forbiddenResponse();

  const { id } = await params;
  await prismaReady;

  const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  try {
    const result = await prisma.tenderCopilotMessage.deleteMany({
      where: { tenderId: id, userId: actor.id },
    });
    return NextResponse.json({ success: true, deleted: result.count });
  } catch (err) {
    logger.error("[copilot/messages DELETE]", { detail: err });
    return NextResponse.json({ error: "Failed to delete messages" }, { status: 500 });
  }
}
