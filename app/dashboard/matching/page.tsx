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

  // GLM-A2 Revision #3 (recheck 3 gap #2): Query unselected candidates
  // PER TENDER, not globally. The previous query used tenderId: { in: tenderIds }
  // with take: MATCH_PAGE_SIZE, which returned at most 15 unselected experts
  // across ALL tenders — later tenders got zero candidates. Now queries each
  // tender separately so each gets its own MATCH_PAGE_SIZE candidates.

  // Explicit types for match rows including the relation
  type ExpertMatchRow = {
    id: string; score: number; rationale: string | null; isSelected: boolean;
    tenderId: string; expertId: string;
    expert: { id: string; fullName: string; title: string | null; disciplines: string; sectors: string; trustLevel: string | null };
  };
  type ProjectMatchRow = {
    id: string; score: number; rationale: string | null; isSelected: boolean;
    tenderId: string; projectId: string;
    project: { id: string; name: string; clientName: string | null; sector: string | null; contractValue: number | null; currency: string | null; trustLevel: string | null };
  };

  const unselectedExpertsByTender = new Map<string, ExpertMatchRow[]>();
  const unselectedProjectsByTender = new Map<string, ProjectMatchRow[]>();

  await Promise.all(
    tenders.map(async (t) => {
      const [experts, projects] = await Promise.all([
        prisma.tenderExpertMatch.findMany({
          where: { tenderId: t.id, isSelected: false },
          orderBy: { score: "desc" },
          take: MATCH_PAGE_SIZE,
          include: {
            expert: { select: { id: true, fullName: true, title: true, disciplines: true, sectors: true, trustLevel: true } },
          },
        }),
        prisma.tenderProjectMatch.findMany({
          where: { tenderId: t.id, isSelected: false },
          orderBy: { score: "desc" },
          take: MATCH_PAGE_SIZE,
          include: {
            project: { select: { id: true, name: true, clientName: true, sector: true, contractValue: true, currency: true, trustLevel: true } },
          },
        }),
      ]);
      unselectedExpertsByTender.set(t.id, experts as unknown as ExpertMatchRow[]);
      unselectedProjectsByTender.set(t.id, projects as unknown as ProjectMatchRow[]);
    }),
  );

  // GLM-A2 Revision #3 (recheck 3 gap #3): Return ALL selected rows without
  // truncation. Previously .slice(0, MATCH_PAGE_SIZE) hid selected rows
  // beyond the first 15. Now: selected rows are ALL returned (uncapped),
  // unselected candidates are bounded at MATCH_PAGE_SIZE.
  const combineMatches = <T extends { isSelected: boolean; score: number }>(
    selected: T[],
    unselected: T[],
  ): T[] => {
    return [...selected, ...unselected].sort((a, b) => {
      if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
      return b.score - a.score;
    });
    // NO .slice() — all selected rows must be visible
  };

  const serialized = tenders.map((t) => {
    const selectedExperts = t.expertMatches as unknown as ExpertMatchRow[];
    const selectedProjects = t.projectMatches as unknown as ProjectMatchRow[];
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
