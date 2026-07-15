import { NextRequest, NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

// GLM-A2 Issue #1135 Revision #3: Use the SAME page size as SSR (page.tsx)
// so re-fetch after failure returns the same visible set.
const MATCH_PAGE_SIZE = 15;

// GLM-A2 Issue #1135 Gap #6: GET endpoint for re-fetching authoritative
// match state after a PUT rejection. The dashboard calls this to revert
// stale optimistic state.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  await prismaReady;
  const { id: tenderId } = await params;
  const userId = actor.id;

  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId } });
  if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // GLM-A2 Revision #2: Fetch a generous set, then sort selected-first
  // and slice to MATCH_PAGE_SIZE — same logic as SSR page.tsx.
  const [expertMatchesAll, projectMatchesAll] = await Promise.all([
    prisma.tenderExpertMatch.findMany({
      where: { tenderId },
      orderBy: { score: "desc" },
      take: MATCH_PAGE_SIZE * 2,
      include: {
        expert: { select: { id: true, fullName: true, title: true, disciplines: true, sectors: true, trustLevel: true } },
      },
    }),
    prisma.tenderProjectMatch.findMany({
      where: { tenderId },
      orderBy: { score: "desc" },
      take: MATCH_PAGE_SIZE * 2,
      include: {
        project: { select: { id: true, name: true, clientName: true, sector: true, contractValue: true, currency: true, trustLevel: true } },
      },
    }),
  ]);

  // Sort selected-first, then by score — same as SSR
  const sortSelectedFirst = <T extends { isSelected: boolean; score: number }>(matches: T[]): T[] => {
    return [...matches].sort((a, b) => {
      if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
      return b.score - a.score;
    });
  };

  const expertMatches = sortSelectedFirst(expertMatchesAll).slice(0, MATCH_PAGE_SIZE);
  const projectMatches = sortSelectedFirst(projectMatchesAll).slice(0, MATCH_PAGE_SIZE);

  return NextResponse.json({
    expertMatches: expertMatches.map((m) => ({
      id: m.id,
      score: m.score,
      rationale: m.rationale,
      isSelected: m.isSelected,
      expert: m.expert,
    })),
    projectMatches: projectMatches.map((m) => ({
      id: m.id,
      score: m.score,
      rationale: m.rationale,
      isSelected: m.isSelected,
      project: m.project,
    })),
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const rl = rateLimit(`matches:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  await prismaReady;
  const { id: tenderId } = await params;
  const userId = actor.id;

  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId } });
  if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null) as { matchId: string; matchType: "expert" | "project"; isSelected: boolean } | null;
  if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
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
