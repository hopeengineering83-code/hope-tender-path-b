import { prisma } from "../prisma";

export type PostconditionCounts = {
  requirementCount: number;
  complianceRows: number;
  expertRequirementCount: number;
  projectRequirementCount: number;
  totalExpertMatches: number;
  totalProjectMatches: number;
  selectedReviewedExperts: number;
  selectedReviewedProjects: number;
};

export type PostconditionResult = {
  ok: boolean;
  blockers: string[];
  counts: PostconditionCounts;
};

export async function checkEnginePostconditions(tenderId: string): Promise<PostconditionResult> {
  const [requirementCount, complianceRows, expertReqCount, projectReqCount,
         totalExperts, totalProjects, reviewedExperts, reviewedProjects] = await Promise.all([
    prisma.tenderRequirement.count({ where: { tenderId } }),
    prisma.complianceMatrix.count({ where: { tenderId } }),
    prisma.tenderRequirement.count({ where: { tenderId, requirementType: { in: ["EXPERT", "PERSONNEL", "CV", "EXPERT_EXPERIENCE"] } } }),
    prisma.tenderRequirement.count({ where: { tenderId, requirementType: { in: ["PROJECT_EXPERIENCE", "RELEVANT_EXPERIENCE"] } } }),
    prisma.tenderExpertMatch.count({ where: { tenderId } }),
    prisma.tenderProjectMatch.count({ where: { tenderId } }),
    prisma.tenderExpertMatch.count({ where: { tenderId, isSelected: true, expert: { trustLevel: "REVIEWED" } } }),
    prisma.tenderProjectMatch.count({ where: { tenderId, isSelected: true, project: { trustLevel: "REVIEWED" } } }),
  ]);

  const blockers: string[] = [];
  if (requirementCount === 0) blockers.push("NO_REQUIREMENTS_PERSISTED");
  if (requirementCount > 0 && complianceRows === 0) blockers.push("ENGINE_RAN_ZERO_EVIDENCE_ROWS");
  if (expertReqCount > 0 && totalExperts === 0) blockers.push("ENGINE_RAN_ZERO_EXPERT_MATCHES");
  if (projectReqCount > 0 && totalProjects === 0) blockers.push("ENGINE_RAN_ZERO_PROJECT_MATCHES");
  if (expertReqCount > 0 && reviewedExperts === 0) blockers.push("NO_SELECTED_REVIEWED_EXPERTS_AFTER_ENGINE");
  if (projectReqCount > 0 && reviewedProjects === 0) blockers.push("NO_SELECTED_REVIEWED_PROJECTS_AFTER_ENGINE");

  const counts: PostconditionCounts = {
    requirementCount,
    complianceRows,
    expertRequirementCount: expertReqCount,
    projectRequirementCount: projectReqCount,
    totalExpertMatches: totalExperts,
    totalProjectMatches: totalProjects,
    selectedReviewedExperts: reviewedExperts,
    selectedReviewedProjects: reviewedProjects,
  };
  return { ok: blockers.length === 0, blockers, counts };
}
