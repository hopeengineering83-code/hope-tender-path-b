import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getTenderGenerationReadiness } from "../../../../../lib/tender-generation-readiness";
import { getCanonicalTenderReadiness } from "../../../../../lib/canonical-tender-readiness";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id: tenderId } = await params;
  const readiness = await getTenderGenerationReadiness(prisma, userId, tenderId);
  const canonical = await getCanonicalTenderReadiness(prisma, userId, tenderId);
  if (!readiness) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  return NextResponse.json({ ...readiness, canonical });
}
