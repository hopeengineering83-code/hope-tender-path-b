import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireTenderAccess } from "../../../../../lib/tender-ownership";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;

  const tender = await requireTenderAccess(id, actor.id, actor.role);
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const versions = await prisma.proposalVersion.findMany({
    where: { tenderId: id },
    select: {
      id: true,
      version: true,
      benchmarkScore: true,
      qualityScore: true,
      winProbabilityScore: true,
      mode: true,
      summary: true,
      createdAt: true,
    },
    orderBy: { version: "desc" },
    take: 5,
  });

  return NextResponse.json({ versions });
}
