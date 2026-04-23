import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id: tenderId } = await params;

  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId } });
  if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json() as { matchId: string; matchType: "expert" | "project"; isSelected: boolean };
  const { matchId, matchType, isSelected } = body;

  if (matchType === "expert") {
    const match = await prisma.tenderExpertMatch.findFirst({ where: { id: matchId, tenderId } });
    if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });
    const updated = await prisma.tenderExpertMatch.update({ where: { id: matchId }, data: { isSelected, updatedAt: new Date() } });
    return NextResponse.json(updated);
  } else {
    const match = await prisma.tenderProjectMatch.findFirst({ where: { id: matchId, tenderId } });
    if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });
    const updated = await prisma.tenderProjectMatch.update({ where: { id: matchId }, data: { isSelected, updatedAt: new Date() } });
    return NextResponse.json(updated);
  }
}
