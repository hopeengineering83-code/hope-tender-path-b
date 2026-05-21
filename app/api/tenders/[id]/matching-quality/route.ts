import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { assessMatchingQuality, isReadyForGenerationFromMatchingQuality } from "../../../../../lib/matching-quality";
import { ensureCompanyForUser } from "../../../../../lib/company-workspace";
import { getCompanyIngestionReadiness } from "../../../../../lib/company-ingestion-readiness";
import { getCanonicalTenderReadiness } from "../../../../../lib/canonical-tender-readiness";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;
  const [company, tender] = await Promise.all([
    ensureCompanyForUser(prisma, userId),
    prisma.tender.findFirst({
      where: { id, userId },
      include: {
        requirements: true,
        expertMatches: { include: { expert: { select: { trustLevel: true, fullName: true } } } },
        projectMatches: { include: { project: { select: { trustLevel: true, name: true } } } },
      },
    }),
  ]);
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const companyReadiness = await getCompanyIngestionReadiness(company.id, {}, prisma);
  const quality = assessMatchingQuality({
    requirements: tender.requirements,
    expertMatches: tender.expertMatches,
    projectMatches: tender.projectMatches,
    vaultReviewedExperts: companyReadiness.totals.reviewedExperts,
    vaultReviewedProjects: companyReadiness.totals.reviewedProjects,
  });
  const canonical = await getCanonicalTenderReadiness(prisma, userId, id);

  const readyForGeneration = isReadyForGenerationFromMatchingQuality(quality);
  const readyForMatchingAttempt =
    quality.state === "VAULT_AWAITS_ENGINE" ||
    quality.state === "MATCHES_REVIEWED" ||
    quality.state === "MATCHES_WEAK" ||
    quality.state === "MATCHING_NOT_REQUIRED";

  return NextResponse.json({
    tenderId: id,
    readyForMatchingAttempt,
    readyForGeneration,
    matchingState: quality.state,
    nextAction: readyForGeneration
      ? "GENERATE"
      : quality.state === "VAULT_AWAITS_ENGINE"
        ? "RUN_ENGINE"
        : "REVIEW_MATCHING_QUALITY",
    canonical,
    quality,
  });
}
