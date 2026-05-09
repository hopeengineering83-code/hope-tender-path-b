// GET /api/tenders/[id]/proposal-versions
//
// Returns the list of saved proposal versions for a tender (newest first).
// Each entry includes version number, scores, mode, summary, and createdAt.
// The full markdown and fileContent are intentionally excluded from the list
// response to keep it small — fetch them via the single-version route when
// the user selects a version to preview or restore.

import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;

  const tender = await prisma.tender.findFirst({ where: { id, userId }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const versions = await prisma.$queryRawUnsafe<Array<{
    id: string;
    version: number;
    benchmarkScore: number | null;
    qualityScore: number | null;
    winProbabilityScore: number | null;
    mode: string | null;
    summary: string | null;
    createdAt: string;
  }>>(
    `SELECT "id","version","benchmarkScore","qualityScore","winProbabilityScore","mode","summary","createdAt"
     FROM "ProposalVersion"
     WHERE "tenderId" = $1
     ORDER BY "version" DESC
     LIMIT 5`,
    id
  );

  return NextResponse.json({ versions });
}
