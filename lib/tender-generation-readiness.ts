import type { PrismaClient } from "@prisma/client";
import { ensureCompanyForUser } from "./company-workspace";
import { getCompanyIngestionReadiness, type CompanyIngestionReadiness } from "./company-ingestion-readiness";
import { assessTenderAnalysisQuality, type AnalysisQualityReport } from "./analysis-quality";
import { assessMatchingQuality, type MatchingQualityReport } from "./matching-quality";

export type GenerationReadinessItem = {
  code: string;
  message: string;
  nextAction?: string;
};

export type TenderGenerationReadiness = {
  ready: boolean;
  tenderId: string;
  blockers: GenerationReadinessItem[];
  warnings: GenerationReadinessItem[];
  counts: {
    requirements: number;
    unresolvedCriticalGaps: number;
    hardBlockers: number;
    expertMatches: number;
    reviewedExpertMatches: number;
    selectedExperts: number;
    reviewedSelectedExperts: number;
    projectMatches: number;
    reviewedProjectMatches: number;
    selectedProjects: number;
    reviewedSelectedProjects: number;
  };
  companyReadiness: CompanyIngestionReadiness;
  analysisQuality: AnalysisQualityReport;
  matchingQuality: MatchingQualityReport;
  generatedAt: string;
};

function criticalGapIsHardBlock(gap: { title: string; description: string; mitigationPlan: string | null }) {
  const text = `${gap.title} ${gap.description} ${gap.mitigationPlan ?? ""}`;
  return /(ineligible|debarred|blacklisted|deadline.*passed|late submission|missing required file name|missing exact file|tender not found|company profile required|no documents? have been generated|signature prohibited|branding prohibited)/i.test(text);
}

export async function getTenderGenerationReadiness(client: PrismaClient, userId: string, tenderId: string): Promise<TenderGenerationReadiness | null> {
  const [company, tender] = await Promise.all([
    ensureCompanyForUser(client, userId),
    client.tender.findFirst({
      where: { id: tenderId, userId },
      include: {
        requirements: true,
        complianceGaps: { where: { isResolved: false }, select: { title: true, description: true, mitigationPlan: true, severity: true } },
        expertMatches: { include: { expert: { select: { trustLevel: true, fullName: true } } } },
        projectMatches: { include: { project: { select: { trustLevel: true, name: true } } } },
      },
    }),
  ]);

  if (!tender) return null;

  const companyReadiness = await getCompanyIngestionReadiness(company.id, client);
  const analysisQuality = assessTenderAnalysisQuality({
    requirements: tender.requirements,
    analysisSummary: tender.analysisSummary,
    evaluationMethodology: tender.evaluationMethodology,
    submissionNotes: [tender.notes, tender.intakeSummary].filter(Boolean).join("\n\n"),
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
  });
  const matchingQuality = assessMatchingQuality({
    requirements: tender.requirements,
    expertMatches: tender.expertMatches,
    projectMatches: tender.projectMatches,
  });

  const blockers: GenerationReadinessItem[] = companyReadiness.blockers.map((message) => ({ code: "COMPANY_INGESTION_NOT_READY", message, nextAction: "OPEN_COMPANY_READINESS" }));
  const warnings: GenerationReadinessItem[] = companyReadiness.warnings.map((message) => ({ code: "COMPANY_INGESTION_WARNING", message, nextAction: "OPEN_COMPANY_READINESS" }));

  if (analysisQuality.severity === "POOR") {
    blockers.push({ code: "ANALYSIS_QUALITY_POOR", message: `Tender analysis quality is poor (${analysisQuality.score}/100). Re-run AI Analyze / Run Engine and verify evaluation criteria, submission rules, and source references before generation.`, nextAction: "OPEN_ANALYSIS_QUALITY" });
  } else if (analysisQuality.severity === "WARNING") {
    warnings.push({ code: "ANALYSIS_QUALITY_WARNING", message: `Tender analysis quality has warnings (${analysisQuality.score}/100). Review before final generation/export.`, nextAction: "OPEN_ANALYSIS_QUALITY" });
  }

  if (matchingQuality.severity === "POOR") {
    blockers.push({ code: "MATCHING_QUALITY_POOR", message: `Matching quality is poor (${matchingQuality.score}/100). Review expert/project matches before generation.`, nextAction: "OPEN_MATCHING_QUALITY" });
  } else if (matchingQuality.severity === "WARNING") {
    warnings.push({ code: "MATCHING_QUALITY_WARNING", message: `Matching quality has warnings (${matchingQuality.score}/100). Review selected evidence before final generation/export.`, nextAction: "OPEN_MATCHING_QUALITY" });
  }

  if (tender.status === "NO_BID") {
    blockers.push({ code: "NO_BID_BLOCK", message: "Tender is marked NO_BID. Apply a BID or BID_WITH_CONDITIONS decision before generation." });
  }
  if (tender.requirements.length === 0) {
    blockers.push({ code: "NO_REQUIREMENTS", message: "No tender requirements are extracted. Run AI Analyze / Run Engine first, or add requirements manually.", nextAction: "RUN_ENGINE" });
  }

  const hardBlocks = tender.complianceGaps.filter((gap) => gap.severity === "CRITICAL" && criticalGapIsHardBlock(gap));
  for (const gap of hardBlocks) blockers.push({ code: "HARD_COMPLIANCE_BLOCKER", message: gap.title, nextAction: "RESOLVE_COMPLIANCE_GAPS" });

  const seniorReviewGaps = tender.complianceGaps.filter((gap) => gap.severity === "CRITICAL" && !criticalGapIsHardBlock(gap));
  if (seniorReviewGaps.length > 0) {
    warnings.push({ code: "SENIOR_REVIEW_GAPS", message: `${seniorReviewGaps.length} critical evidence/review gap(s) need senior bid review.`, nextAction: "OPEN_COMPLIANCE_REVIEW" });
  }

  const expertRequirementExists = tender.requirements.some((req) => req.requirementType === "EXPERT");
  const projectRequirementExists = tender.requirements.some((req) => req.requirementType === "PROJECT_EXPERIENCE");
  const selectedExperts = tender.expertMatches.filter((match) => match.isSelected);
  const selectedProjects = tender.projectMatches.filter((match) => match.isSelected);
  const reviewedExpertMatches = tender.expertMatches.filter((match) => match.expert.trustLevel === "REVIEWED");
  const reviewedProjectMatches = tender.projectMatches.filter((match) => match.project.trustLevel === "REVIEWED");
  const reviewedSelectedExperts = selectedExperts.filter((match) => match.expert.trustLevel === "REVIEWED");
  const reviewedSelectedProjects = selectedProjects.filter((match) => match.project.trustLevel === "REVIEWED");

  if (expertRequirementExists && tender.expertMatches.length === 0) {
    blockers.push({ code: "NO_EXPERT_MATCHES_FOUND", message: "Tender requires experts but no expert matches exist yet.", nextAction: "RUN_ENGINE" });
  } else if (expertRequirementExists && selectedExperts.length === 0 && reviewedExpertMatches.length === 0) {
    blockers.push({ code: "NO_REVIEWED_EXPERT_MATCHES", message: "Tender requires experts but no reviewed expert matches are available for selection or auto-promotion.", nextAction: "OPEN_KNOWLEDGE_REVIEW" });
  } else if (expertRequirementExists && selectedExperts.length === 0 && reviewedExpertMatches.length > 0) {
    warnings.push({ code: "EXPERT_AUTO_PROMOTION_AVAILABLE", message: `${reviewedExpertMatches.length} reviewed expert match(es) are available and can be auto-selected during generation if no manual selection is made.`, nextAction: "REVIEW_MATCHES" });
  } else if (expertRequirementExists && reviewedSelectedExperts.length === 0) {
    blockers.push({ code: "ALL_EXPERTS_UNREVIEWED", message: "Selected expert matches are unreviewed. Review at least one selected expert before generation.", nextAction: "OPEN_KNOWLEDGE_REVIEW" });
  }

  if (projectRequirementExists && tender.projectMatches.length === 0) {
    blockers.push({ code: "NO_PROJECT_MATCHES_FOUND", message: "Tender requires project references but no project matches exist yet.", nextAction: "RUN_ENGINE" });
  } else if (projectRequirementExists && selectedProjects.length === 0 && reviewedProjectMatches.length === 0) {
    blockers.push({ code: "NO_REVIEWED_PROJECT_MATCHES", message: "Tender requires project references but no reviewed project matches are available for selection or auto-promotion.", nextAction: "OPEN_KNOWLEDGE_REVIEW" });
  } else if (projectRequirementExists && selectedProjects.length === 0 && reviewedProjectMatches.length > 0) {
    warnings.push({ code: "PROJECT_AUTO_PROMOTION_AVAILABLE", message: `${reviewedProjectMatches.length} reviewed project match(es) are available and can be auto-selected during generation if no manual selection is made.`, nextAction: "REVIEW_MATCHES" });
  } else if (projectRequirementExists && reviewedSelectedProjects.length === 0) {
    blockers.push({ code: "ALL_PROJECTS_UNREVIEWED", message: "Selected project matches are unreviewed. Review at least one selected project before generation.", nextAction: "OPEN_KNOWLEDGE_REVIEW" });
  }

  return {
    ready: blockers.length === 0,
    tenderId,
    blockers,
    warnings,
    counts: {
      requirements: tender.requirements.length,
      unresolvedCriticalGaps: tender.complianceGaps.filter((gap) => gap.severity === "CRITICAL").length,
      hardBlockers: hardBlocks.length,
      expertMatches: tender.expertMatches.length,
      reviewedExpertMatches: reviewedExpertMatches.length,
      selectedExperts: selectedExperts.length,
      reviewedSelectedExperts: reviewedSelectedExperts.length,
      projectMatches: tender.projectMatches.length,
      reviewedProjectMatches: reviewedProjectMatches.length,
      selectedProjects: selectedProjects.length,
      reviewedSelectedProjects: reviewedSelectedProjects.length,
    },
    companyReadiness,
    analysisQuality,
    matchingQuality,
    generatedAt: new Date().toISOString(),
  };
}
