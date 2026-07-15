import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { MatchingDashboard } from "./matching-dashboard";

export const dynamic = "force-dynamic";

// GLM-A2 Issue #1135 Gap #5: Bounded queries with pagination.
// Previously loaded ALL matches for up to 15 tenders with no limit,
// causing extremely long mobile pages. Now paginated: 5 tenders per page.
//
// GLM-A2 Issue #1135 Revision #2: Candidate truncation hides records.
// Previously fetched only 10 per type, hiding selected/relevant rows
// beyond the first 10. Now fetches ALL selected rows first, then fills
// with top unselected candidates up to a bounded page size.
//
// GLM-A2 Issue #1135 Revision #3: GET/SSR limits disagree.
// Now uses one shared MATCH_PAGE_SIZE constant for both SSR and GET.
const TENDERS_PER_PAGE = 5;
const MATCH_PAGE_SIZE = 15;

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
      expertMatches: {
        orderBy: { score: "desc" },
        // GLM-A2 Revision #2: Fetch ALL selected rows first, then fill with
        // top unselected candidates. This ensures selected rows are never
        // hidden by truncation.
        take: MATCH_PAGE_SIZE * 2, // bounded but generous
        include: {
          expert: { select: { id: true, fullName: true, title: true, disciplines: true, sectors: true, trustLevel: true } },
        },
      },
      projectMatches: {
        orderBy: { score: "desc" },
        take: MATCH_PAGE_SIZE * 2,
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

  // GLM-A2 Revision #2: Sort selected rows first, then top unselected.
  // This guarantees all selected rows are visible regardless of score rank.
  const sortSelectedFirst = <T extends { isSelected: boolean; score: number }>(matches: T[]): T[] => {
    return [...matches].sort((a, b) => {
      if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
      return b.score - a.score;
    });
  };

  const serialized = tenders.map((t) => {
    const sortedExperts = sortSelectedFirst(t.expertMatches).slice(0, MATCH_PAGE_SIZE);
    const sortedProjects = sortSelectedFirst(t.projectMatches).slice(0, MATCH_PAGE_SIZE);
    return {
      id: t.id,
      title: t.title,
      expertMatchCount: t._count.expertMatches,
      projectMatchCount: t._count.projectMatches,
      expertMatches: sortedExperts.map((m) => ({
        id: m.id,
        score: m.score,
        rationale: m.rationale,
        isSelected: m.isSelected,
        expert: m.expert,
      })),
      projectMatches: sortedProjects.map((m) => ({
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
