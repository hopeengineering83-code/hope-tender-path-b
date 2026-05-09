import { prisma } from "../prisma";

type RequirementLite = {
  requirementType: string;
  requiredQuantity?: number | null;
  priority?: string | null;
};

export type BestAvailablePromotion = {
  promotedExpertCount: number;
  promotedProjectCount: number;
  warnings: string[];
};

function requiredLimit(requirements: RequirementLite[], requirementType: "EXPERT" | "PROJECT_EXPERIENCE", fallback: number): number {
  const relevant = requirements.filter((r) => r.requirementType === requirementType);
  if (relevant.length === 0) return 0;
  const explicit = relevant.reduce((sum, r) => sum + Math.max(0, Number(r.requiredQuantity ?? 0)), 0);
  if (explicit > 0) return Math.min(12, explicit);
  const mandatoryCount = relevant.filter((r) => /MANDATORY|CRITICAL|HIGH/i.test(String(r.priority ?? ""))).length;
  return Math.min(12, Math.max(fallback, mandatoryCount));
}

async function promoteReviewedExperts(tenderId: string, limit: number): Promise<number> {
  if (limit <= 0) return 0;
  const selectedCount = await prisma.tenderExpertMatch.count({ where: { tenderId, isSelected: true } });
  if (selectedCount > 0) return 0;

  const candidates = await prisma.tenderExpertMatch.findMany({
    where: { tenderId, expert: { trustLevel: "REVIEWED" } },
    orderBy: [{ score: "desc" }, { createdAt: "asc" }],
    take: limit,
    select: { id: true, score: true, expert: { select: { fullName: true } } },
  });

  for (const candidate of candidates) {
    await prisma.tenderExpertMatch.update({ where: { id: candidate.id }, data: { isSelected: true } });
  }
  return candidates.length;
}

async function promoteReviewedProjects(tenderId: string, limit: number): Promise<number> {
  if (limit <= 0) return 0;
  const selectedCount = await prisma.tenderProjectMatch.count({ where: { tenderId, isSelected: true } });
  if (selectedCount > 0) return 0;

  const candidates = await prisma.tenderProjectMatch.findMany({
    where: { tenderId, project: { trustLevel: "REVIEWED" } },
    orderBy: [{ score: "desc" }, { createdAt: "asc" }],
    take: limit,
    select: { id: true, score: true, project: { select: { name: true } } },
  });

  for (const candidate of candidates) {
    await prisma.tenderProjectMatch.update({ where: { id: candidate.id }, data: { isSelected: true } });
  }
  return candidates.length;
}

/**
 * Generation-time safety net.
 *
 * The deterministic matcher historically selected only >=90% records. For
 * universal tenders, good reviewed references may score below 90 but still be
 * the best available evidence. This helper promotes the best reviewed matches
 * only when the user/engine has selected none for a required class. It never
 * replaces existing manual selections and never promotes unreviewed draft
 * knowledge into generation.
 */
export async function promoteBestAvailableReviewedMatchesForGeneration(params: {
  tenderId: string;
  requirements: RequirementLite[];
}): Promise<BestAvailablePromotion> {
  const expertLimit = requiredLimit(params.requirements, "EXPERT", 4);
  const projectLimit = requiredLimit(params.requirements, "PROJECT_EXPERIENCE", 3);
  const [promotedExpertCount, promotedProjectCount] = await Promise.all([
    promoteReviewedExperts(params.tenderId, expertLimit),
    promoteReviewedProjects(params.tenderId, projectLimit),
  ]);

  const warnings: string[] = [];
  if (promotedExpertCount > 0) warnings.push(`${promotedExpertCount} reviewed expert match(es) were auto-selected as best available for proposal generation because no experts were selected. Scores may be below 90%, but draft knowledge was not promoted.`);
  if (promotedProjectCount > 0) warnings.push(`${promotedProjectCount} reviewed project reference match(es) were auto-selected as best available for proposal generation because no project references were selected. Scores may be below 90%, but draft knowledge was not promoted.`);

  return { promotedExpertCount, promotedProjectCount, warnings };
}
