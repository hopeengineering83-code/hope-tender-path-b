import { NextRequest, NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { MATCH_PAGE_SIZE } from "../../../../../lib/engine/matching-config";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
  catch (error) { return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  await prismaReady;
  const { id: tenderId } = await params;
  const userId = actor.id;

  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId } });
  if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [selectedExperts, selectedProjects, unselectedExperts, unselectedProjects] = await Promise.all([
    prisma.tenderExpertMatch.findMany({
      where: { tenderId, isSelected: true },
      orderBy: { score: "desc" },
      include: {
        expert: { select: { id: true, fullName: true, title: true, disciplines: true, sectors: true, trustLevel: true } },
      },
    }),
    prisma.tenderProjectMatch.findMany({
      where: { tenderId, isSelected: true },
      orderBy: { score: "desc" },
      include: {
        project: { select: { id: true, name: true, clientName: true, sector: true, contractValue: true, currency: true, trustLevel: true } },
      },
    }),
    prisma.tenderExpertMatch.findMany({
      where: { tenderId, isSelected: false },
      orderBy: { score: "desc" },
      take: MATCH_PAGE_SIZE,
      include: {
        expert: { select: { id: true, fullName: true, title: true, disciplines: true, sectors: true, trustLevel: true } },
      },
    }),
    prisma.tenderProjectMatch.findMany({
      where: { tenderId, isSelected: false },
      orderBy: { score: "desc" },
      take: MATCH_PAGE_SIZE,
      include: {
        project: { select: { id: true, name: true, clientName: true, sector: true, contractValue: true, currency: true, trustLevel: true } },
      },
    }),
  ]);

  const combineMatches = <T extends { isSelected: boolean; score: number }>(selected: T[], unselected: T[]): T[] =>
    [...selected, ...unselected].sort((a, b) => {
      if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
      return b.score - a.score;
    });

  return NextResponse.json({
    expertMatches: combineMatches(selectedExperts, unselectedExperts).map((match) => ({
      id: match.id,
      score: match.score,
      rationale: match.rationale,
      isSelected: match.isSelected,
      revision: match.updatedAt.toISOString(),
      expert: match.expert,
    })),
    projectMatches: combineMatches(selectedProjects, unselectedProjects).map((match) => ({
      id: match.id,
      score: match.score,
      rationale: match.rationale,
      isSelected: match.isSelected,
      revision: match.updatedAt.toISOString(),
      project: match.project,
    })),
  });
}
