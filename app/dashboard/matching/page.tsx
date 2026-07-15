import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { MatchingDashboard } from "./matching-dashboard";

export const dynamic = "force-dynamic";

// GLM-A2 Issue #1135 Gap #5: Bounded queries with pagination.
// Previously loaded ALL matches for up to 15 tenders with no limit,
// causing extremely long mobile pages. Now paginated: 5 tenders per page,
// 10 matches per type per tender (user can expand for more).
const TENDERS_PER_PAGE = 5;
const MATCHES_PER_TYPE = 10;

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
        take: MATCHES_PER_TYPE,
        include: {
          expert: { select: { id: true, fullName: true, title: true, disciplines: true, sectors: true, trustLevel: true } },
        },
      },
      projectMatches: {
        orderBy: { score: "desc" },
        take: MATCHES_PER_TYPE,
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

  const serialized = tenders.map((t) => ({
    id: t.id,
    title: t.title,
    expertMatchCount: t._count.expertMatches,
    projectMatchCount: t._count.projectMatches,
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

  return (
    <MatchingDashboard
      tenders={serialized}
      pagination={{ page, totalPages, totalTenders, perPage: TENDERS_PER_PAGE }}
    />
  );
}
