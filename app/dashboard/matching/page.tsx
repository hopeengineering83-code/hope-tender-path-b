import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { MatchingDashboard } from "./matching-dashboard";
import { TENDERS_PER_PAGE, MATCH_PAGE_SIZE } from "../../../lib/engine/matching-config";

export const dynamic = "force-dynamic";

// GLM-A2 Issue #1135 Gap #5: Bounded queries with pagination.
// GLM-A2 Issue #1135 Revision #2: Selected rows fetched separately.
// GLM-A2 Issue #1135 Revision #4: Page-size constants imported from
// shared module lib/engine/matching-config.ts (no duplication).

export default async function MatchingPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);
  const skip = (page - 1) * TENDERS_PER_PAGE;

  // Count total tenders for pagination
  const totalTenders = await prisma.tender.count({ where: { userId } });
  const totalPages = Math.max(1, Math.ceil(totalTenders / TENDERS_PER_PAGE));

  const tenders = await prisma.tender.findMany({
    where: { userId },
    include: {
      // GLM-A2 Revision #3: Query SELECTED rows separately (all of them)
      // so no selected row is ever hidden by score-rank truncation.
      // Then fetch top unselected candidates to fill the page.
      expertMatches: {
        orderBy: { score: "desc" },
        where: { isSelected: true },
        include: {
          expert: { select: { id: true, fullName: true, title: true, disciplines: true, sectors: true, trustLevel: true } },
        },
      },
      projectMatches: {
        orderBy: { score: "desc" },
        where: { isSelected: true },
        include: {
          project: { select: { id: true, name: true, clientName: true, sector: true, contractValue: true, currency: true, trustLevel: true } },
        },
      },
      _count: {
        select: { expertMatches: true, projectMatches: true },
      },
    },
    orderBy: { updatedAt: "desc" },
    skip,
    take: TENDERS_PER_PAGE,
  });

  // GLM-A2 Revision #3: For each tender, also fetch top unselected
  // candidates to fill the remaining page slots.
  const tenderIds = tenders.map((t) => t.id);
  const [unselectedExperts, unselectedProjects] = await Promise.all([
    tenderIds.length > 0
      ? prisma.tenderExpertMatch.findMany({
          where: { tenderId: { in: tenderIds }, isSelected: false },
          orderBy: { score: "desc" },
          take: MATCH_PAGE_SIZE,
          include: {
            expert: { select: { id: true, fullName: true, title: true, disciplines: true, sectors: true, trustLevel: true } },
          },
        })
      : [],
    tenderIds.length > 0
      ? prisma.tenderProjectMatch.findMany({
          where: { tenderId: { in: tenderIds }, isSelected: false },
          orderBy: { score: "desc" },
          take: MATCH_PAGE_SIZE,
          include: {
            project: { select: { id: true, name: true, clientName: true, sector: true, contractValue: true, currency: true, trustLevel: true } },
          },
        })
      : [],
  ]);

  // Group unselected by tenderId
  const unselectedExpertsByTender = new Map<string, typeof unselectedExperts>();
  for (const m of unselectedExperts) {
    const arr = unselectedExpertsByTender.get(m.tenderId) ?? [];
    arr.push(m);
    unselectedExpertsByTender.set(m.tenderId, arr);
  }
  const unselectedProjectsByTender = new Map<string, typeof unselectedProjects>();
  for (const m of unselectedProjects) {
    const arr = unselectedProjectsByTender.get(m.tenderId) ?? [];
    arr.push(m);
    unselectedProjectsByTender.set(m.tenderId, arr);
  }

  // GLM-A2 Revision #3: Combine selected (all) + unselected (top N),
  // selected-first, capped at MATCH_PAGE_SIZE per type.
  const combineMatches = <T extends { isSelected: boolean; score: number }>(
    selected: T[],
    unselected: T[],
  ): T[] => {
    const combined = [...selected, ...unselected];
    // Selected-first, then by score desc
    return combined.sort((a, b) => {
      if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
      return b.score - a.score;
    }).slice(0, MATCH_PAGE_SIZE);
  };

  const serialized = tenders.map((t) => {
    const selectedExperts = t.expertMatches;
    const selectedProjects = t.projectMatches;
    const unselectedExpertsForTender = unselectedExpertsByTender.get(t.id) ?? [];
    const unselectedProjectsForTender = unselectedProjectsByTender.get(t.id) ?? [];

    const combinedExperts = combineMatches(selectedExperts, unselectedExpertsForTender);
    const combinedProjects = combineMatches(selectedProjects, unselectedProjectsForTender);

    return {
      id: t.id,
      title: t.title,
      expertMatchCount: t._count.expertMatches,
      projectMatchCount: t._count.projectMatches,
      expertMatches: combinedExperts.map((m) => ({
        id: m.id,
        score: m.score,
        rationale: m.rationale,
        isSelected: m.isSelected,
        expert: m.expert,
      })),
      projectMatches: combinedProjects.map((m) => ({
        id: m.id,
        score: m.score,
        rationale: m.rationale,
        isSelected: m.isSelected,
        project: m.project,
      })),
    };
  });

  return (
    <MatchingDashboard
      tenders={serialized}
      pagination={{ page, totalPages, totalTenders, perPage: TENDERS_PER_PAGE }}
    />
  );
}
