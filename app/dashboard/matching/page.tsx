import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { MatchingDashboard } from "./matching-dashboard";

// F-03 fix: Add bounded take to match includes to prevent unbounded rendering.
// Previously, ALL expertMatches and projectMatches were loaded for up to 15 tenders
// with no limit, causing extremely long pages on mobile (21,298px height).
// This minimal fix adds take:20 per type per tender.
// PR #1139 has a more comprehensive fix (full pagination + provenance) but is
// BLOCKED_DEPENDENCY. When #1139 is rebased, it supersedes this minimal bound.
const MATCH_TAKE = 20;

export default async function MatchingPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const tenders = await prisma.tender.findMany({
    where: { userId },
    include: {
      expertMatches: {
        orderBy: { score: "desc" },
        take: MATCH_TAKE,
        include: {
          expert: { select: { id: true, fullName: true, title: true, disciplines: true, sectors: true, trustLevel: true } },
        },
      },
      projectMatches: {
        orderBy: { score: "desc" },
        take: MATCH_TAKE,
        include: {
          project: { select: { id: true, name: true, clientName: true, sector: true, contractValue: true, currency: true, trustLevel: true } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 15,
  });

  const serialized = tenders.map((t) => ({
    id: t.id,
    title: t.title,
    expertMatches: t.expertMatches.map((m) => ({
      id: m.id,
      score: m.score,
      rationale: m.rationale,
      isSelected: m.isSelected,
      expert: m.expert,
    })),
    projectMatches: t.projectMatches.map((m) => ({
      id: m.id,
      score: m.score,
      rationale: m.rationale,
      isSelected: m.isSelected,
      project: m.project,
    })),
  }));

  return <MatchingDashboard tenders={serialized} />;
}
