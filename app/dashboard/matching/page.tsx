import { redirect } from "next/navigation";
import { getSession } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { MatchingDashboard } from "./matching-dashboard";

export default async function MatchingPage() {
  const userId = await getSession();
  if (!userId) redirect("/login");
  await prismaReady;

  const tenders = await prisma.tender.findMany({
    where: { userId },
    include: {
      expertMatches: {
        orderBy: { score: "desc" },
        include: {
          expert: { select: { id: true, fullName: true, title: true, disciplines: true, sectors: true, trustLevel: true } },
        },
      },
      projectMatches: {
        orderBy: { score: "desc" },
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
