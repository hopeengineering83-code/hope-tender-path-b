import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { assessMatchingQuality } from "../../../../../lib/matching-quality";
import { ensureCompanyForUser } from "../../../../../lib/company-workspace";
import { getCompanyIngestionReadiness } from "../../../../../lib/company-ingestion-readiness";
import { safeApiError } from "../../../../../lib/engine/safe-api-error";

export const dynamic = "force-dynamic";

type MatchingQuality = ReturnType<typeof assessMatchingQuality>;

function structuralReadyForGeneration(quality: MatchingQuality): boolean {
  if (quality.state === "VAULT_AWAITS_ENGINE" || quality.state === "NO_VAULT") return false;
  if (quality.state === "MATCHING_NOT_REQUIRED") return true;
  if (quality.expertRequirementExists && quality.reviewedSelectedExperts <= 0) return false;
  if (quality.projectRequirementExists && quality.reviewedSelectedProjects <= 0) return false;
  return quality.severity !== "POOR";
}

function structuralReadyForMatchingAttempt(quality: MatchingQuality): boolean {
  return quality.state === "VAULT_AWAITS_ENGINE" ||
    quality.state === "MATCHES_REVIEWED" ||
    quality.state === "MATCHES_WEAK" ||
    quality.state === "MATCHING_NOT_REQUIRED";
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    await prismaReady;
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

    const readyForGeneration = structuralReadyForGeneration(quality);
    const readyForMatchingAttempt = structuralReadyForMatchingAttempt(quality);

    return NextResponse.json({
      tenderId: id,
      readyForMatchingAttempt,
      readyForGeneration,
      nextAction: readyForGeneration
        ? "GENERATE"
        : quality.state === "VAULT_AWAITS_ENGINE"
          ? "RUN_ENGINE"
          : "REVIEW_MATCHING_QUALITY",
      quality,
    });
  } catch (error) {
    // Use the shared safeApiError helper so the response shape matches every
    // other readiness/route error in the app (ok/success/error/code/
    // diagnosticId/blockers/warnings). The previous hand-rolled response
    // omitted `ok` and `success` fields and the response shape diverged from
    // the shared contract. Server-side log keeps errorClass for diagnostics;
    // raw error.message is never exposed to the API consumer.
    logger.error("[matching-quality] route failed", {
      route: "/api/tenders/[id]/matching-quality",
      tenderId: id,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return safeApiError("matching-quality", error, {
      status: 500,
      message: "Matching quality panel failed to load. Refresh to retry.",
    });
  }
}
