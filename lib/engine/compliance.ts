import type { CompanyKnowledgeSnapshot, ComplianceResult, MatchingResult, RequirementDraft } from "./types";

export function buildCompliance(
  requirementIds: Array<{ id: string; requirement: RequirementDraft }>,
  knowledge: CompanyKnowledgeSnapshot,
  matching: MatchingResult,
): ComplianceResult {
  const expertCount = knowledge.experts.length;
  const projectCount = knowledge.projects.length;
  const documentCount = knowledge.documents.length;

  const matrices: ComplianceResult["matrices"] = [];
  const gaps: ComplianceResult["gaps"] = [];

  for (const item of requirementIds) {
    const req = item.requirement;
    let supportStrength = 0;
    let supportStatus = "UNSUPPORTED";
    let evidenceSummary = "No mapped company evidence yet.";

    if (req.requirementType === "EXPERT") {
      supportStrength = expertCount > 0 ? Math.min(1, expertCount / Math.max(req.requiredQuantity || 1, 1)) : 0;
      supportStatus = supportStrength >= 1 ? "SUPPORTED" : supportStrength > 0 ? "PARTIAL" : "UNSUPPORTED";
      evidenceSummary = `${expertCount} expert records available in company knowledge.`;
    } else if (req.requirementType === "PROJECT_EXPERIENCE") {
      supportStrength = projectCount > 0 ? Math.min(1, projectCount / Math.max(req.requiredQuantity || 1, 1)) : 0;
      supportStatus = supportStrength >= 1 ? "SUPPORTED" : supportStrength > 0 ? "PARTIAL" : "UNSUPPORTED";
      evidenceSummary = `${projectCount} project references available in company knowledge.`;
    } else {
      supportStrength = documentCount > 0 ? 0.65 : 0;
      supportStatus = supportStrength > 0 ? "EVIDENCE_PENDING_REVIEW" : "UNSUPPORTED";
      evidenceSummary = documentCount > 0
        ? `${documentCount} company documents available for internal evidence mapping.`
        : "No company documents available yet.";
    }

    matrices.push({
      requirementTitle: req.title,
      requirementId: item.id,
      supportStatus,
      supportStrength,
      evidenceSummary,
      notes: req.priority === "MANDATORY" && supportStrength < 1 ? "Needs stronger support before export." : undefined,
    });

    if (req.priority === "MANDATORY" && supportStrength < 1) {
      gaps.push({
        requirementId: item.id,
        severity: supportStrength === 0 ? "CRITICAL" : "HIGH",
        title: `${req.title} is not fully supported`,
        description: `${req.description} Current evidence status: ${supportStatus}.`,
        mitigationPlan: "Add stronger company evidence or update the tender mapping before export.",
      });
    }
  }

  if (matching.expertMatches.filter((match) => match.isSelected).length === 0 && knowledge.experts.length === 0) {
    gaps.push({
      severity: "MEDIUM",
      title: "No expert library available",
      description: "The matching engine cannot recommend personnel because the company expert library is empty.",
      mitigationPlan: "Create expert records and upload CV evidence in the company vault.",
    });
  }

  return { matrices, gaps };
}
