import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { assessTenderAnalysisQuality } from "../../../../../lib/analysis-quality";
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
  // Load full tender shape so we can pass metadata + matching state into
  // the analysis-quality assessor. Without these the score climbs to
  // 100/100 even when matching is 0 and clientName is corrupted — the
  // exact production bug from the May 16 screenshot where this panel
  // said "Tender analysis appears usable" while the Bid Control Verdict
  // and Generation Readiness panels both said the analysis was poor.
  const [company, tender] = await Promise.all([
    ensureCompanyForUser(prisma, userId),
    prisma.tender.findFirst({
      where: { id, userId },
      include: {
        requirements: { orderBy: { createdAt: "asc" } },
        expertMatches: { include: { expert: { select: { trustLevel: true, fullName: true } } } },
        projectMatches: { include: { project: { select: { trustLevel: true, name: true } } } },
        files: { select: { extractedText: true } },
      },
    }),
  ]);
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  // Pass vault counts so matching-readiness sub-score correctly shows
  // VAULT_AWAITS_ENGINE state (−18 per type) rather than NO_VAULT
  // state (−35 per type) when reviewed evidence exists but engine
  // hasn't been run on this tender yet.
  const companyReadiness = await getCompanyIngestionReadiness(company.id, {}, prisma);
  const matchingQuality = assessMatchingQuality({
    requirements: tender.requirements,
    expertMatches: tender.expertMatches,
    projectMatches: tender.projectMatches,
    vaultReviewedExperts: companyReadiness.totals.reviewedExperts,
    vaultReviewedProjects: companyReadiness.totals.reviewedProjects,
  });
  const extractedTextLength = tender.files.reduce((sum, f) => sum + (f.extractedText?.length ?? 0), 0);

  const quality = assessTenderAnalysisQuality({
    requirements: tender.requirements,
    analysisSummary: tender.analysisSummary,
    evaluationMethodology: tender.evaluationMethodology,
    submissionNotes: [tender.notes, tender.intakeSummary].filter(Boolean).join("\n\n"),
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    // Gap 4 — metadata + matching state. These params already exist on the
    // function (added in PR #368); the dedicated route just wasn't passing
    // them, so this panel rendered the legacy "requirements-only" score
    // and disagreed with every other panel that consumes the readiness gate.
    clientName: tender.clientName,
    referenceNumber: tender.reference,
    country: tender.country,
    clientContactName: tender.clientContactName,
    matchingScore: matchingQuality.score,
    extractedTextLength,
    selectedReviewedExperts: tender.expertMatches.filter((m) => m.isSelected && m.expert.trustLevel === "REVIEWED").length,
    selectedReviewedProjects: tender.projectMatches.filter((m) => m.isSelected && m.project.trustLevel === "REVIEWED").length,
  });

  return NextResponse.json({ tenderId: id, readyForMatching: quality.severity !== "POOR", quality });
}
