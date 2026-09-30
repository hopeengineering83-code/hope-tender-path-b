import { prisma } from "../prisma";
import { canUseVaultRecord, VAULT_REVIEW_CONSUMER_SELECT } from "../vault-review-provenance";

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
         totalExperts, totalProjects, selectedExpertRows, selectedProjectRows] = await Promise.all([
    prisma.tenderRequirement.count({ where: { tenderId } }),
    prisma.complianceMatrix.count({ where: { tenderId } }),
    // Only a MANDATORY/CRITICAL evidence requirement makes an empty selection a
    // blocker. 2026-09-30, Preview, a telecom-tower EOI: "Previous
    // Telecommunications Tower Experience" was SCORED, every one of the firm's
    // 114 building projects was correctly hard-excluded (no domain overlap),
    // and this postcondition marked the Engine run ENGINE_COMPLETED_WITH_
    // BLOCKERS, so no proposal was ever generated. A scored criterion the firm
    // cannot evidence costs points; it is not a reason to withhold the bid.
    // The gap stays visible in the compliance matrix, and nothing is claimed.
    prisma.tenderRequirement.count({ where: { tenderId, priority: { in: ["MANDATORY", "CRITICAL"] }, requirementType: { in: ["EXPERT", "PERSONNEL", "CV", "EXPERT_EXPERIENCE"] } } }),
    prisma.tenderRequirement.count({ where: { tenderId, priority: { in: ["MANDATORY", "CRITICAL"] }, requirementType: { in: ["PROJECT_EXPERIENCE", "RELEVANT_EXPERIENCE"] } } }),
    prisma.tenderExpertMatch.count({ where: { tenderId } }),
    prisma.tenderProjectMatch.count({ where: { tenderId } }),
    prisma.tenderExpertMatch.findMany({
      where: { tenderId, isSelected: true },
      select: { expert: { select: VAULT_REVIEW_CONSUMER_SELECT.EXPERT } },
    }),
    prisma.tenderProjectMatch.findMany({
      where: { tenderId, isSelected: true },
      select: { project: { select: VAULT_REVIEW_CONSUMER_SELECT.PROJECT } },
    }),
  ]);

  // canUseVaultRecord(..., "GENERATION"), not isDurablyReviewed alone — a
  // selection consisting entirely of durably SOURCE_VERIFIED (machine-
  // verified) experts/projects is genuinely usable for generation and must
  // not trip NO_SELECTED_SOURCE_VERIFIED_EXPERTS_AFTER_ENGINE, which would
  // falsely report the Engine run as partial/failed.
  const reviewedExperts = selectedExpertRows.filter((row) => canUseVaultRecord(row.expert, "GENERATION")).length;
  const reviewedProjects = selectedProjectRows.filter((row) => canUseVaultRecord(row.project, "GENERATION")).length;

  const blockers: string[] = [];
  // Gap 1: NO_REQUIREMENTS_PERSISTED is no longer a blocker. Source-text-only
  // generation proceeds even without structured requirements.
  if (requirementCount > 0 && complianceRows === 0) blockers.push("ENGINE_RAN_ZERO_EVIDENCE_ROWS");

  // A zero-row result already implies that no eligible reviewed selection can
  // exist. Do not emit a second redundant selected-review blocker for the same
  // class; reserve that blocker for runs that created candidates but selected
  // none with durable source provenance.
  if (expertReqCount > 0 && totalExperts === 0) {
    blockers.push("ENGINE_RAN_ZERO_EXPERT_MATCHES");
  } else if (expertReqCount > 0 && reviewedExperts === 0) {
    blockers.push("NO_SELECTED_SOURCE_VERIFIED_EXPERTS_AFTER_ENGINE");
  }

  if (projectReqCount > 0 && totalProjects === 0) {
    blockers.push("ENGINE_RAN_ZERO_PROJECT_MATCHES");
  } else if (projectReqCount > 0 && reviewedProjects === 0) {
    blockers.push("NO_SELECTED_SOURCE_VERIFIED_PROJECTS_AFTER_ENGINE");
  }

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
