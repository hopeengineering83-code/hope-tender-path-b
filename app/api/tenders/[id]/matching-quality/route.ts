import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { assessMatchingQuality } from "../../../../../lib/matching-quality";
import { ensureCompanyForUser } from "../../../../../lib/company-workspace";
import { getCompanyIngestionReadiness } from "../../../../../lib/company-ingestion-readiness";

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

  // Gap 5 — pass vault counts so this panel correctly returns
  // VAULT_AWAITS_ENGINE state (softer score) when engine hasn't run yet
  // but vault has 28 reviewed experts + 112 reviewed projects ready —
  // the production screenshot scenario. Without these counts the panel
  // hard-deducted -35-35 and produced 30/100 POOR while the Bid Control
  // Verdict (which DID pass vault counts) showed 64/100 WARNING.
  const companyReadiness = await getCompanyIngestionReadiness(company.id, {}, prisma);
  const quality = assessMatchingQuality({
    requirements: tender.requirements,
    expertMatches: tender.expertMatches,
    projectMatches: tender.projectMatches,
    vaultReviewedExperts: companyReadiness.totals.reviewedExperts,
    vaultReviewedProjects: companyReadiness.totals.reviewedProjects,
  });

  return NextResponse.json({ tenderId: id, readyForGeneration: quality.severity !== "POOR", quality });
}
