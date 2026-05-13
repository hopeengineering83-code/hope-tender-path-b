import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { ensureCompanyForUser } from "../../../../../lib/company-workspace";
import { getCompanyIngestionReadiness } from "../../../../../lib/company-ingestion-readiness";
import { prisma, prismaReady } from "../../../../../lib/prisma";

export const dynamic = "force-dynamic";

type Blocker = { code: string; message: string; nextAction?: string };
type Warning = { code: string; message: string; nextAction?: string };

function criticalGapIsHardBlock(gap: { title: string; description: string; mitigationPlan: string | null }) {
  const text = `${gap.title} ${gap.description} ${gap.mitigationPlan ?? ""}`;
  return /(ineligible|debarred|blacklisted|deadline.*passed|late submission|missing required file name|missing exact file|tender not found|company profile required|no documents? have been generated|signature prohibited|branding prohibited)/i.test(text);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id: tenderId } = await params;
  const [company, tender] = await Promise.all([
    ensureCompanyForUser(prisma, userId),
    prisma.tender.findFirst({
      where: { id: tenderId, userId },
      include: {
        requirements: true,
        complianceGaps: { where: { isResolved: false }, select: { title: true, description: true, mitigationPlan: true, severity: true } },
        expertMatches: { include: { expert: { select: { trustLevel: true, fullName: true } } } },
        projectMatches: { include: { project: { select: { trustLevel: true, name: true } } } },
      },
    }),
  ]);

  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const companyReadiness = await getCompanyIngestionReadiness(company.id);
  const blockers: Blocker[] = [];
  const warnings: Warning[] = [];

  for (const blocker of companyReadiness.blockers) {
    blockers.push({ code: "COMPANY_INGESTION_NOT_READY", message: blocker, nextAction: "OPEN_COMPANY_READINESS" });
  }
  for (const warning of companyReadiness.warnings) {
    warnings.push({ code: "COMPANY_INGESTION_WARNING", message: warning, nextAction: "OPEN_COMPANY_READINESS" });
  }

  if (tender.status === "NO_BID") {
    blockers.push({ code: "NO_BID_BLOCK", message: "Tender is marked NO_BID. Apply a BID or BID_WITH_CONDITIONS decision before generation." });
  }

  if (tender.requirements.length === 0) {
    blockers.push({ code: "NO_REQUIREMENTS", message: "No tender requirements are extracted. Run AI Analyze / Run Engine first, or add requirements manually.", nextAction: "RUN_ENGINE" });
  }

  const hardBlocks = tender.complianceGaps.filter((gap) => gap.severity === "CRITICAL" && criticalGapIsHardBlock(gap));
  for (const gap of hardBlocks) {
    blockers.push({ code: "HARD_COMPLIANCE_BLOCKER", message: gap.title, nextAction: "RESOLVE_COMPLIANCE_GAPS" });
  }
  const seniorReviewGaps = tender.complianceGaps.filter((gap) => gap.severity === "CRITICAL" && !criticalGapIsHardBlock(gap));
  if (seniorReviewGaps.length > 0) {
    warnings.push({ code: "SENIOR_REVIEW_GAPS", message: `${seniorReviewGaps.length} critical evidence/review gap(s) will need senior bid review.`, nextAction: "OPEN_COMPLIANCE_REVIEW" });
  }

  const expertRequirementExists = tender.requirements.some((req) => req.requirementType === "EXPERT");
  const projectRequirementExists = tender.requirements.some((req) => req.requirementType === "PROJECT_EXPERIENCE");
  const selectedExperts = tender.expertMatches.filter((match) => match.isSelected);
  const selectedProjects = tender.projectMatches.filter((match) => match.isSelected);
  const reviewedSelectedExperts = selectedExperts.filter((match) => match.expert.trustLevel === "REVIEWED");
  const reviewedSelectedProjects = selectedProjects.filter((match) => match.project.trustLevel === "REVIEWED");

  if (expertRequirementExists && tender.expertMatches.length === 0) {
    blockers.push({ code: "NO_EXPERT_MATCHES_FOUND", message: "Tender requires experts but no expert matches exist yet.", nextAction: "RUN_ENGINE" });
  } else if (expertRequirementExists && selectedExperts.length === 0) {
    blockers.push({ code: "NO_EXPERT_MATCHES_SELECTED", message: "Tender requires experts but no expert matches are selected.", nextAction: "REVIEW_MATCHES" });
  } else if (expertRequirementExists && reviewedSelectedExperts.length === 0) {
    blockers.push({ code: "ALL_EXPERTS_UNREVIEWED", message: "Selected expert matches are unreviewed. Review at least one selected expert before generation.", nextAction: "OPEN_KNOWLEDGE_REVIEW" });
  }

  if (projectRequirementExists && tender.projectMatches.length === 0) {
    blockers.push({ code: "NO_PROJECT_MATCHES_FOUND", message: "Tender requires project references but no project matches exist yet.", nextAction: "RUN_ENGINE" });
  } else if (projectRequirementExists && selectedProjects.length === 0) {
    blockers.push({ code: "NO_PROJECT_MATCHES_SELECTED", message: "Tender requires project references but no project matches are selected.", nextAction: "REVIEW_MATCHES" });
  } else if (projectRequirementExists && reviewedSelectedProjects.length === 0) {
    blockers.push({ code: "ALL_PROJECTS_UNREVIEWED", message: "Selected project matches are unreviewed. Review at least one selected project before generation.", nextAction: "OPEN_KNOWLEDGE_REVIEW" });
  }

  return NextResponse.json({
    ready: blockers.length === 0,
    tenderId,
    blockers,
    warnings,
    counts: {
      requirements: tender.requirements.length,
      unresolvedCriticalGaps: tender.complianceGaps.filter((gap) => gap.severity === "CRITICAL").length,
      hardBlockers: hardBlocks.length,
      expertMatches: tender.expertMatches.length,
      selectedExperts: selectedExperts.length,
      reviewedSelectedExperts: reviewedSelectedExperts.length,
      projectMatches: tender.projectMatches.length,
      selectedProjects: selectedProjects.length,
      reviewedSelectedProjects: reviewedSelectedProjects.length,
    },
    companyReadiness,
    generatedAt: new Date().toISOString(),
  });
}
