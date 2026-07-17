import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { MatchingDashboard } from "./matching-dashboard";
import { TENDERS_PER_PAGE, MATCH_PAGE_SIZE } from "../../../lib/engine/matching-config";

export const dynamic = "force-dynamic";

export function presentMatchRationale(value: string | null): string | null {
  if (!value) return value;
  return value
    .replace(/[✓✔☑⚠⚠️▲▼←→]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/^\[\s+/, "[")
    .trim();
}

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

  const totalTenders = await prisma.tender.count({ where: { userId } });
  const totalPages = Math.max(1, Math.ceil(totalTenders / TENDERS_PER_PAGE));

  const tenders = await prisma.tender.findMany({
    where: { userId },
    include: {
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
    tenders.map(async (tender) => {
      const [experts, projects] = await Promise.all([
        prisma.tenderExpertMatch.findMany({
          where: { tenderId: tender.id, isSelected: false },
          orderBy: { score: "desc" },
          take: MATCH_PAGE_SIZE,
          include: {
            expert: { select: { id: true, fullName: true, title: true, disciplines: true, sectors: true, trustLevel: true } },
          },
        }),
        prisma.tenderProjectMatch.findMany({
          where: { tenderId: tender.id, isSelected: false },
          orderBy: { score: "desc" },
          take: MATCH_PAGE_SIZE,
          include: {
            project: { select: { id: true, name: true, clientName: true, sector: true, contractValue: true, currency: true, trustLevel: true } },
          },
        }),
      ]);
      unselectedExpertsByTender.set(tender.id, experts as unknown as ExpertMatchRow[]);
      unselectedProjectsByTender.set(tender.id, projects as unknown as ProjectMatchRow[]);
    }),
  );

  const combineMatches = <T extends { isSelected: boolean; score: number }>(
    selected: T[],
    unselected: T[],
  ): T[] => [...selected, ...unselected].sort((left, right) => {
    if (left.isSelected !== right.isSelected) return left.isSelected ? -1 : 1;
    return right.score - left.score;
  });

  const serialized = tenders.map((tender) => {
    const selectedExperts = tender.expertMatches as unknown as ExpertMatchRow[];
    const selectedProjects = tender.projectMatches as unknown as ProjectMatchRow[];
    const combinedExperts = combineMatches(selectedExperts, unselectedExpertsByTender.get(tender.id) ?? []);
    const combinedProjects = combineMatches(selectedProjects, unselectedProjectsByTender.get(tender.id) ?? []);

    return {
      id: tender.id,
      title: tender.title,
      expertMatchCount: tender._count.expertMatches,
      projectMatchCount: tender._count.projectMatches,
      expertMatches: combinedExperts.map((match) => ({
        id: match.id,
        score: match.score,
        rationale: presentMatchRationale(match.rationale),
        isSelected: match.isSelected,
        expert: match.expert,
      })),
      projectMatches: combinedProjects.map((match) => ({
        id: match.id,
        score: match.score,
        rationale: presentMatchRationale(match.rationale),
        isSelected: match.isSelected,
        project: match.project,
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
