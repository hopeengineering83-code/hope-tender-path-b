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

  // PR XX-A — switched from $queryRawUnsafe to typed Prisma access.
  // The Prisma model now exists and the bootstrap migration in
  // lib/prisma.ts:508 still creates the table for production envs that
  // may not have run a Prisma migration (Vercel + bootstrap-on-boot).
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
